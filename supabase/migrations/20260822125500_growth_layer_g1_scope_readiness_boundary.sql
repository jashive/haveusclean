-- Growth Layer 1.0 / live canonical scope-readiness boundary.
-- Read-only and service-role-only. Does not create or repair ServiceOS canonical scope.

begin;

create or replace function public.growth_g1_scope_readiness(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_count integer := 0;
  v_az_count integer := 0;
  v_on jsonb;
  v_az jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_ready boolean := false;
begin
  if p_organization_id is null then
    raise exception 'growth scope readiness: organization_id required';
  end if;

  select count(*) into v_on_count
  from public.business_unit b
  join public.jurisdiction j on j.id = b.jurisdiction_id
  where b.organization_id = p_organization_id
    and b.status = 'active'
    and j.country_code = 'CA'
    and j.subdivision_code = 'ON'
    and j.currency_code = 'CAD';

  select count(*) into v_az_count
  from public.business_unit b
  join public.jurisdiction j on j.id = b.jurisdiction_id
  where b.organization_id = p_organization_id
    and b.status = 'active'
    and j.country_code = 'US'
    and j.subdivision_code = 'AZ'
    and j.currency_code = 'USD';

  if v_on_count = 1 then
    select jsonb_build_object(
      'organization_id', b.organization_id,
      'business_unit_id', b.id,
      'business_unit_code', b.code,
      'business_unit_status', b.status,
      'jurisdiction_id', j.id,
      'jurisdiction_code', j.code,
      'country_code', j.country_code,
      'subdivision_code', j.subdivision_code,
      'currency_code', j.currency_code
    ) into v_on
    from public.business_unit b
    join public.jurisdiction j on j.id = b.jurisdiction_id
    where b.organization_id = p_organization_id
      and b.status = 'active'
      and j.country_code = 'CA'
      and j.subdivision_code = 'ON'
      and j.currency_code = 'CAD';
  end if;

  if v_az_count = 1 then
    select jsonb_build_object(
      'organization_id', b.organization_id,
      'business_unit_id', b.id,
      'business_unit_code', b.code,
      'business_unit_status', b.status,
      'jurisdiction_id', j.id,
      'jurisdiction_code', j.code,
      'country_code', j.country_code,
      'subdivision_code', j.subdivision_code,
      'currency_code', j.currency_code
    ) into v_az
    from public.business_unit b
    join public.jurisdiction j on j.id = b.jurisdiction_id
    where b.organization_id = p_organization_id
      and b.status = 'active'
      and j.country_code = 'US'
      and j.subdivision_code = 'AZ'
      and j.currency_code = 'USD';
  end if;

  if v_on_count = 0 then
    v_reasons := v_reasons || jsonb_build_array('ontario_scope_missing');
  elsif v_on_count > 1 then
    v_reasons := v_reasons || jsonb_build_array('ontario_scope_ambiguous');
  end if;

  if v_az_count = 0 then
    v_reasons := v_reasons || jsonb_build_array('arizona_scope_missing');
  elsif v_az_count > 1 then
    v_reasons := v_reasons || jsonb_build_array('arizona_scope_ambiguous');
  end if;

  if v_on_count = 1 and v_az_count = 1 then
    if v_on->>'business_unit_id' = v_az->>'business_unit_id' then
      v_reasons := v_reasons || jsonb_build_array('business_units_not_distinct');
    end if;
    if v_on->>'jurisdiction_id' = v_az->>'jurisdiction_id' then
      v_reasons := v_reasons || jsonb_build_array('jurisdictions_not_distinct');
    end if;
  end if;

  v_ready := jsonb_array_length(v_reasons) = 0;

  return jsonb_build_object(
    'status', case when v_ready then 'READY' else 'BLOCKED' end,
    'ready', v_ready,
    'reasons', v_reasons,
    'required', jsonb_build_object(
      'ON', jsonb_build_object('country_code','CA','subdivision_code','ON','currency_code','CAD'),
      'AZ', jsonb_build_object('country_code','US','subdivision_code','AZ','currency_code','USD')
    ),
    'scopes', jsonb_build_object('ON', v_on, 'AZ', v_az),
    'candidate_counts', jsonb_build_object('ON', v_on_count, 'AZ', v_az_count),
    'may_load_pilot', v_ready,
    'may_enable_outreach', false,
    'may_enable_auto_followup', false,
    'may_enable_handoff', false
  );
end;
$$;

revoke all on function public.growth_g1_scope_readiness(uuid) from public, anon, authenticated;
grant execute on function public.growth_g1_scope_readiness(uuid) to service_role;

comment on function public.growth_g1_scope_readiness(uuid)
  is 'Service-role-only read-only Growth G1 readiness check for governed Ontario CA/ON/CAD and Arizona US/AZ/USD canonical acceptance scopes.';

commit;
