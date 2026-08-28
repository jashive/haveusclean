create or replace view growth.prospect_funnel_analytics_v1
with (security_invoker = true)
as
select
  p.id as prospect_id,
  p.organization_id,
  p.business_unit_id,
  p.jurisdiction_id,
  p.source_lane,
  p.country_code,
  p.subdivision_code,
  p.city,
  p.segment,
  p.facility_type,
  p.lifecycle_status as growth_lifecycle_status,
  p.verification_status,
  p.captured_at,
  ps.total_score as current_total_score,
  ps.segment_fit as current_segment_fit,
  ps.scored_at as current_scored_at,
  oa.attempt_count as outreach_attempt_count,
  oa.first_attempt_at,
  oa.last_attempt_at,
  oe.first_delivered_at,
  oe.first_reply_at,
  oe.first_bounce_at,
  oe.first_complaint_at,
  oe.first_unsubscribe_at,
  rc.latest_reply_classification,
  rc.latest_reply_classified_at,
  rc.first_positive_interest_at,
  qr.latest_qualification_decision,
  qr.latest_qualification_reviewed_at,
  qr.first_qualified_at,
  hc.id as handoff_candidate_id,
  hc.status as handoff_status,
  hc.completed_at as handoff_completed_at,
  hc.serviceos_service_request_id,
  hc.serviceos_opportunity_id,
  sr.lifecycle_status as service_request_status,
  sr.requested_at as service_request_requested_at,
  sr.marketing_source_id,
  ms.code as marketing_source_code,
  sr.campaign_id,
  c.code as campaign_code,
  o.stage as opportunity_stage,
  o.created_at as opportunity_created_at,
  qm.quote_count,
  qm.first_quote_sent_at,
  qm.quote_accepted_at,
  cr.id as conversion_record_id,
  cr.converted_at,
  oj.id as operational_job_id,
  oj.operational_status,
  oj.created_at as operational_job_created_at,
  ir.id as invoice_request_id,
  ir.request_status as invoice_request_status,
  ir.currency_code as invoice_currency_code,
  ir.total_amount as invoice_total_amount,
  ir.created_at as invoice_created_at,
  pay.reconciled_amount,
  pay.reconciled_at
from growth.prospect p
left join lateral (
  select s.total_score, s.segment_fit, s.scored_at
  from growth.prospect_score s
  where s.prospect_id = p.id and s.is_current = true
  order by s.scored_at desc, s.id desc
  limit 1
) ps on true
left join lateral (
  select count(*)::integer as attempt_count,
         min(coalesce(a.submitted_at, a.created_at)) as first_attempt_at,
         max(coalesce(a.submitted_at, a.created_at)) as last_attempt_at
  from growth.outreach_attempt a
  where a.prospect_id = p.id
) oa on true
left join lateral (
  select min(e.occurred_at) filter (where e.event_type='delivered') as first_delivered_at,
         min(e.occurred_at) filter (where e.event_type='reply') as first_reply_at,
         min(e.occurred_at) filter (where e.event_type='bounce') as first_bounce_at,
         min(e.occurred_at) filter (where e.event_type='complaint') as first_complaint_at,
         min(e.occurred_at) filter (where e.event_type='unsubscribe') as first_unsubscribe_at
  from growth.outreach_event e
  where e.prospect_id = p.id
) oe on true
left join lateral (
  select
    (array_agg(r.classification order by r.created_at desc, r.id desc))[1] as latest_reply_classification,
    max(r.created_at) as latest_reply_classified_at,
    min(r.created_at) filter (where r.classification='positive_interest') as first_positive_interest_at
  from growth.reply_classification_evidence r
  where r.prospect_id = p.id
) rc on true
left join lateral (
  select
    (array_agg(q.decision order by q.reviewed_at desc, q.id desc))[1] as latest_qualification_decision,
    max(q.reviewed_at) as latest_qualification_reviewed_at,
    min(q.reviewed_at) filter (where q.decision='qualified') as first_qualified_at
  from growth.qualification_review q
  where q.prospect_id = p.id
) qr on true
left join growth.handoff_candidate hc on hc.prospect_id = p.id
left join public.service_request sr on sr.id = hc.serviceos_service_request_id
left join public.marketing_source ms on ms.id = sr.marketing_source_id
left join public.campaign c on c.id = sr.campaign_id
left join public.opportunity o on o.id = hc.serviceos_opportunity_id
left join lateral (
  select count(distinct q.id)::integer as quote_count,
         min(qv.sent_at) as first_quote_sent_at,
         min(resp.responded_at) filter (where resp.response_type='accepted') as quote_accepted_at
  from public.quote q
  left join public.quote_version qv on qv.quote_id = q.id
  left join public.quote_response resp on resp.quote_version_id = qv.id
  where q.opportunity_id = o.id
) qm on true
left join lateral (
  select x.id, x.converted_at
  from public.conversion_record x
  where x.opportunity_id = o.id
  order by x.converted_at desc, x.id desc
  limit 1
) cr on true
left join lateral (
  select j.id, j.operational_status, j.created_at
  from public.operational_job j
  where j.conversion_record_id = cr.id
  order by j.created_at desc, j.id desc
  limit 1
) oj on true
left join public.invoice_request ir on ir.operational_job_id = oj.id
left join lateral (
  select sum(po.amount_observed) filter (where po.payment_status='reconciled' and po.is_test_provider=false) as reconciled_amount,
         max(po.settled_at) filter (where po.payment_status='reconciled' and po.is_test_provider=false) as reconciled_at
  from public.payment_observation po
  where po.invoice_request_id = ir.id
) pay on true;

revoke all on growth.prospect_funnel_analytics_v1 from public, anon, authenticated;
grant select on growth.prospect_funnel_analytics_v1 to service_role;

create or replace function public.growth_g5_funnel_summary(
  p_organization_id uuid,
  p_business_unit_id uuid default null,
  p_jurisdiction_id uuid default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null
)
returns table (
  source_lane text,
  country_code text,
  subdivision_code text,
  segment text,
  prospects bigint,
  verified bigint,
  outreach_attempted bigint,
  delivered bigint,
  replied bigint,
  positive_interest bigint,
  qualified bigint,
  handoff_completed bigint,
  opportunity_created bigint,
  quote_sent bigint,
  quote_accepted bigint,
  converted bigint,
  operational_job_created bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.source_lane,
    f.country_code,
    f.subdivision_code,
    f.segment,
    count(*)::bigint as prospects,
    count(*) filter (where f.verification_status='verified')::bigint as verified,
    count(*) filter (where coalesce(f.outreach_attempt_count,0)>0)::bigint as outreach_attempted,
    count(*) filter (where f.first_delivered_at is not null)::bigint as delivered,
    count(*) filter (where f.first_reply_at is not null)::bigint as replied,
    count(*) filter (where f.first_positive_interest_at is not null)::bigint as positive_interest,
    count(*) filter (where f.first_qualified_at is not null)::bigint as qualified,
    count(*) filter (where f.handoff_status='succeeded')::bigint as handoff_completed,
    count(*) filter (where f.serviceos_opportunity_id is not null)::bigint as opportunity_created,
    count(*) filter (where f.first_quote_sent_at is not null)::bigint as quote_sent,
    count(*) filter (where f.quote_accepted_at is not null)::bigint as quote_accepted,
    count(*) filter (where f.conversion_record_id is not null)::bigint as converted,
    count(*) filter (where f.operational_job_id is not null)::bigint as operational_job_created
  from growth.prospect_funnel_analytics_v1 f
  where f.organization_id = p_organization_id
    and (p_business_unit_id is null or f.business_unit_id = p_business_unit_id)
    and (p_jurisdiction_id is null or f.jurisdiction_id = p_jurisdiction_id)
    and (p_captured_from is null or f.captured_at >= p_captured_from)
    and (p_captured_to is null or f.captured_at < p_captured_to)
  group by f.source_lane, f.country_code, f.subdivision_code, f.segment
  order by count(*) desc, f.source_lane, f.segment;
$$;

revoke all on function public.growth_g5_funnel_summary(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_funnel_summary(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
