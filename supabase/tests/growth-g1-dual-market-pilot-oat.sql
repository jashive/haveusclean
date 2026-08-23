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
-- Currency is canonical on public.jurisdiction.

begin;

do $$
begin
  if public.growth_gate_enabled('growth_outreach_enabled') then raise exception 'OAT STOP: outreach enabled'; end if;
  if public.growth_gate_enabled('growth_auto_followup_enabled') then raise exception 'OAT STOP: auto follow-up enabled'; end if;
  if public.growth_gate_enabled('growth_serviceos_handoff_enabled') then raise exception 'OAT STOP: ServiceOS handoff enabled'; end if;
end $$;

do $$
declare
  on_country text; on_subdivision text; on_currency text;
  az_country text; az_subdivision text; az_currency text;
begin
  select j.country_code,j.subdivision_code,j.currency_code
    into on_country,on_subdivision,on_currency
  from public.business_unit b join public.jurisdiction j on j.id=b.jurisdiction_id
  where b.id=:'on_business_unit_id'::uuid
    and b.organization_id=:'organization_id'::uuid
    and j.id=:'on_jurisdiction_id'::uuid
    and b.status='active';

  select j.country_code,j.subdivision_code,j.currency_code
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

-- The controlled loader/review sequence must execute before this assertion block.
-- Pilot records are identified only by the synthetic PILOT-* external key namespace.
do $$
declare
  v_total integer;
  v_on integer;
  v_az integer;
  v_cross_scope_duplicates integer;
  v_exact_duplicate integer;
  v_nonzero_intent integer;
  v_inferred_identity_accepts integer;
  v_review_ready integer;
  v_outreach_eligible integer;
begin
  select count(*) into v_total
  from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key like 'PILOT-%';
  if v_total <> 24 then
    raise exception 'OAT FAIL: expected 24 pilot prospects, found %', v_total;
  end if;

  select count(*) into v_on from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key like 'PILOT-%'
    and business_unit_id = :'on_business_unit_id'::uuid;
  select count(*) into v_az from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key like 'PILOT-%'
    and business_unit_id = :'az_business_unit_id'::uuid;
  if v_on <> 12 or v_az <> 12 then
    raise exception 'OAT FAIL: pilot market split must be 12 ON / 12 AZ, found % / %', v_on, v_az;
  end if;

  select count(*) into v_cross_scope_duplicates
  from growth.duplicate_review d
  join growth.prospect p on p.id = d.prospect_id
  join growth.prospect m on m.id = d.matched_prospect_id
  where p.external_prospect_key like 'PILOT-%'
    and m.external_prospect_key like 'PILOT-%'
    and p.business_unit_id <> m.business_unit_id;
  if v_cross_scope_duplicates <> 0 then
    raise exception 'OAT FAIL: cross-business-unit duplicate review detected';
  end if;

  select count(*) into v_exact_duplicate
  from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key = 'PILOT-ON-005'
    and lifecycle_status = 'suppressed'
    and duplicate_of_prospect_id is not null;
  if v_exact_duplicate <> 1 then
    raise exception 'OAT FAIL: deliberate exact duplicate was not suppressed';
  end if;

  select count(*) into v_nonzero_intent
  from growth.prospect_score s
  join growth.prospect p on p.id = s.prospect_id
  where p.external_prospect_key like 'PILOT-%'
    and s.is_current
    and s.intent_score <> 0;
  if v_nonzero_intent <> 0 then
    raise exception 'OAT FAIL: pilot intent score must remain zero without verified intent';
  end if;

  select count(*) into v_inferred_identity_accepts
  from growth.field_resolution r
  join growth.prospect p on p.id = r.prospect_id
  where p.external_prospect_key like 'PILOT-%'
    and r.is_inferred
    and r.decision = 'accepted'
    and r.field_name in ('website','normalized_domain','phone','address_line1','postal_code');
  if v_inferred_identity_accepts <> 0 then
    raise exception 'OAT FAIL: inferred identity resolution accepted';
  end if;

  select count(*) into v_review_ready
  from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key like 'PILOT-%'
    and lifecycle_status = 'review_ready';
  if v_review_ready <> 23 then
    raise exception 'OAT FAIL: expected 23 review_ready pilot prospects, found %', v_review_ready;
  end if;

  select count(*) into v_outreach_eligible
  from growth.prospect
  where organization_id = :'organization_id'::uuid
    and external_prospect_key like 'PILOT-%'
    and lifecycle_status = 'outreach_eligible';
  if v_outreach_eligible <> 0 then
    raise exception 'OAT FAIL: unexpected outreach-eligible pilot prospect';
  end if;

  if public.growth_gate_enabled('growth_outreach_enabled')
     or public.growth_gate_enabled('growth_auto_followup_enabled')
     or public.growth_gate_enabled('growth_serviceos_handoff_enabled') then
    raise exception 'OAT FAIL: downstream Growth gate enabled';
  end if;
end $$;

select
  'PASS' as oat_state,
  public.growth_gate_enabled('growth_outreach_enabled') as outreach_enabled,
  public.growth_gate_enabled('growth_auto_followup_enabled') as auto_followup_enabled,
  public.growth_gate_enabled('growth_serviceos_handoff_enabled') as handoff_enabled;

rollback;
