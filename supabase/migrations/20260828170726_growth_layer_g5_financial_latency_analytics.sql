create or replace view growth.prospect_financial_analytics_v1
with (security_invoker = true)
as
select
  f.prospect_id,
  f.organization_id,
  f.business_unit_id,
  f.jurisdiction_id,
  f.source_lane,
  f.country_code,
  f.subdivision_code,
  f.city,
  f.segment,
  f.facility_type,
  f.captured_at,
  f.marketing_source_id,
  f.marketing_source_code,
  f.campaign_id,
  f.campaign_code,
  f.operational_job_id,
  f.invoice_request_id,
  f.invoice_request_status,
  f.invoice_currency_code,
  f.invoice_total_amount,
  f.reconciled_amount,
  f.reconciled_at,
  j.currency_code as profitability_currency_code,
  j.recognized_revenue_amount,
  j.direct_labor_cost,
  j.other_direct_cost,
  j.gross_contribution,
  j.gross_margin_percent,
  j.snapshot_taken_at as profitability_snapshot_taken_at,
  case
    when f.invoice_currency_code is not null and j.currency_code is not null
      then f.invoice_currency_code = j.currency_code
    else null
  end as currency_lineage_matches
from growth.prospect_funnel_analytics_v1 f
left join lateral (
  select
    s.currency_code,
    s.recognized_revenue_amount,
    s.direct_labor_cost,
    s.other_direct_cost,
    s.gross_contribution,
    s.gross_margin_percent,
    s.snapshot_taken_at
  from public.job_profitability_snapshot s
  where s.operational_job_id = f.operational_job_id
  order by s.snapshot_taken_at desc, s.id desc
  limit 1
) j on true;

revoke all on growth.prospect_financial_analytics_v1 from public, anon, authenticated;
grant select on growth.prospect_financial_analytics_v1 to service_role;

create or replace function public.growth_g5_financial_summary(
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
  currency_code text,
  invoiced_prospects bigint,
  invoice_total numeric,
  reconciled_payments numeric,
  profitability_snapshots bigint,
  recognized_revenue numeric,
  direct_labor_cost numeric,
  other_direct_cost numeric,
  gross_contribution numeric,
  weighted_gross_margin_percent numeric,
  currency_mismatch_records bigint
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
    f.invoice_currency_code as currency_code,
    count(*) filter (where f.invoice_request_id is not null)::bigint as invoiced_prospects,
    coalesce(sum(f.invoice_total_amount),0)::numeric as invoice_total,
    coalesce(sum(f.reconciled_amount),0)::numeric as reconciled_payments,
    count(*) filter (where f.profitability_snapshot_taken_at is not null and f.currency_lineage_matches is true)::bigint as profitability_snapshots,
    coalesce(sum(f.recognized_revenue_amount) filter (where f.currency_lineage_matches is true),0)::numeric as recognized_revenue,
    coalesce(sum(f.direct_labor_cost) filter (where f.currency_lineage_matches is true),0)::numeric as direct_labor_cost,
    coalesce(sum(f.other_direct_cost) filter (where f.currency_lineage_matches is true),0)::numeric as other_direct_cost,
    coalesce(sum(f.gross_contribution) filter (where f.currency_lineage_matches is true),0)::numeric as gross_contribution,
    case
      when coalesce(sum(f.recognized_revenue_amount) filter (where f.currency_lineage_matches is true),0) > 0
      then round(
        100 * coalesce(sum(f.gross_contribution) filter (where f.currency_lineage_matches is true),0)
        / nullif(sum(f.recognized_revenue_amount) filter (where f.currency_lineage_matches is true),0),
        2
      )
      else null
    end as weighted_gross_margin_percent,
    count(*) filter (where f.currency_lineage_matches is false)::bigint as currency_mismatch_records
  from growth.prospect_financial_analytics_v1 f
  where f.organization_id = p_organization_id
    and f.invoice_currency_code is not null
    and (p_business_unit_id is null or f.business_unit_id = p_business_unit_id)
    and (p_jurisdiction_id is null or f.jurisdiction_id = p_jurisdiction_id)
    and (p_captured_from is null or f.captured_at >= p_captured_from)
    and (p_captured_to is null or f.captured_at < p_captured_to)
  group by f.source_lane, f.country_code, f.subdivision_code, f.segment, f.invoice_currency_code
  order by f.country_code, f.subdivision_code, f.source_lane, f.segment, f.invoice_currency_code;
$$;

revoke all on function public.growth_g5_financial_summary(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_financial_summary(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;

create or replace function public.growth_g5_latency_summary(
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
  avg_hours_to_first_outreach numeric,
  avg_hours_to_first_reply numeric,
  avg_hours_to_qualification numeric,
  avg_hours_to_opportunity numeric,
  avg_hours_to_quote numeric,
  avg_hours_to_acceptance numeric,
  avg_hours_to_conversion numeric
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
    round(avg(extract(epoch from (f.first_attempt_at - f.captured_at))/3600) filter (where f.first_attempt_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.first_reply_at - f.captured_at))/3600) filter (where f.first_reply_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.first_qualified_at - f.captured_at))/3600) filter (where f.first_qualified_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.opportunity_created_at - f.captured_at))/3600) filter (where f.opportunity_created_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.first_quote_sent_at - f.captured_at))/3600) filter (where f.first_quote_sent_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.quote_accepted_at - f.captured_at))/3600) filter (where f.quote_accepted_at >= f.captured_at),2)::numeric,
    round(avg(extract(epoch from (f.converted_at - f.captured_at))/3600) filter (where f.converted_at >= f.captured_at),2)::numeric
  from growth.prospect_funnel_analytics_v1 f
  where f.organization_id = p_organization_id
    and (p_business_unit_id is null or f.business_unit_id = p_business_unit_id)
    and (p_jurisdiction_id is null or f.jurisdiction_id = p_jurisdiction_id)
    and (p_captured_from is null or f.captured_at >= p_captured_from)
    and (p_captured_to is null or f.captured_at < p_captured_to)
  group by f.source_lane, f.country_code, f.subdivision_code, f.segment
  order by f.country_code, f.subdivision_code, f.source_lane, f.segment;
$$;

revoke all on function public.growth_g5_latency_summary(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_latency_summary(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
