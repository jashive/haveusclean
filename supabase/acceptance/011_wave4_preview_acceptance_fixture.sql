-- =============================================================================
-- ACCEPTANCE FIXTURE 011 — WAVE 4 PREVIEW ACCEPTANCE (PERSISTENT, SOURCE-ONLY)
-- Marker: wave4_preview_acceptance_fixture_v1
-- =============================================================================
-- This file is SOURCE ONLY and must be reviewed before execution.
-- It is additive, deterministic, preview-only, and does not modify ON-2026-08-v1.0.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_prod_cfg_count integer;
  v_prod_cfg_id uuid;
  v_org_id uuid;
  v_bu_id uuid;
  v_jur_id uuid;

  v_preview_cfg_count integer;
  v_preview_cfg_id uuid;

  v_worker_ok_count integer;
  v_policy_count integer;

  v_scope_mismatch_count integer;
  v_failed_qa_status text;

  c_preview_cfg_id constant uuid := 'e1100000-0000-0000-0000-000000000001'::uuid;
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
  c_work_order_wave4_applicability_id constant uuid := 'e1100000-0000-0000-0000-000000000014'::uuid;
  c_work_order_governance_link_id constant uuid := 'e1100000-0000-0000-0000-000000000015'::uuid;
  c_work_order_evidence_requirement_id constant uuid := 'e1100000-0000-0000-0000-000000000016'::uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1) Resolve authoritative production scope without mutating it.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_prod_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';

  IF v_prod_cfg_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture: expected exactly one published residential_pricing ON-2026-08-v1.0 row, found %', v_prod_cfg_count;
  END IF;

  SELECT cv.id, cv.organization_id, cv.business_unit_id, cv.jurisdiction_id
    INTO v_prod_cfg_id, v_org_id, v_bu_id, v_jur_id
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';

  -- -------------------------------------------------------------------------
  -- 2) Require existing canonical worker (Maria Santos id) in same scope.
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
  -- 3) Resolve or create isolated preview configuration_version.
  --    Non-production only: status=draft and preview markers in configuration.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_preview_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.organization_id = v_org_id
    AND cv.business_unit_id = v_bu_id
    AND cv.jurisdiction_id = v_jur_id;

  IF v_preview_cfg_count > 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture: multiple preview configuration_version rows found for W4-PREVIEW-ACCEPT-2026-08-v1';
  END IF;

  IF v_preview_cfg_count = 1 THEN
    SELECT cv.id INTO v_preview_cfg_id
    FROM public.configuration_version cv
    WHERE cv.configuration_type = 'residential_pricing'
      AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
      AND cv.organization_id = v_org_id
      AND cv.business_unit_id = v_bu_id
      AND cv.jurisdiction_id = v_jur_id;
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
  -- 4) Insert minimal Wave 2 lineage only if missing (deterministic IDs).
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
    220.00, 0.00, 28.60, 248.60,
    '2.0',
    '{"version":"ON-2026-08-v1.0","fixture":"wave4_preview_acceptance"}'::jsonb,
    '{}'::jsonb,
    '{"fixture":"wave4_preview_acceptance"}'::jsonb,
    '{"total":248.60,"currency":"CAD"}'::jsonb,
    '{"fixture":"wave4_preview_acceptance_fixture_v1"}'::jsonb,
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.pricing_snapshot ps WHERE ps.id = c_pricing_snapshot_id);

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
    'accepted',
    NULL,
    'Wave 4 Preview Acceptance Quote',
    NULL,
    '[{"key":"preview_fixture_service","amount":220.00}]'::jsonb,
    '{"total":248.60,"fixture":"wave4_preview_acceptance_fixture_v1"}'::jsonb,
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.quote_version qv WHERE qv.id = c_quote_version_id);

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

  -- -------------------------------------------------------------------------
  -- 5) Insert minimal Wave 3/Wave 4 operational acceptance fixture rows.
  -- -------------------------------------------------------------------------
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
    'qa_pending',
    '{"fixture":"wave4_preview_acceptance","service":"residential"}'::jsonb,
    '{"pricing_snapshot_id":"e1100000-0000-0000-0000-000000000009","quote_version_id":"e1100000-0000-0000-0000-00000000000a","fixture":"wave4_preview_acceptance"}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","preview_only":true,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.operational_job oj WHERE oj.id = c_operational_job_id);

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
    'acknowledged',
    now(),
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.worker_assignment wa WHERE wa.id = c_worker_assignment_id);

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
    'qa_complete',
    '{"fixture":"wave4_preview_acceptance","preview_only":true}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{"fixture":"wave4_preview_acceptance"}'::jsonb,
    '{}'::jsonb,
    '{"pricing_snapshot_id":"e1100000-0000-0000-0000-000000000009","fixture":"wave4_preview_acceptance"}'::jsonb,
    now(),
    now(),
    now(),
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.work_order wo WHERE wo.id = c_work_order_id);

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
    '{"preview_only":true,"test_fixture":true,"production_standard":false,"note":"NOT a production cleaning standard; fixture only for ServiceOS Wave 4 enforcement proof","governance_authority":{"decision":"DEC-020","wave4_implementation_control_id":"1cNWVQVPFWfj_LookYPHIWPZMrUPSp4pTlexEO4NrTz4","ast_001_document_id":"1FvaCITuKe-soQBLtG-gIc_OprM7ylrrf","ast_003_document_id":"1s7sAXimiEcGaATiobEmKqEW1R6j9_JKJ"},"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.required_evidence_policy rep WHERE rep.id = c_required_evidence_policy_id);

  INSERT INTO public.work_order_wave4_applicability (
    id, organization_id, business_unit_id, jurisdiction_id,
    operational_job_id, work_order_id,
    applicability_status, enrollment_source, metadata
  )
  SELECT
    c_work_order_wave4_applicability_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    c_operational_job_id,
    c_work_order_id,
    'enrolled',
    'system',
    '{"fixture":"wave4_preview_acceptance","preview_only":true,"marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_order_wave4_applicability woa WHERE woa.id = c_work_order_wave4_applicability_id
  );

  INSERT INTO public.work_order_governance_link (
    id, organization_id, business_unit_id, jurisdiction_id,
    operational_job_id, work_order_id, configuration_version_id,
    checklist_version_reference, task_definition_reference, sop_reference_snapshot,
    governance_snapshot, metadata
  )
  SELECT
    c_work_order_governance_link_id,
    v_org_id,
    v_bu_id,
    v_jur_id,
    c_operational_job_id,
    c_work_order_id,
    v_preview_cfg_id,
    'w4-preview-acceptance-checklist-v1',
    'w4-preview-acceptance-taskset-v1',
    '[{"authority":"AST-001","document_id":"1FvaCITuKe-soQBLtG-gIc_OprM7ylrrf","version":"1.0"},{"authority":"AST-003","document_id":"1s7sAXimiEcGaATiobEmKqEW1R6j9_JKJ","version":"1.1"}]'::jsonb,
    '{"decision":"DEC-020","wave4_implementation_control_id":"1cNWVQVPFWfj_LookYPHIWPZMrUPSp4pTlexEO4NrTz4","preview_only":true,"production_rule":false}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_order_governance_link wogl WHERE wogl.id = c_work_order_governance_link_id
  );

  INSERT INTO public.work_order_evidence_requirement (
    id, organization_id, business_unit_id, operational_job_id, work_order_id,
    work_order_governance_link_id, required_evidence_policy_id, source_configuration_version_id,
    service_task_key, service_module_key, requirement_key, evidence_type,
    required_count, is_mandatory, requires_external_reference,
    storage_rule_payload, quality_signal_payload, metadata
  )
  SELECT
    c_work_order_evidence_requirement_id,
    v_org_id,
    v_bu_id,
    c_operational_job_id,
    c_work_order_id,
    c_work_order_governance_link_id,
    c_required_evidence_policy_id,
    v_preview_cfg_id,
    NULL,
    NULL,
    'w4_preview_completion_photo',
    'photo_after',
    1,
    true,
    true,
    '{"provider_neutral":true,"storage_system":{"required":true,"nonblank":true},"storage_reference":{"required":true,"nonblank":true},"binary_payload_forbidden":true}'::jsonb,
    '{"signal":"required_evidence","preview_only":true}'::jsonb,
    '{"fixture":"wave4_preview_acceptance","marker":"wave4_preview_acceptance_fixture_v1"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_order_evidence_requirement woer WHERE woer.id = c_work_order_evidence_requirement_id
  );

  -- -------------------------------------------------------------------------
  -- 6) Fail-fast self-validation (fixture must persist only if all pass).
  -- -------------------------------------------------------------------------

  -- Production governed row must remain intact and singular.
  SELECT COUNT(*) INTO v_prod_cfg_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published'
    AND cv.id = v_prod_cfg_id;

  IF v_prod_cfg_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: production ON-2026-08-v1.0 scope changed';
  END IF;

  -- Preview configuration must be explicit preview-only and non-production.
  PERFORM 1
  FROM public.configuration_version cv
  WHERE cv.id = v_preview_cfg_id
    AND cv.configuration_type = 'residential_pricing'
    AND cv.version = 'W4-PREVIEW-ACCEPT-2026-08-v1'
    AND cv.status <> 'published'
    AND cv.configuration ->> 'environment' = 'preview'
    AND cv.configuration ->> 'purpose' = 'wave4_acceptance'
    AND COALESCE((cv.configuration ->> 'production_rule')::boolean, false) = false
    AND COALESCE((cv.configuration ->> 'test_fixture')::boolean, false) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: preview configuration is not explicitly preview/test-only';
  END IF;

  SELECT COUNT(*) INTO v_policy_count
  FROM public.required_evidence_policy rep
  WHERE rep.configuration_version_id = v_preview_cfg_id
    AND rep.requirement_key = 'w4_preview_completion_photo';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: expected exactly one fixture required_evidence_policy row, found %', v_policy_count;
  END IF;

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
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: required_evidence_policy contract mismatch';
  END IF;

  SELECT COUNT(*) INTO v_scope_mismatch_count
  FROM (
    SELECT oj.organization_id, oj.business_unit_id, oj.jurisdiction_id
    FROM public.operational_job oj
    WHERE oj.id = c_operational_job_id

    EXCEPT

    SELECT wo.organization_id, wo.business_unit_id, wo.jurisdiction_id
    FROM public.work_order wo
    WHERE wo.id = c_work_order_id

    EXCEPT

    SELECT wogl.organization_id, wogl.business_unit_id, wogl.jurisdiction_id
    FROM public.work_order_governance_link wogl
    WHERE wogl.id = c_work_order_governance_link_id

    EXCEPT

    SELECT woa.organization_id, woa.business_unit_id, woa.jurisdiction_id
    FROM public.work_order_wave4_applicability woa
    WHERE woa.id = c_work_order_wave4_applicability_id
  ) mismatched_scope;

  IF v_scope_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: operational fixture scope mismatch';
  END IF;

  SELECT qi.inspection_status INTO v_failed_qa_status
  FROM public.qa_inspection qi
  WHERE qi.id = c_failed_qa_inspection_id
    AND qi.operational_job_id = c_operational_job_id
    AND qi.work_order_id = c_work_order_id;

  IF v_failed_qa_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: failed QA must remain failed';
  END IF;

  PERFORM 1
  FROM public.work_order_evidence_requirement woer
  WHERE woer.id = c_work_order_evidence_requirement_id
    AND woer.work_order_governance_link_id = c_work_order_governance_link_id
    AND woer.required_evidence_policy_id = c_required_evidence_policy_id
    AND woer.source_configuration_version_id = v_preview_cfg_id
    AND woer.requirement_key = 'w4_preview_completion_photo'
    AND woer.evidence_type = 'photo_after'
    AND woer.required_count = 1
    AND woer.is_mandatory = true
    AND woer.requires_external_reference = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: work_order_evidence_requirement contract mismatch';
  END IF;

  -- Guardrail: fixture IDs must not collide with historical transaction IDs called out for preservation.
  IF c_operational_job_id = '3f77f74c-52a6-4872-9876-ba3ae4ab92c0'::uuid
     OR c_work_order_id = '3d0a23c5-fc46-4f4d-bf66-5b7c9f842f8f'::uuid THEN
    RAISE EXCEPTION 'W4 Preview fixture assertion FAIL: fixture IDs must not target retained historical Wave 3 records';
  END IF;
END;
$$;

SELECT
  'W4_PREVIEW_FIXTURE_READY'::text AS result,
  'e1100000-0000-0000-0000-000000000001'::uuid AS configuration_version_id,
  'e1100000-0000-0000-0000-000000000013'::uuid AS required_evidence_policy_id,
  'e1100000-0000-0000-0000-00000000000e'::uuid AS operational_job_id,
  'e1100000-0000-0000-0000-000000000011'::uuid AS work_order_id,
  'e1100000-0000-0000-0000-000000000012'::uuid AS failed_qa_inspection_id,
  '1b3a6903-0c50-4a95-afc3-280628c10508'::uuid AS worker_id,
  (
    SELECT cv.organization_id
    FROM public.configuration_version cv
    WHERE cv.id = 'e1100000-0000-0000-0000-000000000001'::uuid
  ) AS organization_id,
  (
    SELECT cv.business_unit_id
    FROM public.configuration_version cv
    WHERE cv.id = 'e1100000-0000-0000-0000-000000000001'::uuid
  ) AS business_unit_id,
  (
    SELECT cv.jurisdiction_id
    FROM public.configuration_version cv
    WHERE cv.id = 'e1100000-0000-0000-0000-000000000001'::uuid
  ) AS jurisdiction_id;

COMMIT;
