create or replace function public.growth_g5_dashboard_snapshot(
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
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version','g5-dashboard-v1',
    'cohort_anchor','growth.prospect.captured_at',
    'currency_policy','separate_by_invoice_currency',
    'filters', jsonb_build_object(
      'organization_id', p_organization_id,
      'business_unit_id', p_business_unit_id,
      'jurisdiction_id', p_jurisdiction_id,
      'captured_from', p_captured_from,
      'captured_to', p_captured_to
    ),
    'funnel', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.country_code, x.subdivision_code, x.source_lane, x.segment)
      from public.growth_g5_funnel_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x
    ),'[]'::jsonb),
    'latency', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.country_code, x.subdivision_code, x.source_lane, x.segment)
      from public.growth_g5_latency_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x
    ),'[]'::jsonb),
    'financial', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.country_code, x.subdivision_code, x.source_lane, x.segment, x.currency_code)
      from public.growth_g5_financial_summary(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_captured_from,p_captured_to) x
    ),'[]'::jsonb)
  );
$$;

revoke all on function public.growth_g5_dashboard_snapshot(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_dashboard_snapshot(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
