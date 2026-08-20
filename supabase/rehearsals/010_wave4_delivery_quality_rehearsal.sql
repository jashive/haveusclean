-- =============================================================================
-- REHEARSAL 010 — WAVE 4 DELIVERY QUALITY CONTROLLED ROLLBACK REHEARSAL
-- Marker: wave4_m010_rehearsal_v1
-- =============================================================================
-- This file is a REHEARSAL ONLY.
-- It constructs a synthetic Wave 2+3+4 chain inside one transaction and then
-- performs a full ROLLBACK.
-- DATABASE EXECUTION IS NOT YET AUTHORIZED.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 1: Resolve authoritative rehearsal scope from published config
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_scope_count integer;
BEGIN
  SELECT COUNT(*) INTO v_scope_count
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';

  IF v_scope_count <> 1 THEN
    RAISE EXCEPTION 'M010 rehearsal scope resolution failed: expected exactly one published residential_pricing ON-2026-08-v1.0 row, found %', v_scope_count;
  END IF;

  CREATE TEMP TABLE pg_temp.m010_scope ON COMMIT DROP AS
  SELECT
    cv.id AS configuration_version_id,
    cv.organization_id,
    cv.business_unit_id,
    cv.jurisdiction_id
  FROM public.configuration_version cv
  WHERE cv.configuration_type = 'residential_pricing'
    AND cv.version = 'ON-2026-08-v1.0'
    AND cv.status = 'published';
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 2: Synthetic Wave 1/2 lineage (same proven canonical shapes as M008)
-- ---------------------------------------------------------------------------

INSERT INTO public.customer (
  id, organization_id, business_unit_id,
  customer_type, display_name, legal_name, status, notes, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'person',
  'Wave 4 Rehearsal Customer',
  NULL,
  'active',
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.contact (
  id, customer_id, contact_type,
  first_name, last_name, email, phone, is_primary, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000002'::uuid,
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'primary',
  'Wave',
  'Four',
  NULL,
  NULL,
  true,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.service_location (
  id, customer_id, jurisdiction_id,
  label, address_line1, address_line2, city, subdivision, postal_code,
  country_code, access_notes, latitude, longitude, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000003'::uuid,
  'd1000000-0000-0000-0000-000000000001'::uuid,
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'Wave 4 Residence',
  '10 Rehearsal Avenue',
  NULL,
  'Toronto',
  'ON',
  'M5V 2B2',
  'CA',
  NULL,
  NULL,
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.service_request (
  id, organization_id, business_unit_id,
  service_category, lifecycle_status, intake_channel, requested_at,
  title, description, requirements, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000004'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'residential',
  'qualified',
  'm010_rehearsal',
  now(),
  'Wave 4 Delivery Quality Rehearsal',
  'Synthetic source-only rehearsal for Wave 4 narrowed data contract',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.opportunity (
  id, organization_id, business_unit_id,
  service_request_id, stage, close_reason, expected_close_date,
  probability_percent, title, summary, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000005'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000004'::uuid,
  'qualified',
  NULL,
  NULL,
  NULL,
  'Wave 4 Opportunity',
  'Synthetic lineage for Wave 4 rehearsal',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.estimate (
  id, organization_id, business_unit_id,
  opportunity_id, estimate_number, version_no, lifecycle_status,
  assumptions, scope_snapshot, notes, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000006'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000005'::uuid,
  NULL,
  1,
  'prepared',
  '{"rehearsal":true}'::jsonb,
  '{"service":"complete_deep_clean","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.quote (
  id, organization_id, business_unit_id,
  opportunity_id, estimate_id, quote_number, lifecycle_status,
  customer_id, contact_id, service_location_id, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000007'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000005'::uuid,
  'd1000000-0000-0000-0000-000000000006'::uuid,
  NULL,
  'active',
  NULL,
  NULL,
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

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
VALUES (
  'd1000000-0000-0000-0000-000000000008'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000005'::uuid,
  'd1000000-0000-0000-0000-000000000006'::uuid,
  (SELECT configuration_version_id FROM pg_temp.m010_scope),
  'CAD',
  'HST', 0.13,
  220.00, 0.00, 28.60, 248.60,
  '2.0',
  '{"version":"ON-2026-08-v1.0","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{}'::jsonb,
  '{"service":"complete_deep_clean","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"total":248.60,"currency":"CAD"}'::jsonb,
  '{"quoteContractVersion":"2.0","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  now(),
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.quote_version (
  id, organization_id, business_unit_id,
  quote_id, estimate_id, pricing_snapshot_id,
  version_no, lifecycle_status, valid_until, title, terms_text,
  line_items_snapshot, commercial_snapshot, sent_at, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000009'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000007'::uuid,
  'd1000000-0000-0000-0000-000000000006'::uuid,
  'd1000000-0000-0000-0000-000000000008'::uuid,
  1,
  'draft',
  NULL,
  'Wave 4 Quote',
  NULL,
  '[{"key":"complete_deep_clean","amount":220.00}]'::jsonb,
  '{"total":248.60,"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.quote_version
SET lifecycle_status = 'sent',
    sent_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000009'::uuid;

INSERT INTO public.quote_response (
  id, organization_id, business_unit_id,
  quote_version_id, idempotency_key_id,
  response_type, response_channel, responded_by_name, responded_by_email,
  responded_at, notes, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000019'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000009'::uuid,
  NULL,
  'accepted',
  'm010_rehearsal',
  'M010 Rehearsal',
  NULL,
  now(),
  NULL,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.quote_version
SET lifecycle_status = 'accepted'
WHERE id = 'd1000000-0000-0000-0000-000000000009'::uuid;

INSERT INTO public.conversion_record (
  id, organization_id, business_unit_id,
  service_request_id, opportunity_id, estimate_id,
  quote_id, quote_version_id, quote_response_id,
  customer_id, contact_id, service_location_id, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-000000000004'::uuid,
  'd1000000-0000-0000-0000-000000000005'::uuid,
  'd1000000-0000-0000-0000-000000000006'::uuid,
  'd1000000-0000-0000-0000-000000000007'::uuid,
  'd1000000-0000-0000-0000-000000000009'::uuid,
  'd1000000-0000-0000-0000-000000000019'::uuid,
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'd1000000-0000-0000-0000-000000000002'::uuid,
  'd1000000-0000-0000-0000-000000000003'::uuid,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.job_handoff (
  id, organization_id, business_unit_id,
  conversion_record_id, quote_version_id, pricing_snapshot_id,
  handoff_status, handoff_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000000b'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'd1000000-0000-0000-0000-000000000009'::uuid,
  'd1000000-0000-0000-0000-000000000008'::uuid,
  'ready',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 3: Synthetic Wave 3 execution chain
-- ---------------------------------------------------------------------------

INSERT INTO public.operational_job (
  id, organization_id, business_unit_id, jurisdiction_id,
  job_handoff_id, conversion_record_id, quote_version_id, pricing_snapshot_id,
  customer_id, contact_id, service_location_id, service_family,
  operational_status, service_scope_snapshot, commercial_authority_snapshot, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000b'::uuid,
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'd1000000-0000-0000-0000-000000000009'::uuid,
  'd1000000-0000-0000-0000-000000000008'::uuid,
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'd1000000-0000-0000-0000-000000000002'::uuid,
  'd1000000-0000-0000-0000-000000000003'::uuid,
  'residential',
  'ready_to_schedule',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.schedule_window (
  id, organization_id, business_unit_id, jurisdiction_id, operational_job_id,
  scheduled_start, scheduled_end, timezone, status, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000000d'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  now() + interval '1 day',
  now() + interval '1 day 2 hours',
  'America/Toronto',
  'planned',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.worker_assignment (
  id, organization_id, business_unit_id, operational_job_id, schedule_window_id,
  worker_id, assignment_role, assignment_status, metadata
)
SELECT
  'd1000000-0000-0000-0000-00000000000e'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000d'::uuid,
  w.id,
  'service_worker',
  'proposed',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
FROM public.worker w
WHERE w.organization_id = (SELECT organization_id FROM pg_temp.m010_scope)
  AND w.status = 'active'
ORDER BY w.id
LIMIT 1;

DO $$
DECLARE
  v_status text;
BEGIN
  SELECT assignment_status INTO v_status
  FROM public.worker_assignment
  WHERE id = 'd1000000-0000-0000-0000-00000000000e'::uuid;

  IF v_status <> 'proposed' THEN
    RAISE EXCEPTION 'M010 rehearsal assertion FAIL: worker_assignment must begin at proposed, got %', v_status;
  END IF;
END;
$$;

UPDATE public.worker_assignment
SET assignment_status = 'assigned',
    assigned_at = now()
WHERE id = 'd1000000-0000-0000-0000-00000000000e'::uuid;

UPDATE public.worker_assignment
SET assignment_status = 'acknowledged',
    acknowledged_at = now()
WHERE id = 'd1000000-0000-0000-0000-00000000000e'::uuid;

DO $$
DECLARE
  v_status text;
  v_assigned_at timestamptz;
  v_acknowledged_at timestamptz;
BEGIN
  SELECT assignment_status, assigned_at, acknowledged_at
    INTO v_status, v_assigned_at, v_acknowledged_at
  FROM public.worker_assignment
  WHERE id = 'd1000000-0000-0000-0000-00000000000e'::uuid;

  IF v_status <> 'acknowledged' OR v_assigned_at IS NULL OR v_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'M010 rehearsal assertion FAIL: worker_assignment lifecycle proposed->assigned->acknowledged not satisfied';
  END IF;
END;
$$;

INSERT INTO public.work_order (
  id, organization_id, business_unit_id, jurisdiction_id, operational_job_id, schedule_window_id,
  work_order_status, scope_snapshot, customer_instruction_snapshot, access_instruction_snapshot,
  checklist_template_snapshot, safety_instruction_snapshot, pricing_reference_snapshot, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000d'::uuid,
  'draft',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{}'::jsonb,
  '{"pricing_snapshot_id":"d1000000-0000-0000-0000-000000000008","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.work_order
SET work_order_status = 'published',
    published_at = now()
WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;

UPDATE public.work_order
SET work_order_status = 'in_progress',
    started_at = now()
WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;

UPDATE public.work_order
SET work_order_status = 'service_complete',
    service_completed_at = now()
WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;

INSERT INTO public.qa_inspection (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  inspection_status, inspection_type, findings, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000010'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'failed',
  'standard',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 4: Wave 4 authority + explicit governance applicability enrollment
-- ---------------------------------------------------------------------------

INSERT INTO public.required_evidence_policy (
  id, organization_id, business_unit_id, jurisdiction_id, configuration_version_id,
  service_family, service_task_key, service_module_key, requirement_key, evidence_type,
  required_count, is_mandatory, requires_external_reference, storage_rule_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000011'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  (SELECT configuration_version_id FROM pg_temp.m010_scope),
  'residential',
  'deep_clean',
  'kitchen',
  'kitchen_after_photo',
  'photo_after',
  1,
  true,
  true,
  '{"external_reference_required":true,"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.work_order_wave4_applicability (
  id, organization_id, business_unit_id, jurisdiction_id,
  operational_job_id, work_order_id,
  applicability_status, enrollment_source, metadata
)
VALUES (
  'd1000000-0000-0000-0000-00000000001a'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'enrolled',
  'system',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 5: Enrolled Wave 4 work order cannot close without contract rows
-- ---------------------------------------------------------------------------

UPDATE public.work_order
SET work_order_status = 'qa_complete'
WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;

DO $$
BEGIN
  BEGIN
    UPDATE public.work_order
    SET work_order_status = 'closed'
    WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;
    RAISE EXCEPTION 'M010 expected missing governance close failure did not occur';
  EXCEPTION
    WHEN OTHERS THEN
      IF POSITION('frozen governance linkage is required before close' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

INSERT INTO public.work_order_governance_link (
  id, organization_id, business_unit_id, jurisdiction_id,
  operational_job_id, work_order_id, configuration_version_id,
  checklist_version_reference, task_definition_reference, sop_reference_snapshot,
  governance_snapshot, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000012'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  (SELECT jurisdiction_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  (SELECT configuration_version_id FROM pg_temp.m010_scope),
  'chk-v4-2026-08',
  'task-set-residential-v4',
  '[{"document_id":"hems-sop-kitchen","version":"2026-08-v1"}]'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

INSERT INTO public.work_order_evidence_requirement (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  work_order_governance_link_id, required_evidence_policy_id, source_configuration_version_id,
  service_task_key, service_module_key, requirement_key, evidence_type,
  required_count, is_mandatory, requires_external_reference, storage_rule_payload, quality_signal_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000013'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'd1000000-0000-0000-0000-000000000012'::uuid,
  'd1000000-0000-0000-0000-000000000011'::uuid,
  (SELECT configuration_version_id FROM pg_temp.m010_scope),
  'deep_clean',
  'kitchen',
  'kitchen_after_photo',
  'photo_after',
  1,
  true,
  true,
  '{"external_reference_required":true,"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"signal":"required_evidence","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

DO $$
BEGIN
  BEGIN
    UPDATE public.work_order
    SET work_order_status = 'closed'
    WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;
    RAISE EXCEPTION 'M010 expected missing evidence close failure did not occur';
  EXCEPTION
    WHEN OTHERS THEN
      IF POSITION('mandatory evidence requirement' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

INSERT INTO public.completion_evidence (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  worker_assignment_id, evidence_type, storage_system, storage_reference,
  evidence_payload, captured_at, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000014'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'd1000000-0000-0000-0000-00000000000e'::uuid,
  'photo_after',
  'provider_reference',
  'preview://wave4/kitchen-after/1',
  '{"requirement_key":"kitchen_after_photo","marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  now(),
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 6: Exception → corrective action → rework → reinspection → resolution
-- ---------------------------------------------------------------------------

INSERT INTO public.service_exception (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  qa_inspection_id, source_type, exception_category, severity, description,
  findings, triage_status, corrective_action_required, reported_at,
  quality_signal_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000015'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'd1000000-0000-0000-0000-000000000010'::uuid,
  'qa',
  'service_quality',
  'high',
  'Kitchen backsplash residue remained after service completion.',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  'reported',
  true,
  now(),
  '{"complaint_weight":1,"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.service_exception
SET triage_status = 'triaged',
    triaged_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid;

INSERT INTO public.corrective_action (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  qa_inspection_id, action_status, action_type, description, resolution_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000016'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'd1000000-0000-0000-0000-000000000010'::uuid,
  'open',
  'rework',
  'Re-clean kitchen backsplash and counters.',
  '{}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.service_exception
SET corrective_action_id = 'd1000000-0000-0000-0000-000000000016'::uuid,
    triage_status = 'corrective_action_required',
    corrective_action_required = true
WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid;

UPDATE public.corrective_action
SET action_status = 'resolved',
    resolved_at = now(),
    resolution_payload = '{"rework_completed":true,"marker":"wave4_m010_rehearsal_v1"}'::jsonb
WHERE id = 'd1000000-0000-0000-0000-000000000016'::uuid;

UPDATE public.service_exception
SET triage_status = 'ready_for_reinspection'
WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid;

INSERT INTO public.qa_inspection (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  inspection_status, inspection_type, findings, inspected_at, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000017'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'passed',
  'reinspection',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  now(),
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.corrective_action
SET action_status = 'verified',
    verified_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000016'::uuid;

UPDATE public.service_exception
SET triage_status = 'resolved',
    resolved_at = now(),
    resolution_payload = '{"resolution":"reinspection_passed","marker":"wave4_m010_rehearsal_v1"}'::jsonb
WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid;

UPDATE public.service_exception
SET triage_status = 'closed',
    closed_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid;

DO $$
DECLARE
  v_original_failed_status text;
  v_reinspection_status text;
BEGIN
  SELECT inspection_status INTO v_original_failed_status
  FROM public.qa_inspection
  WHERE id = 'd1000000-0000-0000-0000-000000000010'::uuid;

  SELECT inspection_status INTO v_reinspection_status
  FROM public.qa_inspection
  WHERE id = 'd1000000-0000-0000-0000-000000000017'::uuid;

  IF v_original_failed_status <> 'failed' THEN
    RAISE EXCEPTION 'M010 rehearsal assertion FAIL: original failed QA inspection must remain failed';
  END IF;

  IF v_reinspection_status <> 'passed' THEN
    RAISE EXCEPTION 'M010 rehearsal assertion FAIL: reinspection QA inspection must be passed';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 7: Customer outcome / service issue lineage
-- ---------------------------------------------------------------------------

INSERT INTO public.customer_outcome (
  id, organization_id, business_unit_id, operational_job_id, work_order_id,
  customer_id, contact_id, service_location_id,
  outcome_type, outcome_status, outcome_source, source_channel,
  reported_at, recorded_at, description, details, quality_signal_payload, metadata
)
VALUES (
  'd1000000-0000-0000-0000-000000000018'::uuid,
  (SELECT organization_id FROM pg_temp.m010_scope),
  (SELECT business_unit_id FROM pg_temp.m010_scope),
  'd1000000-0000-0000-0000-00000000000c'::uuid,
  'd1000000-0000-0000-0000-00000000000f'::uuid,
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'd1000000-0000-0000-0000-000000000002'::uuid,
  'd1000000-0000-0000-0000-000000000003'::uuid,
  'reclean_request',
  'reported',
  'customer',
  'sms',
  now(),
  now(),
  'Customer requested confirmation that kitchen re-clean was completed.',
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"reclean":1,"marker":"wave4_m010_rehearsal_v1"}'::jsonb,
  '{"marker":"wave4_m010_rehearsal_v1"}'::jsonb
);

UPDATE public.customer_outcome
SET outcome_status = 'acknowledged'
WHERE id = 'd1000000-0000-0000-0000-000000000018'::uuid;

UPDATE public.customer_outcome
SET outcome_status = 'investigating'
WHERE id = 'd1000000-0000-0000-0000-000000000018'::uuid;

UPDATE public.customer_outcome
SET outcome_status = 'resolved',
    resolved_at = now(),
    resolution_payload = '{"resolution":"customer_confirmed_reclean","marker":"wave4_m010_rehearsal_v1"}'::jsonb
WHERE id = 'd1000000-0000-0000-0000-000000000018'::uuid;

UPDATE public.customer_outcome
SET outcome_status = 'closed',
    closed_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000018'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 8: Successful closure after evidence + QA + corrective verification
-- ---------------------------------------------------------------------------

UPDATE public.work_order
SET work_order_status = 'closed'
WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 9: Roll back everything
-- ---------------------------------------------------------------------------

ROLLBACK;

-- ---------------------------------------------------------------------------
-- STEP 10: Post-rollback zero-artifact verification
-- ---------------------------------------------------------------------------

WITH remaining AS (
  SELECT COUNT(*) AS remaining_artifact_count
  FROM (
    SELECT 1 FROM public.customer WHERE id = 'd1000000-0000-0000-0000-000000000001'::uuid
    UNION ALL
    SELECT 1 FROM public.contact WHERE id = 'd1000000-0000-0000-0000-000000000002'::uuid
    UNION ALL
    SELECT 1 FROM public.service_location WHERE id = 'd1000000-0000-0000-0000-000000000003'::uuid
    UNION ALL
    SELECT 1 FROM public.service_request WHERE id = 'd1000000-0000-0000-0000-000000000004'::uuid
    UNION ALL
    SELECT 1 FROM public.opportunity WHERE id = 'd1000000-0000-0000-0000-000000000005'::uuid
    UNION ALL
    SELECT 1 FROM public.estimate WHERE id = 'd1000000-0000-0000-0000-000000000006'::uuid
    UNION ALL
    SELECT 1 FROM public.quote WHERE id = 'd1000000-0000-0000-0000-000000000007'::uuid
    UNION ALL
    SELECT 1 FROM public.pricing_snapshot WHERE id = 'd1000000-0000-0000-0000-000000000008'::uuid
    UNION ALL
    SELECT 1 FROM public.quote_version WHERE id = 'd1000000-0000-0000-0000-000000000009'::uuid
    UNION ALL
    SELECT 1 FROM public.quote_response WHERE id = 'd1000000-0000-0000-0000-000000000019'::uuid
    UNION ALL
    SELECT 1 FROM public.conversion_record WHERE id = 'd1000000-0000-0000-0000-00000000000a'::uuid
    UNION ALL
    SELECT 1 FROM public.job_handoff WHERE id = 'd1000000-0000-0000-0000-00000000000b'::uuid
    UNION ALL
    SELECT 1 FROM public.operational_job WHERE id = 'd1000000-0000-0000-0000-00000000000c'::uuid
    UNION ALL
    SELECT 1 FROM public.schedule_window WHERE id = 'd1000000-0000-0000-0000-00000000000d'::uuid
    UNION ALL
    SELECT 1 FROM public.worker_assignment WHERE id = 'd1000000-0000-0000-0000-00000000000e'::uuid
    UNION ALL
    SELECT 1 FROM public.work_order WHERE id = 'd1000000-0000-0000-0000-00000000000f'::uuid
    UNION ALL
    SELECT 1 FROM public.work_order_event WHERE metadata ->> 'marker' = 'wave4_m010_rehearsal_v1'
    UNION ALL
    SELECT 1 FROM public.completion_evidence WHERE id = 'd1000000-0000-0000-0000-000000000014'::uuid
    UNION ALL
    SELECT 1 FROM public.service_checklist_result WHERE metadata ->> 'marker' = 'wave4_m010_rehearsal_v1'
    UNION ALL
    SELECT 1 FROM public.qa_inspection WHERE id IN (
      'd1000000-0000-0000-0000-000000000010'::uuid,
      'd1000000-0000-0000-0000-000000000017'::uuid
    )
    UNION ALL
    SELECT 1 FROM public.corrective_action WHERE id = 'd1000000-0000-0000-0000-000000000016'::uuid
    UNION ALL
    SELECT 1 FROM public.operational_handoff WHERE metadata ->> 'marker' = 'wave4_m010_rehearsal_v1'
    UNION ALL
    SELECT 1 FROM public.required_evidence_policy WHERE id = 'd1000000-0000-0000-0000-000000000011'::uuid
    UNION ALL
    SELECT 1 FROM public.work_order_wave4_applicability WHERE id = 'd1000000-0000-0000-0000-00000000001a'::uuid
    UNION ALL
    SELECT 1 FROM public.work_order_governance_link WHERE id = 'd1000000-0000-0000-0000-000000000012'::uuid
    UNION ALL
    SELECT 1 FROM public.work_order_evidence_requirement WHERE id = 'd1000000-0000-0000-0000-000000000013'::uuid
    UNION ALL
    SELECT 1 FROM public.service_exception WHERE id = 'd1000000-0000-0000-0000-000000000015'::uuid
    UNION ALL
    SELECT 1 FROM public.customer_outcome WHERE id = 'd1000000-0000-0000-0000-000000000018'::uuid
  ) s
)
SELECT
  CASE
    WHEN remaining_artifact_count = 0 THEN 'M010_REHEARSAL_PASS_ROLLED_BACK'
    ELSE 'M010_REHEARSAL_FAIL_ARTIFACTS_REMAIN'
  END AS result,
  remaining_artifact_count
FROM remaining;
