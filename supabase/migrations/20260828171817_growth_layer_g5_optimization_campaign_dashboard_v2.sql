create or replace function public.growth_g5_optimization_observations(
  p_organization_id uuid,
  p_business_unit_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null,
  p_min_prospects integer default 20,
  p_min_replies integer default 5,
  p_min_qualified integer default 3,
  p_min_quote_acceptance_rate numeric default 0.20
)
returns table (
  source_lane text,
  country_code text,
  subdivision_code text,
  city text,
  segment text,
  prospects bigint,
  outreach_attempted bigint,
  delivered bigint,
  replied bigint,
  positive_interest bigint,
  qualified bigint,
  handoff_completed bigint,
  quote_sent bigint,
  quote_accepted bigint,
  converted bigint,
  bounce_prospects bigint,
  complaint_prospects bigint,
  unsubscribe_prospects bigint,
  reply_rate numeric,
  qualification_rate numeric,
  quote_acceptance_rate numeric,
  conversion_rate numeric,
  sample_status text,
  recommended_action text
)
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if p_min_prospects < 1 or p_min_replies < 1 or p_min_qualified < 1 then
    raise exception 'G5 optimization minimum samples must be positive';
  end if;
  if p_min_quote_acceptance_rate < 0 or p_min_quote_acceptance_rate > 1 then
    raise exception 'G5 quote acceptance threshold must be between 0 and 1';
  end if;

  return query
  with agg as (
    select
      f.source_lane,f.country_code,f.subdivision_code,f.city,f.segment,
      count(*)::bigint as prospects,
      count(*) filter(where coalesce(f.outreach_attempt_count,0)>0)::bigint as outreach_attempted,
      count(*) filter(where f.first_delivered_at is not null)::bigint as delivered,
      count(*) filter(where f.first_reply_at is not null)::bigint as replied,
      count(*) filter(where f.first_positive_interest_at is not null)::bigint as positive_interest,
      count(*) filter(where f.first_qualified_at is not null)::bigint as qualified,
      count(*) filter(where f.handoff_status='succeeded')::bigint as handoff_completed,
      count(*) filter(where f.first_quote_sent_at is not null)::bigint as quote_sent,
      count(*) filter(where f.quote_accepted_at is not null)::bigint as quote_accepted,
      count(*) filter(where f.conversion_record_id is not null)::bigint as converted,
      count(*) filter(where f.first_bounce_at is not null)::bigint as bounce_prospects,
      count(*) filter(where f.first_complaint_at is not null)::bigint as complaint_prospects,
      count(*) filter(where f.first_unsubscribe_at is not null)::bigint as unsubscribe_prospects
    from growth.prospect_funnel_analytics_v1 f
    where f.organization_id=p_organization_id
      and (p_business_unit_id is null or f.business_unit_id=p_business_unit_id)
      and (p_jurisdiction_id is null or f.jurisdiction_id=p_jurisdiction_id)
      and (p_captured_from is null or f.captured_at>=p_captured_from)
      and (p_captured_to is null or f.captured_at<p_captured_to)
    group by f.source_lane,f.country_code,f.subdivision_code,f.city,f.segment
  ), rates as (
    select a.*,
      case when a.delivered>0 then round(a.replied::numeric/a.delivered,4) end as reply_rate,
      case when a.replied>0 then round(a.qualified::numeric/a.replied,4) end as qualification_rate,
      case when a.quote_sent>0 then round(a.quote_accepted::numeric/a.quote_sent,4) end as quote_acceptance_rate,
      case when a.prospects>0 then round(a.converted::numeric/a.prospects,4) end as conversion_rate
    from agg a
  )
  select
    r.source_lane,r.country_code,r.subdivision_code,r.city,r.segment,
    r.prospects,r.outreach_attempted,r.delivered,r.replied,r.positive_interest,r.qualified,
    r.handoff_completed,r.quote_sent,r.quote_accepted,r.converted,r.bounce_prospects,
    r.complaint_prospects,r.unsubscribe_prospects,r.reply_rate,r.qualification_rate,
    r.quote_acceptance_rate,r.conversion_rate,
    case
      when r.prospects < p_min_prospects then 'insufficient_sample'
      when r.replied < p_min_replies and r.outreach_attempted > 0 then 'limited_reply_sample'
      when r.qualified < p_min_qualified and r.replied >= p_min_replies then 'limited_qualification_sample'
      else 'decision_ready'
    end as sample_status,
    case
      when r.prospects < p_min_prospects then 'collect_more_data'
      when r.complaint_prospects > 0 then 'review_sender_health_and_compliance'
      when r.bounce_prospects > 0 then 'review_deliverability'
      when r.outreach_attempted > 0 and r.replied < p_min_replies then 'review_targeting_and_message'
      when r.replied >= p_min_replies and r.qualified < p_min_qualified then 'review_targeting_or_qualification'
      when r.qualified >= p_min_qualified and r.handoff_completed = 0 then 'review_handoff_process'
      when r.handoff_completed > 0 and r.quote_sent = 0 then 'review_handoff_to_quote_process'
      when r.quote_sent >= p_min_qualified and coalesce(r.quote_acceptance_rate,0) < p_min_quote_acceptance_rate then 'review_offer_pricing_or_scope'
      else 'continue_monitoring'
    end as recommended_action
  from rates r
  order by r.country_code,r.subdivision_code,r.city,r.source_lane,r.segment;
end;
$$;

revoke all on function public.growth_g5_optimization_observations(uuid,uuid,uuid,timestamptz,timestamptz,integer,integer,integer,numeric) from public, anon, authenticated;
grant execute on function public.growth_g5_optimization_observations(uuid,uuid,uuid,timestamptz,timestamptz,integer,integer,integer,numeric) to service_role;

create or replace function public.growth_g5_campaign_outcome_summary(
  p_organization_id uuid,
  p_business_unit_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null
)
returns table (
  marketing_source_code text,
  campaign_code text,
  country_code text,
  subdivision_code text,
  segment text,
  handed_off_prospects bigint,
  opportunities bigint,
  quote_sent bigint,
  quote_accepted bigint,
  converted bigint,
  quote_acceptance_rate numeric,
  handoff_to_conversion_rate numeric
)
language sql
stable
security invoker
set search_path=''
as $$
  select
    f.marketing_source_code,
    f.campaign_code,
    f.country_code,
    f.subdivision_code,
    f.segment,
    count(*) filter(where f.handoff_status='succeeded')::bigint as handed_off_prospects,
    count(*) filter(where f.serviceos_opportunity_id is not null)::bigint as opportunities,
    count(*) filter(where f.first_quote_sent_at is not null)::bigint as quote_sent,
    count(*) filter(where f.quote_accepted_at is not null)::bigint as quote_accepted,
    count(*) filter(where f.conversion_record_id is not null)::bigint as converted,
    case when count(*) filter(where f.first_quote_sent_at is not null)>0
      then round((count(*) filter(where f.quote_accepted_at is not null))::numeric/(count(*) filter(where f.first_quote_sent_at is not null)),4)
    end as quote_acceptance_rate,
    case when count(*) filter(where f.handoff_status='succeeded')>0
      then round((count(*) filter(where f.conversion_record_id is not null))::numeric/(count(*) filter(where f.handoff_status='succeeded')),4)
    end as handoff_to_conversion_rate
  from growth.prospect_funnel_analytics_v1 f
  where f.organization_id=p_organization_id
    and f.campaign_id is not null
    and (p_business_unit_id is null or f.business_unit_id=p_business_unit_id)
    and (p_jurisdiction_id is null or f.jurisdiction_id=p_jurisdiction_id)
    and (p_captured_from is null or f.captured_at>=p_captured_from)
    and (p_captured_to is null or f.captured_at<p_captured_to)
  group by f.marketing_source_code,f.campaign_code,f.country_code,f.subdivision_code,f.segment
  order by f.country_code,f.subdivision_code,f.marketing_source_code,f.campaign_code,f.segment;
$$;

revoke all on function public.growth_g5_campaign_outcome_summary(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_campaign_outcome_summary(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;

create or replace function public.growth_g5_dashboard_snapshot_v2(
  p_organization_id uuid,
  p_business_unit_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select jsonb_build_object(
    'schema_version','g5-dashboard-v2',
    'cohort_anchor','growth.prospect.captured_at',
    'currency_policy','separate_by_invoice_currency_no_implicit_fx',
    'optimization_policy','recommendation_only_sample_gated',
    'filters',jsonb_build_object(
      'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
      'captured_from',p_captured_from,'captured_to',p_captured_to
    ),
    'funnel',coalesce((select jsonb_agg(to_jsonb(x) order by x.country_code,x.subdivision_code,x.source_lane,x.segment) from public.growth_g5_funnel_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x),'[]'::jsonb),
    'latency',coalesce((select jsonb_agg(to_jsonb(x) order by x.country_code,x.subdivision_code,x.source_lane,x.segment) from public.growth_g5_latency_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x),'[]'::jsonb),
    'financial',coalesce((select jsonb_agg(to_jsonb(x) order by x.country_code,x.subdivision_code,x.source_lane,x.segment,x.currency_code) from public.growth_g5_financial_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x),'[]'::jsonb),
    'unit_economics',case
      when p_business_unit_id is not null and p_jurisdiction_id is not null and p_captured_from is not null and p_captured_to is not null
      then coalesce((select jsonb_agg(to_jsonb(x) order by x.source_lane,x.currency_code) from public.growth_g5_unit_economics_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x),'[]'::jsonb)
      else '[]'::jsonb
    end,
    'campaign_outcomes',coalesce((select jsonb_agg(to_jsonb(x) order by x.country_code,x.subdivision_code,x.marketing_source_code,x.campaign_code,x.segment) from public.growth_g5_campaign_outcome_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x),'[]'::jsonb),
    'optimization',coalesce((select jsonb_agg(to_jsonb(x) order by x.country_code,x.subdivision_code,x.city,x.source_lane,x.segment) from public.growth_g5_optimization_observations(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to,20,5,3,0.20) x),'[]'::jsonb)
  );
$$;

revoke all on function public.growth_g5_dashboard_snapshot_v2(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_dashboard_snapshot_v2(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
