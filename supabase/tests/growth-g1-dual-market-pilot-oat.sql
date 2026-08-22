-- Growth Layer 1.0 dual-market completion OAT.
-- DO NOT RUN until ServiceOS governance supplies canonical acceptance scope IDs.
-- This file is intentionally parameterized and contains no production IDs.
-- Required psql variables:
--   :organization_id
--   :on_business_unit_id
--   :on_jurisdiction_id
--   :az_business_unit_id
--   :az_jurisdiction_id
--
-- Required governed scope invariants:
-- Ontario = CA / ON / CAD
-- Arizona = US / AZ / USD
--
-- Safety gates must remain OFF throughout:
-- growth_outreach_enabled
-- growth_auto_followup_enabled
-- growth_serviceos_handoff_enabled

begin;

-- Fail closed if any downstream feature is enabled.
do $$
begin
  if public.growth_gate_enabled('growth_outreach_enabled') then raise exception 'OAT STOP: outreach enabled'; end if;
  if public.growth_gate_enabled('growth_auto_followup_enabled') then raise exception 'OAT STOP: auto follow-up enabled'; end if;
  if public.growth_gate_enabled('growth_serviceos_handoff_enabled') then raise exception 'OAT STOP: ServiceOS handoff enabled'; end if;
end $$;

-- Verify governed jurisdiction identity.
do $$
declare
  on_country text; on_subdivision text; on_currency text;
  az_country text; az_subdivision text; az_currency text;
begin
  select j.country_code,j.subdivision_code,b.currency_code
    into on_country,on_subdivision,on_currency
  from public.business_unit b join public.jurisdiction j on j.id=b.jurisdiction_id
  where b.id=:'on_business_unit_id'::uuid
    and b.organization_id=:'organization_id'::uuid
    and j.id=:'on_jurisdiction_id'::uuid
    and b.status='active';

  select j.country_code,j.subdivision_code,b.currency_code
    into az_country,az_subdivision,az_currency
  from public.business_unit b join public.jurisdiction j on j.id=b.jurisdiction_id
  where b.id=:'az_business_unit_id'::uuid
    and b.organization_id=:'organization_id'::uuid
    and j.id=:'az_jurisdiction_id'::uuid
    and b.status='active';

  if on_country <> 'CA' or on_subdivision <> 'ON' or on_currency <> 'CAD' then
    raise exception 'OAT STOP: Ontario canonical scope mismatch';
  end if;
  if az_country <> 'US' or az_subdivision <> 'AZ' or az_currency <> 'USD' then
    raise exception 'OAT STOP: Arizona canonical scope mismatch';
  end if;
  if :'on_business_unit_id'::uuid = :'az_business_unit_id'::uuid then
    raise exception 'OAT STOP: ON/AZ business units must be distinct';
  end if;
  if :'on_jurisdiction_id'::uuid = :'az_jurisdiction_id'::uuid then
    raise exception 'OAT STOP: ON/AZ jurisdictions must be distinct';
  end if;
end $$;

-- The executable pilot loader is intentionally not embedded here.
-- The controlled loader must normalize tests/fixtures/growthG1PilotFixture.js
-- with the governed scope map and call only Growth G1 service-role RPCs / Edge API.
-- Acceptance criteria are defined in docs/growth/g1-pilot-runbook.md.

-- Final invariants after the controlled loader/review sequence:
-- 1. 24/24 synthetic fixtures exist only in Growth and correct business unit.
-- 2. No cross-business-unit duplicate review exists.
-- 3. Exact duplicate test is suppressed.
-- 4. Shared-domain tests are not auto-confirmed exact solely from domain.
-- 5. Intent score remains zero absent verified intent evidence.
-- 6. Inferred evidence has not updated identity fields.
-- 7. Human-completed unique records end at review_ready.
-- 8. No prospect is outreach_eligible.
-- 9. No ServiceOS service_request/opportunity/estimate/quote/conversion/job/finance
--    record has been originated by Growth.
-- 10. Outbound, auto-follow-up and handoff gates remain OFF.

select
  'READY_FOR_GOVERNED_SCOPE_EXECUTION' as oat_state,
  public.growth_gate_enabled('growth_outreach_enabled') as outreach_enabled,
  public.growth_gate_enabled('growth_auto_followup_enabled') as auto_followup_enabled,
  public.growth_gate_enabled('growth_serviceos_handoff_enabled') as handoff_enabled;

rollback;
