-- NON-PRODUCTION synthetic ServiceOS acceptance scope seed.
-- Purpose: provide representative Ontario and Arizona canonical scopes for Growth G1 OAT.
-- Ownership: ServiceOS governance/stabilization. Growth must not manufacture these records.
-- Prerequisite: run only against the ServiceOS acceptance project after OAT mutation approval.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF current_setting('serviceos.acceptance_approved', true) <> 'true' THEN
    RAISE EXCEPTION 'acceptance approval setting required';
  END IF;
END
$$;

DO $$
DECLARE
  v_org_id uuid;
  v_on_jur_id uuid;
  v_az_jur_id uuid;
  v_count integer;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organization
  WHERE code = 'TEST-W6-ORG'
    AND status = 'active';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'active TEST-W6-ORG acceptance organization required';
  END IF;

  INSERT INTO public.jurisdiction(
    code, country_code, subdivision_code, currency_code, timezone, metadata
  ) VALUES (
    'TEST-G1-ON-JUR', 'CA', 'ON', 'CAD', 'America/Toronto',
    '{"acceptance":true,"representative_market":"ON","purpose":"growth_g1_dual_market_oat","issue":34}'::jsonb
  )
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO public.jurisdiction(
    code, country_code, subdivision_code, currency_code, timezone, metadata
  ) VALUES (
    'TEST-G1-AZ-JUR', 'US', 'AZ', 'USD', 'America/Phoenix',
    '{"acceptance":true,"representative_market":"AZ","purpose":"growth_g1_dual_market_oat","issue":34}'::jsonb
  )
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_on_jur_id
  FROM public.jurisdiction
  WHERE code = 'TEST-G1-ON-JUR'
    AND country_code = 'CA'
    AND subdivision_code = 'ON'
    AND currency_code = 'CAD';

  IF v_on_jur_id IS NULL THEN
    RAISE EXCEPTION 'TEST-G1-ON-JUR exists with incompatible canonical market values';
  END IF;

  SELECT id INTO v_az_jur_id
  FROM public.jurisdiction
  WHERE code = 'TEST-G1-AZ-JUR'
    AND country_code = 'US'
    AND subdivision_code = 'AZ'
    AND currency_code = 'USD';

  IF v_az_jur_id IS NULL THEN
    RAISE EXCEPTION 'TEST-G1-AZ-JUR exists with incompatible canonical market values';
  END IF;

  IF v_on_jur_id = v_az_jur_id THEN
    RAISE EXCEPTION 'Ontario and Arizona jurisdiction IDs must be distinct';
  END IF;

  INSERT INTO public.business_unit(
    organization_id, jurisdiction_id, code, name, status, metadata
  ) VALUES (
    v_org_id, v_on_jur_id, 'TEST-G1-ON-BU',
    'TEST-G1 Ontario Representative Business Unit', 'active',
    '{"acceptance":true,"representative_market":"ON","purpose":"growth_g1_dual_market_oat","issue":34}'::jsonb
  )
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO public.business_unit(
    organization_id, jurisdiction_id, code, name, status, metadata
  ) VALUES (
    v_org_id, v_az_jur_id, 'TEST-G1-AZ-BU',
    'TEST-G1 Arizona Representative Business Unit', 'active',
    '{"acceptance":true,"representative_market":"AZ","purpose":"growth_g1_dual_market_oat","issue":34}'::jsonb
  )
  ON CONFLICT (organization_id, code) DO NOTHING;

  SELECT count(*) INTO v_count
  FROM public.business_unit
  WHERE organization_id = v_org_id
    AND code = 'TEST-G1-ON-BU'
    AND jurisdiction_id = v_on_jur_id
    AND status = 'active';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'exactly one active Ontario representative business unit required';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.business_unit
  WHERE organization_id = v_org_id
    AND code = 'TEST-G1-AZ-BU'
    AND jurisdiction_id = v_az_jur_id
    AND status = 'active';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'exactly one active Arizona representative business unit required';
  END IF;
END
$$;

COMMIT;
