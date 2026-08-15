-- =============================================================================
-- ACCEPTANCE FIXTURE 011 — WAVE 4 PREVIEW ACCEPTANCE (PERSISTENT, SOURCE-ONLY)
-- Marker: wave4_preview_acceptance_fixture_v1
-- =============================================================================
-- This file is SOURCE ONLY and must be reviewed before execution.
-- It is additive, deterministic, preview-only, and does not modify ON-2026-08-v1.0.
-- DO NOT EXECUTE AGAINST PRODUCTION. DO NOT RUN PREVIEW.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_prod_cfg_count integer;
  v_prod_cfg_id uuid;
  v_prod_cfg_snapshot jsonb;
  v_prod_cfg_snapshot_after jsonb;
  v_org_id uuid;
  v_bu_id uuid;
  v_jur_id uuid;

  v_preview_cfg_count integer;
  v_preview_cfg_id uuid;

  v_worker_ok_count integer;
  v_policy_count integer;

  v_scope_row_count integer;
  v_scope_mismatch_count integer;
  v_failed_qa_status text;

  v_qv_status text;
  v_wa_status text;
  v_wo_status text;
  v_oj_status text;
  v_reinspect_count integer;
  v_w4_applicability_count integer;
  v_w4_gov_link_count integer;
  v_w4_evidence_req_count integer;
  v_completion_evidence_count integer;
  v_service_exception_count integer;
  v_corrective_action_count integer;
  v_customer_outcome_count integer;

  c_worker_id constant uuid := '1b3a6903-0c50-4a95-afc3-280628c10508'::uuid;

  c_customer_id constant uuid := 'e1100000-0000-0000-0000-000000000002'::uuid;
  c_contact_id constant uuid := 'e1100000-0000-0000-0000-000000000003'::uuid;
  c_service_location_id constant uuid := 'e1100000-0000-0000-0000-000000000004'::uuid;
  c_service_request_id constant uuid := 'e1100000-0000-0000-0000-000000000005'::uuid;
  c_opportunity_id constant uuid := 'e1100000-0000-0000-0000-000000000006'::uuid;
  c_estimate_id constant uuid := 'e1100000-0000-0000-0000-000000000007'::uuid;
  c_quote_id constant uuid := 'e1100000-0000-0000-0000-000000000008'::uuid;
  c_pricing_snapshot_id constant uuid := 'e1100000-0000-0000-0000-000000000009'::uuid;
  c_quote_version_id constant uuid := 'e1100000-0000-0000-0000-00000000000a'::uuid;
  c_quote_response_id constant uuid := 'e1100000-0000-0000-0000-00000000000b'::uuid;
  c_conversion_record_id constant uuid := 'e1100000-0000-0000-0000-00000000000c'::uuid;
  c_job_handoff_id constant uuid := 'e1100000-0000-0000-0000-00000000000d'::uuid;

  c_operational_job_id constant uuid := 'e1100000-0000-0000-0000-00000000000e'::uuid;
  c_schedule_window_id constant uuid := 'e1100000-0000-0000-0000-00000000000f'::uuid;
  c_worker_assignment_id constant uuid := 'e1100000-0000-0000-0000-000000000010'::uuid;
  c_work_order_id constant uuid := 'e1100000-0000-0000-0000-000000000011'::uuid;
  c_failed_qa_inspection_id constant uuid := 'e1100000-0000-0000-0000-000000000012'::uuid;

  c_required_evidence_policy_id constant uuid := 'e1100000-0000-0000-0000-000000000013'::uuid;
  c_preview_cfg_id constant uuid := 'e1100000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1) Resolve authoritative production scope and capture full-row snapshot.
  --    MUST NOT mutate this row. Compared again before COMMIT.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_prod_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';

  IF v_prod_cfg_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture: expected exactly one published residential_pricing ON-2026-08-v1.0 row, found %', v_prod_cfg_count;
  END IF;

  SELECT cv.id, cv.organization_id, cv.business_unit_id, cv.jurisdiction_id,
         to_jsonb(cv)
    INTO v_prod_cfg_id, v_org_id, v_bu_id, v_jur_id, v_prod_cfg_snapshot
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';

  -- -------------------------------------------------------------------------
  -- 2) Pre-commit fail-closed: W4 governance/materialization rows must be
  --    absent for this fixture scope. Do NOT delete them; FAIL CLOSED.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_w4_applicability_count
  FROM public.work_order_wave4_applicability woa
  WHERE woa.operational_job_id = c_operational_job_id
     OR woa.work_order_id = c_work_order_id;

  IF v_w4_applicability_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: work_order_wave4_applicability already has % row(s) for fixture scope — contamination detected, ABORTING', v_w4_applicability_count;
  END IF;

  SELECT COUNT(*) INTO v_w4_gov_link_count
  FROM public.work_order_governance_link wogl
  WHERE wogl.operational_job_id = c_operational_job_id
     OR wogl.work_order_id = c_work_order_id;

  IF v_w4_gov_link_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: work_order_governance_link already has % row(s) for fixture scope — contamination detected, ABORTING', v_w4_gov_link_count;
  END IF;

  SELECT COUNT(*) INTO v_w4_evidence_req_count
  FROM public.work_order_evidence_requirement woer
  WHERE woer.operational_job_id = c_operational_job_id
     OR woer.work_order_id = c_work_order_id;

  IF v_w4_evidence_req_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: work_order_evidence_requirement already has % row(s) for fixture scope — contamination detected, ABORTING', v_w4_evidence_req_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3) Pre-commit fail-closed: runtime result artifacts must be absent.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_completion_evidence_count
  FROM public.completion_evidence ce
  WHERE ce.operational_job_id = c_operational_job_id
     OR ce.work_order_id = c_work_order_id;

  IF v_completion_evidence_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: completion_evidence has % row(s) for fixture scope — contamination detected, ABORTING', v_completion_evidence_count;
  END IF;

  SELECT COUNT(*) INTO v_service_exception_count
  FROM public.service_exception se
  WHERE se.operational_job_id = c_operational_job_id
     OR se.work_order_id = c_work_order_id;

  IF v_service_exception_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: service_exception has % row(s) for fixture scope — contamination detected, ABORTING', v_service_exception_count;
  END IF;

  SELECT COUNT(*) INTO v_corrective_action_count
  FROM public.corrective_action ca
  WHERE ca.operational_job_id = c_operational_job_id
     OR ca.work_order_id = c_work_order_id;

  IF v_corrective_action_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: corrective_action has % row(s) for fixture scope — contamination detected, ABORTING', v_corrective_action_count;
  END IF;

  SELECT COUNT(*) INTO v_customer_outcome_count
  FROM public.customer_outcome co
  WHERE co.operational_job_id = c_operational_job_id
     OR co.work_order_id = c_work_order_id;

  IF v_customer_outcome_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture FAIL: customer_outcome has % row(s) for fixture scope — contamination detected, ABORTING', v_customer_outcome_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4) Require existing canonical worker (Maria Santos id) in same scope.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_worker_ok_count
  FROM public.worker w
  WHERE w.id = c_worker_id
    AND w.organization_id = v_org_id
    AND (w.business_unit_id IS NULL OR w.business_unit_id = v_bu_id)
    AND w.status = 'active';

  IF v_worker_ok_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture: worker % must exist as active in fixture scope', c_worker_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- 5) Resolve or create isolated preview configuration_version.
  --    Unique key: (organization_id, configuration_type, version) — NOT BU/jur.
  --    Status must NOT be published. configuration must be explicitly preview/test.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_preview_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.organization_id = v_org_id;

  IF v_preview_cfg_count > 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture: multiple preview configuration_version rows found for W4-PREVIEW-ACCEPT-2026-08-v1';
  END IF;

  IF v_preview_cfg_count = 1 THEN
    -- Row exists: resolve it and fail closed unless it matches intended HUC-ON scope
    -- and is not published, and carries correct preview markers.
    SELECT cv.id INTO v_preview_cfg_id
    FROM public.configuration_version cv
    WHERE cv.configuration_type = 'residential_pricing'
      AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
      AND cv.organization_id = v_org_id;

    PERFORM 1
    FROM public.configuration_version cv
    WHERE cv.id = v_preview_cfg_id
      AND cv.business_unit_id IS NOT DISTINCT FROM v_bu_id
      AND cv.jurisdiction_id IS NOT DISTINCT FROM v_jur_id
      AND cv.status <> 'published'
      AND cv.configuration ->> 'environment' = 'preview'
      AND cv.configuration ->> 'purpose' = 'wave4_acceptance'
      AND COALESCE((cv.configuration ->> 'production_rule')::boolean, true) = false
      AND COALESCE((cv.configuration ->> 'test_fixture')::boolean, false) = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'W4 Preview fixture FAIL: existing preview configuration_version does not match intended HUC-ON scope or preview markers — ABORTING';
    END IF;
  ELSE
    INSERT INTO public.configuration_version (
      id,
      organization_id,
      business_unit_id,
      jurisdiction_id,
      configuration_type,
      version,
      status,
      effective_from,
      effective_to,
      configuration
    )
    SELECT
      c_preview_cfg_id,
      cv.organization_id,
      cv.business_unit_id,
      cv.jurisdiction_id,
      cv.configuration_type,
      'W4-PREVIEW-ACCEPT-2026-08-v1',
      'draft',
      now(),
      NULL,
      COALESCE(cv.configuration, '{}'::jsonb)
      || jsonb_build_object(
           'environment', 'preview',
           'purpose', 'wave4_acceptance',
           'production_rule', false,
           'test_fixture', true,
           'fixture_marker', 'wave4_preview_acceptance_fixture_v1',
           'governance_authority', jsonb_build_object(
             'decision', 'DEC-020',
             'decision_alt', 'DEC-021',
             'wave4_implementation_control_id', '1cNWVQVPFWfj_LookYPHIWPZMrUPSp4pTlexEO4NrTz4',
             'ast_001_document_id', '1FvaCITuKe-soQBLtG-gIc_OprM7ylrrf',
             'ast_003_document_id', '1s7sAXimiEcGaATiobEmKqEW1R6j9_JKJ'
           )
         )
    FROM public.configuration_version cv
    WHERE cv.id = v_prod_cfg_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.configuration_version c2
        WHERE c2.id = c_preview_cfg_id
      );

    v_preview_cfg_id := c_preview_cfg_id;
  END IF;

  IF v_preview_cfg_id IS NULL THEN
    RAISE EXCEPTION 'W4 Preview fixture: unable to resolve preview configuration_version';
  END IF;

  -- -------------------------------------------------------------------------
  -- 6) Insert minimal Wave 2 lineage only if missing (deterministic IDs).
  -- -------------------------------------------------------------------------
  INSERT INTO public.customer (
    id, organization_id, business_unit_id,
    customer_type, display_name, legal_name, status, notes, metadata
  )
  SELECT
    c_customer_id,
    v_org_id,
    v_bu_id,
    'person',
    'Wave 4 Preview Acceptance Customer',
    NULL,
    'active',
    NULL,
    '{"fixture":"wave4_preview_acceptance","test_fixture":true,"production_rule":false,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.customer c WHERE c.id = c_customer_id);

  INSERT INTO public.contact (
    id, customer_id, contact_type,
    first_name, last_name, email, phone, is_primary, metadata
  )
  SELECT
    c_contact_id,
    c_customer_id,
    'primary',
    'Preview',
    'Operator',
    NULL,
    NULL,
    true,
    '{"fixture":"wave4_preview_acceptance","test_fixture":true,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.contact c WHERE c.id = c_contact_id);

  INSERT INTO public.service_location (
    id, customer_id, jurisdiction_id,
    label, address_line1, address_line2, city, subdivision, postal_code,
    country_code, access_notes, latitude, longitude, metadata
  )
  SELECT
    c_service_location_id,
    c_customer_id,
    v_jur_id,
    'Wave 4 Preview Acceptance Location',
    '11 Preview Fixture Way',
    NULL,
    'Toronto',
    'ON',
    'M5V 2B2',
    'CA',
    NULL,
    NULL,
    NULL,
    '{"fixture":"wave4_preview_acceptance","test_fixture":true,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.service_location sl WHERE sl.id = c_service_location_id);

  INSERT INTO public.service_request (
    id, organization_id, business_unit_id,
    service_category, lifecycle_status, intake_channel, requested_at,
    title, description, requirements, metadata
  )
  SELECT
    c_service_request_id,
    v_org_id,
    v_bu_id,
    'residential',
    'qualified',
    'wave4_preview_acceptance_fixture',
    now(),
    'Wave 4 Preview Acceptance Request',
    'Preview-only fixture chain for ServiceOS Wave 4 acceptance',
    '{"test_fixture":true,"production_rule":false,"purpose":"wave4_acceptance"}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.service_request sr WHERE sr.id = c_service_request_id);

  INSERT INTO public.opportunity (
    id, organization_id, business_unit_id,
    service_request_id, stage, close_reason, expected_close_date,
    probability_percent, title, summary, metadata
  )
  SELECT
    c_opportunity_id,
    v_org_id,
    v_bu_id,
    c_service_request_id,
    'qualified',
    NULL,
    NULL,
    NULL,
    'Wave 4 Preview Acceptance Opportunity',
    'Preview-only fixture lineage',
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.opportunity o WHERE o.id = c_opportunity_id);

  INSERT INTO public.estimate (
    id, organization_id, business_unit_id,
    opportunity_id, estimate_number, version_no, lifecycle_status,
    assumptions, scope_snapshot, notes, metadata
  )
  SELECT
    c_estimate_id,
    v_org_id,
    v_bu_id,
    c_opportunity_id,
    NULL,
    1,
    'prepared',
    '{"fixture":true}'::jsonb,
    '{"service":"residential_preview","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb,
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.estimate e WHERE e.id = c_estimate_id);

  INSERT INTO public.quote (
    id, organization_id, business_unit_id,
    opportunity_id, estimate_id, quote_number, lifecycle_status,
    customer_id, contact_id, service_location_id, metadata
  )
  SELECT
    c_quote_id,
    v_org_id,
    v_bu_id,
    c_opportunity_id,
    c_estimate_id,
    NULL,
    'active',
    NULL,
    NULL,
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.quote q WHERE q.id = c_quote_id);

  INSERT INTO public.pricing_snapshot (
    id, organization_id, business_unit_id,
    opportunity_id, estimate_id,
    configuration_version_id,
    currency_code,
    tax_name, tax_rate,
    subtotal_amount, discount_amount, tax_amount, total_amount,
    calculator_version,
    configuration_snapshot,
    labor_economics,
    calculation_inputs, calculation_outputs, raw_calculation_snapshot,
    frozen_at, metadata
  )
  SELECT
    c_pricing_snapshot_id,
    v_org_id,
    v_bu_id,
    c_opportunity_id,
    c_estimate_id,
    v_prod_cfg_id,
    'CAD',
    'HST', 0.13,
    -- SYNTHETIC test-fixture monetary values. NOT production pricing.
    -- References authoritative ON-2026-08-v1.0 config lineage as designed.
    220.00, 0.00, 28.60, 248.60,
    '2.0',
    '{"version":"ON-2026-08-v1.0","fixture":"wave4_preview_acceptance","synthetic":true}'::jsonb,
    '{}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","synthetic":true}'::jsonb,
    '{"total":248.60,"currency":"CAD","synthetic":true}'::jsonb,
    '{"fixture":"wave4_preview_acceptance_fixture_v1","synthetic":true}'::jsonb,
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1","synthetic":true}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.pricing_snapshot ps WHERE ps.id = c_pricing_snapshot_id);

  -- ── Quote lifecycle: M010-proven pattern: draft → sent → accepted ──────────
  INSERT INTO public.quote_version (
    id, organization_id, business_unit_id,
    quote_id, estimate_id, pricing_snapshot_id,
    version_no, lifecycle_status, valid_until, title, terms_text,
    line_items_snapshot, commercial_snapshot, sent_at, metadata
  )
  SELECT
    c_quote_version_id,
    v_org_id,
    v_bu_id,
    c_quote_id,
    c_estimate_id,
    c_pricing_snapshot_id,
    1,
    'draft',
    NULL,
    'Wave 4 Preview Acceptance Quote',
    NULL,
    '[{"key":"preview_fixture_service","amount":220.00,"synthetic":true}]'::jsonb,
    '{"total":248.60,"fixture":"wave4_preview_acceptance_fixture_v1","synthetic":true}'::jsonb,
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.quote_version qv WHERE qv.id = c_quote_version_id);

  UPDATE public.quote_version
     SET lifecycle_status = 'sent',
         sent_at = now()
   WHERE id = c_quote_version_id
     AND lifecycle_status = 'draft';

  INSERT INTO public.quote_response (
    id, organization_id, business_unit_id,
    quote_version_id, idempotency_key_id,
    response_type, response_channel, responded_by_name, responded_by_email,
    responded_at, notes, metadata
  )
  SELECT
    c_quote_response_id,
    v_org_id,
    v_bu_id,
    c_quote_version_id,
    NULL,
    'accepted',
    'wave4_preview_acceptance_fixture',
    'Wave 4 Preview Fixture',
    NULL,
    now(),
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.quote_response qr WHERE qr.id = c_quote_response_id);

  UPDATE public.quote_version
     SET lifecycle_status = 'accepted'
   WHERE id = c_quote_version_id
     AND lifecycle_status = 'sent';

  INSERT INTO public.conversion_record (
    id, organization_id, business_unit_id,
    service_request_id, opportunity_id, estimate_id,
    quote_id, quote_version_id, quote_response_id,
    customer_id, contact_id, service_location_id, metadata
  )
  SELECT
    c_conversion_record_id,
    v_org_id,
    v_bu_id,
    c_service_request_id,
    c_opportunity_id,
    c_estimate_id,
    c_quote_id,
    c_quote_version_id,
    c_quote_response_id,
    c_customer_id,
    c_contact_id,
    c_service_location_id,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.conversion_record cr WHERE cr.id = c_conversion_record_id);

  INSERT INTO public.job_handoff (
    id, organization_id, business_unit_id,
    conversion_record_id, quote_version_id, pricing_snapshot_id,
    handoff_status, handoff_payload, metadata
  )
  SELECT
    c_job_handoff_id,
    v_org_id,
    v_bu_id,
    c_conversion_record_id,
    c_quote_version_id,
    c_pricing_snapshot_id,
    'ready',
    '{"fixture":"wave4_preview_acceptance","synthetic":true}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.job_handoff jh WHERE jh.id = c_job_handoff_id);

  -- ── Operational job lifecycle: M007-proven forward transitions ─────────────
  -- ready_to_schedule → scheduled → dispatched → in_progress → service_complete → qa_pending
  INSERT INTO public.operational_job (
    id, organization_id, business_unit_id, jurisdiction_id,
    job_handoff_id, conversion_record_id, quote_version_id, pricing_snapshot_id,
    customer_id, contact_id, service_location_id, service_family,
    operational_status, service_scope_snapshot, commercial_authority_snapshot, metadata
  )
  SELECT
    c_operational_job_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    c_job_handoff_id,
    c_conversion_record_id,
    c_quote_version_id,
    c_pricing_snapshot_id,
    c_customer_id,
    c_contact_id,
    c_service_location_id,
    'residential',
    'ready_to_schedule',
    '{"fixture":"wave4_preview_acceptance","service":"residential"}'::jsonb,
    '{"pricing_snapshot_id":"e1100000-0000-0000-0000-000000000009","quote_version_id":"e1100000-0000-0000-0000-00000000000a","fixture":"wave4_preview_acceptance"}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","preview_only":true,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.operational_job oj WHERE oj.id = c_operational_job_id);

  UPDATE public.operational_job SET operational_status = 'scheduled'      WHERE id = c_operational_job_id AND operational_status = 'ready_to_schedule';
  UPDATE public.operational_job SET operational_status = 'dispatched'     WHERE id = c_operational_job_id AND operational_status = 'scheduled';
  UPDATE public.operational_job SET operational_status = 'in_progress'    WHERE id = c_operational_job_id AND operational_status = 'dispatched';
  UPDATE public.operational_job SET operational_status = 'service_complete' WHERE id = c_operational_job_id AND operational_status = 'in_progress';
  UPDATE public.operational_job SET operational_status = 'qa_pending'     WHERE id = c_operational_job_id AND operational_status = 'service_complete';

  INSERT INTO public.schedule_window (
    id, organization_id, business_unit_id, jurisdiction_id, operational_job_id,
    scheduled_start, scheduled_end, timezone, status, metadata
  )
  SELECT
    c_schedule_window_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    c_operational_job_id,
    now() + interval '1 day',
    now() + interval '1 day 2 hours',
    'America/Toronto',
    'confirmed',
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.schedule_window sw WHERE sw.id = c_schedule_window_id);

  -- ── Worker assignment lifecycle: proposed → assigned → acknowledged ─────────
  INSERT INTO public.worker_assignment (
    id, organization_id, business_unit_id, operational_job_id, schedule_window_id,
    worker_id, assignment_role, assignment_status,
    assigned_at, acknowledged_at, metadata
  )
  SELECT
    c_worker_assignment_id,
    v_org_id,
    v_bu_id,
    c_operational_job_id,
    c_schedule_window_id,
    c_worker_id,
    'service_worker',
    'proposed',
    NULL,
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.worker_assignment wa WHERE wa.id = c_worker_assignment_id);

  UPDATE public.worker_assignment
     SET assignment_status = 'assigned',
         assigned_at = now()
   WHERE id = c_worker_assignment_id
     AND assignment_status = 'proposed';

  UPDATE public.worker_assignment
     SET assignment_status = 'acknowledged',
         acknowledged_at = now()
   WHERE id = c_worker_assignment_id
     AND assignment_status = 'assigned';

  -- ── Work order lifecycle: draft → published → in_progress → service_complete → qa_complete ──
  INSERT INTO public.work_order (
    id, organization_id, business_unit_id, jurisdiction_id, operational_job_id, schedule_window_id,
    work_order_status, scope_snapshot, customer_instruction_snapshot, access_instruction_snapshot,
    checklist_template_snapshot, safety_instruction_snapshot, pricing_reference_snapshot,
    published_at, started_at, service_completed_at, metadata
  )
  SELECT
    c_work_order_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    c_operational_job_id,
    c_schedule_window_id,
    'draft',
    '{"fixture":"wave4_preview_acceptance","preview_only":true}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{"fixture":"wave4_preview_acceptance"}'::jsonb,
    '{}'::jsonb,
    '{"pricing_snapshot_id":"e1100000-0000-0000-0000-000000000009","fixture":"wave4_preview_acceptance"}'::jsonb,
    NULL,
    NULL,
    NULL,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.work_order wo WHERE wo.id = c_work_order_id);

  UPDATE public.work_order SET work_order_status = 'published',       published_at = now()           WHERE id = c_work_order_id AND work_order_status = 'draft';
  UPDATE public.work_order SET work_order_status = 'in_progress',     started_at = now()             WHERE id = c_work_order_id AND work_order_status = 'published';
  UPDATE public.work_order SET work_order_status = 'service_complete', service_completed_at = now()  WHERE id = c_work_order_id AND work_order_status = 'in_progress';
  UPDATE public.work_order SET work_order_status = 'qa_complete'                                     WHERE id = c_work_order_id AND work_order_status = 'service_complete';

  INSERT INTO public.qa_inspection (
    id, organization_id, business_unit_id, operational_job_id, work_order_id,
    inspection_status, inspection_type, findings, inspected_at, metadata
  )
  SELECT
    c_failed_qa_inspection_id,
    v_org_id,
    v_bu_id,
    c_operational_job_id,
    c_work_order_id,
    'failed',
    'standard',
    '{"reason":"preview_negative_path","fixture":"wave4_preview_acceptance_fixture_v1"}'::jsonb,
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.qa_inspection qi WHERE qi.id = c_failed_qa_inspection_id);

  -- ── Required evidence test policy (KEEP — Correction 7) ───────────────────
  -- TEST ONLY. NOT a production residential cleaning standard.
  -- Governance: DEC-020 / DEC-021
  INSERT INTO public.required_evidence_policy (
    id, organization_id, business_unit_id, jurisdiction_id, configuration_version_id,
    service_family, service_task_key, service_module_key, requirement_key, evidence_type,
    required_count, is_mandatory, requires_external_reference, storage_rule_payload, metadata
  )
  SELECT
    c_required_evidence_policy_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    v_preview_cfg_id,
    'residential',
    NULL,
    NULL,
    'w4_preview_completion_photo',
    'photo_after',
    1,
    true,
    true,
    '{"provider_neutral":true,"storage_system":{"required":true,"nonblank":true},"storage_reference":{"required":true,"nonblank":true},"binary_payload_forbidden":true}'::jsonb,
    '{"preview_only":true,"test_fixture":true,"production_standard":false,"note":"NOT a production cleaning standard; fixture only for ServiceOS Wave 4 enforcement proof","governance_authority":{"decision":"DEC-020","decision_alt":"DEC-021","wave4_implementation_control_id":"1cNWVQVPFWfj_LookYPHIWPZMrUPSp4pTlexEO4NrTz4","ast_001_document_id":"1FvaCITuKe-soQBLtG-gIc_OprM7ylrrf","ast_003_document_id":"1s7sAXimiEcGaATiobEmKqEW1R6j9_JKJ"},"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.required_evidence_policy rep WHERE rep.id = c_required_evidence_policy_id);

  -- =========================================================================
  -- SELF-VALIDATION — All assertions before COMMIT
  -- =========================================================================

  -- [SV-1] Production config unchanged and singular
  SELECT COUNT(*) INTO v_prod_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published'
    AND cv.id = v_prod_cfg_id;

  IF v_prod_cfg_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-1]: production ON-2026-08-v1.0 scope changed';
  END IF;

  -- [SV-1b] Full production config row snapshot immutability check
  SELECT to_jsonb(cv) INTO v_prod_cfg_snapshot_after
  FROM public.configuration_version cv
  WHERE cv.id = v_prod_cfg_id;

  IF v_prod_cfg_snapshot <> v_prod_cfg_snapshot_after THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-1b]: production configuration_version row was mutated — full-row snapshot mismatch, ROLLING BACK';
  END IF;

  -- [SV-2] Preview config exists exactly once by real unique key (org+type+version)
  SELECT COUNT(*) INTO v_preview_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.organization_id = v_org_id;

  IF v_preview_cfg_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-2]: preview configuration_version count = % (expected 1)', v_preview_cfg_count;
  END IF;

  -- [SV-3] Preview config is non-published and explicitly preview/test-only
  PERFORM 1
  FROM public.configuration_version cv
  WHERE cv.id = v_preview_cfg_id
    AND cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.status <> 'published'
    AND cv.configuration ->> 'environment' = 'preview'
    AND cv.configuration ->> 'purpose' = 'wave4_acceptance'
    AND COALESCE((cv.configuration ->> 'production_rule')::boolean, true) = false
    AND COALESCE((cv.configuration ->> 'test_fixture')::boolean, false) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-3]: preview configuration is not explicitly preview/test-only';
  END IF;

  -- [SV-4] Exactly one required fixture policy
  SELECT COUNT(*) INTO v_policy_count
  FROM public.required_evidence_policy rep
  WHERE rep.configuration_version_id = v_preview_cfg_id
    AND rep.requirement_key = 'w4_preview_completion_photo';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-4]: expected exactly one fixture required_evidence_policy row, found %', v_policy_count;
  END IF;

  -- [SV-5] Fixture policy contract matches exactly
  PERFORM 1
  FROM public.required_evidence_policy rep
  WHERE rep.id = c_required_evidence_policy_id
    AND rep.configuration_version_id = v_preview_cfg_id
    AND rep.service_family = 'residential'
    AND rep.requirement_key = 'w4_preview_completion_photo'
    AND rep.evidence_type = 'photo_after'
    AND rep.required_count = 1
    AND rep.is_mandatory = true
    AND rep.requires_external_reference = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-5]: required_evidence_policy contract mismatch';
  END IF;

  -- [SV-6] Maria Santos worker remains active/in scope
  SELECT COUNT(*) INTO v_worker_ok_count
  FROM public.worker w
  WHERE w.id = c_worker_id
    AND w.organization_id = v_org_id
    AND w.status = 'active';

  IF v_worker_ok_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-6]: worker % not active in org scope', c_worker_id;
  END IF;

  -- [SV-7] quote_version final status = accepted
  SELECT qv.lifecycle_status INTO v_qv_status
  FROM public.quote_version qv WHERE qv.id = c_quote_version_id;

  IF v_qv_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-7]: quote_version status = %, expected accepted', v_qv_status;
  END IF;

  -- [SV-7b] accepted quote_response exists
  PERFORM 1 FROM public.quote_response qr
  WHERE qr.id = c_quote_response_id AND qr.response_type = 'accepted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-7b]: accepted quote_response not found';
  END IF;

  -- [SV-8] worker_assignment final status = acknowledged, timestamps set
  SELECT wa.assignment_status INTO v_wa_status
  FROM public.worker_assignment wa WHERE wa.id = c_worker_assignment_id;

  IF v_wa_status IS DISTINCT FROM 'acknowledged' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-8]: worker_assignment status = %, expected acknowledged', v_wa_status;
  END IF;

  PERFORM 1 FROM public.worker_assignment wa
  WHERE wa.id = c_worker_assignment_id
    AND wa.assigned_at IS NOT NULL
    AND wa.acknowledged_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-8b]: worker_assignment assigned_at or acknowledged_at is null';
  END IF;

  -- [SV-9] work_order final status = qa_complete
  SELECT wo.work_order_status INTO v_wo_status
  FROM public.work_order wo WHERE wo.id = c_work_order_id;

  IF v_wo_status IS DISTINCT FROM 'qa_complete' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-9]: work_order status = %, expected qa_complete', v_wo_status;
  END IF;

  -- [SV-10] operational_job final status = qa_pending
  SELECT oj.operational_status INTO v_oj_status
  FROM public.operational_job oj WHERE oj.id = c_operational_job_id;

  IF v_oj_status IS DISTINCT FROM 'qa_pending' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-10]: operational_job status = %, expected qa_pending', v_oj_status;
  END IF;

  -- [SV-11] Failed QA exists and is failed
  SELECT qi.inspection_status INTO v_failed_qa_status
  FROM public.qa_inspection qi
  WHERE qi.id = c_failed_qa_inspection_id
    AND qi.operational_job_id = c_operational_job_id
    AND qi.work_order_id = c_work_order_id;

  IF v_failed_qa_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-11]: failed QA must remain failed, got %', v_failed_qa_status;
  END IF;

  -- [SV-12] Zero reinspection QA (no second qa_inspection for this scope)
  SELECT COUNT(*) INTO v_reinspect_count
  FROM public.qa_inspection qi
  WHERE (qi.operational_job_id = c_operational_job_id OR qi.work_order_id = c_work_order_id)
    AND qi.id <> c_failed_qa_inspection_id;

  IF v_reinspect_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-12]: unexpected reinspection qa_inspection row(s) found, count = %', v_reinspect_count;
  END IF;

  -- [SV-13] Zero W4 applicability rows for fixture scope
  SELECT COUNT(*) INTO v_w4_applicability_count
  FROM public.work_order_wave4_applicability woa
  WHERE woa.operational_job_id = c_operational_job_id
     OR woa.work_order_id = c_work_order_id;

  IF v_w4_applicability_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-13]: work_order_wave4_applicability has % row(s) — must be zero before runtime', v_w4_applicability_count;
  END IF;

  -- [SV-14] Zero W4 governance links for fixture scope
  SELECT COUNT(*) INTO v_w4_gov_link_count
  FROM public.work_order_governance_link wogl
  WHERE wogl.operational_job_id = c_operational_job_id
     OR wogl.work_order_id = c_work_order_id;

  IF v_w4_gov_link_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-14]: work_order_governance_link has % row(s) — must be zero before runtime', v_w4_gov_link_count;
  END IF;

  -- [SV-15] Zero W4 frozen evidence requirements for fixture scope
  SELECT COUNT(*) INTO v_w4_evidence_req_count
  FROM public.work_order_evidence_requirement woer
  WHERE woer.operational_job_id = c_operational_job_id
     OR woer.work_order_id = c_work_order_id;

  IF v_w4_evidence_req_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-15]: work_order_evidence_requirement has % row(s) — must be zero before runtime', v_w4_evidence_req_count;
  END IF;

  -- [SV-16] Zero completion evidence
  SELECT COUNT(*) INTO v_completion_evidence_count
  FROM public.completion_evidence ce
  WHERE ce.operational_job_id = c_operational_job_id
     OR ce.work_order_id = c_work_order_id;

  IF v_completion_evidence_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-16]: completion_evidence has % row(s) — must be zero before runtime', v_completion_evidence_count;
  END IF;

  -- [SV-17] Zero service exceptions
  SELECT COUNT(*) INTO v_service_exception_count
  FROM public.service_exception se
  WHERE se.operational_job_id = c_operational_job_id
     OR se.work_order_id = c_work_order_id;

  IF v_service_exception_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-17]: service_exception has % row(s) — must be zero before runtime', v_service_exception_count;
  END IF;

  -- [SV-18] Zero corrective actions
  SELECT COUNT(*) INTO v_corrective_action_count
  FROM public.corrective_action ca
  WHERE ca.operational_job_id = c_operational_job_id
     OR ca.work_order_id = c_work_order_id;

  IF v_corrective_action_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-18]: corrective_action has % row(s) — must be zero before runtime', v_corrective_action_count;
  END IF;

  -- [SV-19] Zero customer outcomes
  SELECT COUNT(*) INTO v_customer_outcome_count
  FROM public.customer_outcome co
  WHERE co.operational_job_id = c_operational_job_id
     OR co.work_order_id = c_work_order_id;

  IF v_customer_outcome_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-19]: customer_outcome has % row(s) — must be zero before runtime', v_customer_outcome_count;
  END IF;

  -- [SV-20] Historical Wave 3 IDs are untouched (no collision)
  IF c_operational_job_id = '3f77f74c-52a6-4872-9876-ba3ae4ab92c0'::uuid
     OR c_work_order_id = '3d0a23c5-fc46-4f4d-bf66-5b7c9f842f8f'::uuid THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL [SV-20]: fixture IDs must not target retained historical Wave 3 records';
  END IF;

END;
$$;

-- Final output row scoped to resolved production organization_id
WITH preview_cfg AS (
  SELECT
    cv.id,
    cv.organization_id,
    cv.business_unit_id,
    cv.jurisdiction_id
  FROM public.configuration_version cv
  JOIN public.configuration_version prod_cv ON prod_cv.configuration_type = 'residential_pricing'
    AND prod_cv.version = 'ON-2026-08-v1.0'
    AND prod_cv.status = 'published'
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.organization_id = prod_cv.organization_id
  LIMIT 1
)
SELECT
  'W4_PREVIEW_FIXTURE_READY'::text AS result,
  (SELECT id FROM preview_cfg)               AS configuration_version_id,
  'e1100000-0000-0000-0000-000000000013'::uuid AS required_evidence_policy_id,
  'e1100000-0000-0000-0000-00000000000e'::uuid AS operational_job_id,
  'e1100000-0000-0000-0000-000000000011'::uuid AS work_order_id,
  'e1100000-0000-0000-0000-000000000012'::uuid AS failed_qa_inspection_id,
  'e1100000-0000-0000-0000-000000000010'::uuid AS worker_assignment_id,
  '1b3a6903-0c50-4a95-afc3-280628c10508'::uuid AS worker_id,
  (SELECT organization_id FROM preview_cfg)  AS organization_id,
  (SELECT business_unit_id FROM preview_cfg) AS business_unit_id,
  (SELECT jurisdiction_id FROM preview_cfg)  AS jurisdiction_id;

COMMIT;
