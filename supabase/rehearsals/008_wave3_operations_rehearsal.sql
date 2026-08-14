-- =============================================================================
-- REHEARSAL 008 — WAVE 3 CONTROLLED ROLLBACK REHEARSAL
-- Marker: wave3_m008_rehearsal_v1
-- =============================================================================
-- This file is a REHEARSAL ONLY.
-- It constructs a complete synthetic Wave 2+3 canonical chain inside one
-- transaction and then performs a full ROLLBACK.
-- DATABASE EXECUTION IS NOT YET AUTHORIZED.
-- Do NOT deploy as schema.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 0: Marker — used by the post-rollback zero-artifact check
-- ---------------------------------------------------------------------------
-- The marker is never committed. After ROLLBACK it must not exist in any table.

-- ---------------------------------------------------------------------------
-- STEP 1: Resolve authoritative rehearsal scope from governed published config
--
-- Reuse the proven live HUC-ON scope from the published governed residential
-- configuration. Do NOT synthesize organization/business_unit/jurisdiction/
-- configuration_version authority rows in this rehearsal.
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
    RAISE EXCEPTION 'M008 rehearsal scope resolution failed: expected exactly one published residential_pricing ON-2026-08-v1.0 row, found %', v_scope_count;
  END IF;

  CREATE TEMP TABLE pg_temp.m008_scope ON COMMIT DROP AS
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
-- STEP 1A: Synthetic Wave 1/2 records below resolved authority scope
-- ---------------------------------------------------------------------------

-- 1a. Customer
INSERT INTO public.customer (id, organization_id, business_unit_id, customer_type, display_name)
VALUES ('d0000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope),
        'person',
        'Rehearsal Customer M008');

-- 1b. Contact (canonical: no organization_id/business_unit_id)
INSERT INTO public.contact (id, customer_id, contact_type, first_name, last_name)
VALUES ('e0000000-0000-0000-0000-000000000001'::uuid,
        'd0000000-0000-0000-0000-000000000001'::uuid,
        'primary',
        'Jane',
        'Rehearsal');

-- 1c. Service location (canonical: no organization_id/business_unit_id, uses address_line1)
INSERT INTO public.service_location (id, customer_id, jurisdiction_id, address_line1, city)
VALUES ('f0000000-0000-0000-0000-000000000001'::uuid,
        'd0000000-0000-0000-0000-000000000001'::uuid,
        (SELECT jurisdiction_id FROM pg_temp.m008_scope),
        '1 Rehearsal Street',
        'Toronto');

-- 1d. Service request
INSERT INTO public.service_request (id, organization_id, business_unit_id)
VALUES ('11000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope));

-- 1e. Opportunity
INSERT INTO public.opportunity (id, organization_id, business_unit_id, service_request_id, stage)
VALUES ('12000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope),
        '11000000-0000-0000-0000-000000000001'::uuid,
        'qualified');

-- 1f. Estimate (required lineage)
INSERT INTO public.estimate (id, organization_id, business_unit_id, opportunity_id)
VALUES ('0e000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope),
        '12000000-0000-0000-0000-000000000001'::uuid);

-- 1g. Quote
INSERT INTO public.quote (id, organization_id, business_unit_id, opportunity_id, estimate_id)
VALUES ('13000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope),
        '12000000-0000-0000-0000-000000000001'::uuid,
        '0e000000-0000-0000-0000-000000000001'::uuid);

-- 1h. Pricing snapshot (canonical M005/Wave 2 shape)
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
  frozen_at
)
VALUES (
  '14000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '12000000-0000-0000-0000-000000000001'::uuid,
  '0e000000-0000-0000-0000-000000000001'::uuid,
  (SELECT configuration_version_id FROM pg_temp.m008_scope),
  'CAD',
  'HST', 0.13,
  395.00, 0.00, 51.35, 446.35,
  '2.0',
  '{"version":"ON-2026-08-v1.0","tax":{"label":"HST"},"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{}'::jsonb,
  '{"sqft":1500,"dwelling_type":"apartment"}'::jsonb,
  '{"line_items":[{"key":"base_clean","amount":395.00}],"subtotal":395.00,"tax":51.35,"total":446.35}'::jsonb,
  '{"pre_tax_total":395.00,"tax_amount":51.35,"total":446.35}'::jsonb,
  now()
);

-- 1i. Quote version (canonical: lifecycle_status, version_no, estimate_id)
INSERT INTO public.quote_version (
  id, organization_id, business_unit_id,
  quote_id, estimate_id, pricing_snapshot_id,
  version_no, lifecycle_status
)
VALUES (
  '15000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '13000000-0000-0000-0000-000000000001'::uuid,
  '0e000000-0000-0000-0000-000000000001'::uuid,
  '14000000-0000-0000-0000-000000000001'::uuid,
  1,
  'accepted'
);

-- 1j. Quote response (required for conversion_record lineage)
INSERT INTO public.quote_response (
  id, organization_id, business_unit_id,
  quote_id, quote_version_id,
  response_status
)
VALUES (
  '0a000000-0000-0000-0000-000000000002'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '13000000-0000-0000-0000-000000000001'::uuid,
  '15000000-0000-0000-0000-000000000001'::uuid,
  'accepted'
);

-- 1k. Conversion record (canonical lineage: service_request_id, estimate_id, quote_id, quote_response_id)
INSERT INTO public.conversion_record (
  id, organization_id, business_unit_id,
  service_request_id, opportunity_id, estimate_id,
  quote_id, quote_version_id, quote_response_id,
  customer_id, contact_id, service_location_id
)
VALUES (
  '16000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '11000000-0000-0000-0000-000000000001'::uuid,
  '12000000-0000-0000-0000-000000000001'::uuid,
  '0e000000-0000-0000-0000-000000000001'::uuid,
  '13000000-0000-0000-0000-000000000001'::uuid,
  '15000000-0000-0000-0000-000000000001'::uuid,
  '0a000000-0000-0000-0000-000000000002'::uuid,
  'd0000000-0000-0000-0000-000000000001'::uuid,
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'f0000000-0000-0000-0000-000000000001'::uuid
);

-- 1l. Job handoff (Wave 2 -> Wave 3 boundary)
INSERT INTO public.job_handoff (
  id, organization_id, business_unit_id,
  conversion_record_id, quote_version_id, pricing_snapshot_id,
  handoff_status, handoff_payload, metadata, handed_off_at
)
VALUES (
  '17000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '16000000-0000-0000-0000-000000000001'::uuid,
  '15000000-0000-0000-0000-000000000001'::uuid,
  '14000000-0000-0000-0000-000000000001'::uuid,
  'ready',
  '{"source":"pilot_ui","synthetic":true,"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{"rehearsal":true,"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  now()
);

-- 1m. Worker (required for assignment; status must be active)
INSERT INTO public.worker (
  id, organization_id, business_unit_id,
  worker_type, display_name, status, metadata
)
VALUES ('18000000-0000-0000-0000-000000000001'::uuid,
        (SELECT organization_id FROM pg_temp.m008_scope),
        (SELECT business_unit_id FROM pg_temp.m008_scope),
        'contractor',
        'Worker M008',
        'active',
        '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb);

-- ---------------------------------------------------------------------------
-- STEP 2: WAVE 3 — operational_job creation
-- Chain: job_handoff -> conversion_record -> customer/contact/service_location
--        service_location -> jurisdiction_id
-- ---------------------------------------------------------------------------

INSERT INTO public.operational_job (
  id,
  organization_id,
  business_unit_id,
  jurisdiction_id,
  job_handoff_id,
  conversion_record_id,
  quote_version_id,
  pricing_snapshot_id,
  customer_id,
  contact_id,
  service_location_id,
  service_family,
  operational_status,
  service_scope_snapshot,
  commercial_authority_snapshot,
  metadata
)
VALUES (
  '20000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  (SELECT jurisdiction_id FROM pg_temp.m008_scope),
  '17000000-0000-0000-0000-000000000001'::uuid,
  '16000000-0000-0000-0000-000000000001'::uuid,
  '15000000-0000-0000-0000-000000000001'::uuid,
  '14000000-0000-0000-0000-000000000001'::uuid,
  'd0000000-0000-0000-0000-000000000001'::uuid,
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'f0000000-0000-0000-0000-000000000001'::uuid,
  'residential_cleaning',
  'ready_to_schedule',
  '{"sqft":1500,"dwelling_type":"apartment","bedrooms":2,"bathrooms":2,"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{"pre_tax_total":395.00,"tax_amount":51.35,"total":446.35,"currency":"CA$","quote_version_id":"15000000-0000-0000-0000-000000000001","pricing_snapshot_id":"14000000-0000-0000-0000-000000000001","marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 3: schedule_window — confirmed
-- ---------------------------------------------------------------------------

INSERT INTO public.schedule_window (
  id, organization_id, business_unit_id, jurisdiction_id,
  operational_job_id,
  scheduled_start, scheduled_end,
  timezone, status, metadata
)
VALUES (
  '21000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  (SELECT jurisdiction_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  now() + interval '1 day',
  now() + interval '1 day' + interval '4 hours',
  'America/Toronto',
  'confirmed',
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- Transition operational_job to scheduled
UPDATE public.operational_job
SET    operational_status = 'scheduled'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 4: worker_assignment
-- ---------------------------------------------------------------------------

INSERT INTO public.worker_assignment (
  id, organization_id, business_unit_id,
  operational_job_id, schedule_window_id,
  worker_id,
  assignment_role, assignment_status, assigned_at, metadata
)
VALUES (
  '22000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '21000000-0000-0000-0000-000000000001'::uuid,
  '18000000-0000-0000-0000-000000000001'::uuid,
  'service_worker',
  'acknowledged',
  now(),
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 5: work_order — draft then published
-- ---------------------------------------------------------------------------

INSERT INTO public.work_order (
  id, organization_id, business_unit_id, jurisdiction_id,
  operational_job_id, schedule_window_id,
  work_order_status,
  scope_snapshot,
  checklist_template_snapshot,
  pricing_reference_snapshot,
  published_at,
  metadata
)
VALUES (
  '23000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  (SELECT jurisdiction_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '21000000-0000-0000-0000-000000000001'::uuid,
  'published',
  '{"sqft":1500,"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{"items":["dust","vacuum","mop"]}'::jsonb,
  '{"pre_tax_total":395.00,"total":446.35,"currency":"CA$","reference_only":true,"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  now(),
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- Dispatch the job
UPDATE public.operational_job
SET    operational_status = 'dispatched'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

-- Move work_order to in_progress
UPDATE public.work_order
SET    work_order_status = 'in_progress',
       started_at        = now()
WHERE  id = '23000000-0000-0000-0000-000000000001'::uuid;

-- Move operational_job to in_progress
UPDATE public.operational_job
SET    operational_status = 'in_progress'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 6: work_order_event — execution events
-- ---------------------------------------------------------------------------

INSERT INTO public.work_order_event (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id, worker_assignment_id,
  event_type, event_at, actor_worker_id, event_payload
)
VALUES
  ('24000000-0000-0000-0000-000000000001'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   '22000000-0000-0000-0000-000000000001'::uuid,
   'arrived',
   now(),
   '18000000-0000-0000-0000-000000000001'::uuid,
   '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb),

  ('24000000-0000-0000-0000-000000000002'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   '22000000-0000-0000-0000-000000000001'::uuid,
   'work_started',
   now(),
   '18000000-0000-0000-0000-000000000001'::uuid,
   '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb);

-- ---------------------------------------------------------------------------
-- STEP 7: completion_evidence
-- ---------------------------------------------------------------------------

INSERT INTO public.completion_evidence (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id, worker_assignment_id,
  evidence_type, captured_at, captured_by_worker_id,
  evidence_payload
)
VALUES
  ('25000000-0000-0000-0000-000000000001'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   '22000000-0000-0000-0000-000000000001'::uuid,
   'photo_before',
   now(),
   '18000000-0000-0000-0000-000000000001'::uuid,
   '{"storage_reference":"rehearsal/before.jpg","marker":"wave3_m008_rehearsal_v1"}'::jsonb),

  ('25000000-0000-0000-0000-000000000002'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   '22000000-0000-0000-0000-000000000001'::uuid,
   'photo_after',
   now(),
   '18000000-0000-0000-0000-000000000001'::uuid,
   '{"storage_reference":"rehearsal/after.jpg","marker":"wave3_m008_rehearsal_v1"}'::jsonb);

-- ---------------------------------------------------------------------------
-- STEP 8: service_checklist_result
-- ---------------------------------------------------------------------------

INSERT INTO public.service_checklist_result (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id,
  checklist_item_key, checklist_item_label,
  result_status,
  result_payload,
  completed_by_worker_id, completed_at
)
VALUES
  ('26000000-0000-0000-0000-000000000001'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   'dust_surfaces', 'Dust all surfaces',
   'pass',
   '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
   '18000000-0000-0000-0000-000000000001'::uuid, now()),

  ('26000000-0000-0000-0000-000000000002'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   'vacuum_floors', 'Vacuum all floors',
   'pass',
   '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
   '18000000-0000-0000-0000-000000000001'::uuid, now()),

  ('26000000-0000-0000-0000-000000000003'::uuid,
   (SELECT organization_id FROM pg_temp.m008_scope),
   (SELECT business_unit_id FROM pg_temp.m008_scope),
   '20000000-0000-0000-0000-000000000001'::uuid,
   '23000000-0000-0000-0000-000000000001'::uuid,
   'mop_floors', 'Mop hard floors',
   'pass',
   '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
   '18000000-0000-0000-0000-000000000001'::uuid, now());

-- ---------------------------------------------------------------------------
-- STEP 9: work_order and operational_job -> service_complete
-- ---------------------------------------------------------------------------

INSERT INTO public.work_order_event (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id, worker_assignment_id,
  event_type, event_at, actor_worker_id, event_payload
)
VALUES (
  '27000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '23000000-0000-0000-0000-000000000001'::uuid,
  '22000000-0000-0000-0000-000000000001'::uuid,
  'work_completed',
  now(),
  '18000000-0000-0000-0000-000000000001'::uuid,
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

UPDATE public.work_order
SET    work_order_status    = 'service_complete',
       service_completed_at = now()
WHERE  id = '23000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.operational_job
SET    operational_status = 'service_complete'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

-- operational_job -> qa_pending
UPDATE public.operational_job
SET    operational_status = 'qa_pending'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 10: qa_inspection — passed
-- ---------------------------------------------------------------------------

INSERT INTO public.qa_inspection (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id,
  inspection_status, inspection_type,
  score, findings, inspected_at
)
VALUES (
  '28000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '23000000-0000-0000-0000-000000000001'::uuid,
  'passed',
  'standard',
  98.0,
  '{"notes":"All checklist items passed. No issues found.","marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  now()
);

-- operational_job -> qa_passed
UPDATE public.operational_job
SET    operational_status = 'qa_passed'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

INSERT INTO public.work_order_event (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id,
  event_type, event_at, event_payload
)
VALUES (
  '28000000-0000-0000-0000-000000000002'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '23000000-0000-0000-0000-000000000001'::uuid,
  'qa_passed',
  now(),
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 11: work_order -> qa_complete -> closed
-- ---------------------------------------------------------------------------

UPDATE public.work_order
SET    work_order_status = 'qa_complete'
WHERE  id = '23000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.work_order
SET    work_order_status = 'closed'
WHERE  id = '23000000-0000-0000-0000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- STEP 12: operational_job -> closed
-- ---------------------------------------------------------------------------

UPDATE public.operational_job
SET    operational_status = 'closed'
WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;

INSERT INTO public.work_order_event (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id,
  event_type, event_at, event_payload
)
VALUES (
  '29000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '23000000-0000-0000-0000-000000000001'::uuid,
  'closed',
  now(),
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- STEP 13: operational_handoff — Wave 3 -> Wave 4 boundary
-- Lineage must match immutable operational_job commercial authority.
-- ---------------------------------------------------------------------------

INSERT INTO public.operational_handoff (
  id, organization_id, business_unit_id,
  operational_job_id, work_order_id,
  qa_inspection_id,
  pricing_snapshot_id, quote_version_id,
  handoff_status, handoff_payload, metadata, handed_off_at
)
VALUES (
  '30000000-0000-0000-0000-000000000001'::uuid,
  (SELECT organization_id FROM pg_temp.m008_scope),
  (SELECT business_unit_id FROM pg_temp.m008_scope),
  '20000000-0000-0000-0000-000000000001'::uuid,
  '23000000-0000-0000-0000-000000000001'::uuid,
  '28000000-0000-0000-0000-000000000001'::uuid,
  '14000000-0000-0000-0000-000000000001'::uuid,
  '15000000-0000-0000-0000-000000000001'::uuid,
  'ready',
  '{"source":"wave3_rehearsal","marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  '{"marker":"wave3_m008_rehearsal_v1"}'::jsonb,
  now()
);

-- ---------------------------------------------------------------------------
-- STEP 14: In-transaction sanity assertions (will rollback on failure)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_oj_status          text;
  v_wo_status          text;
  v_qa_status          text;
  v_oh_status          text;
  v_event_count        integer;
  v_evidence_count     integer;
  v_checklist_pass     integer;
  v_ps_cfg_version_id  uuid;
  v_oh_ps_id           uuid;
  v_oh_qv_id           uuid;
BEGIN
  -- operational_job must be closed
  SELECT operational_status INTO v_oj_status
  FROM   public.operational_job
  WHERE  id = '20000000-0000-0000-0000-000000000001'::uuid;
  IF v_oj_status <> 'closed' THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: operational_job status = % (expected closed)', v_oj_status;
  END IF;

  -- work_order must be closed
  SELECT work_order_status INTO v_wo_status
  FROM   public.work_order
  WHERE  id = '23000000-0000-0000-0000-000000000001'::uuid;
  IF v_wo_status <> 'closed' THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: work_order status = % (expected closed)', v_wo_status;
  END IF;

  -- qa_inspection must be passed
  SELECT inspection_status INTO v_qa_status
  FROM   public.qa_inspection
  WHERE  id = '28000000-0000-0000-0000-000000000001'::uuid;
  IF v_qa_status <> 'passed' THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: qa_inspection status = % (expected passed)', v_qa_status;
  END IF;

  -- operational_handoff must be ready
  SELECT handoff_status INTO v_oh_status
  FROM   public.operational_handoff
  WHERE  id = '30000000-0000-0000-0000-000000000001'::uuid;
  IF v_oh_status <> 'ready' THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: operational_handoff status = % (expected ready)', v_oh_status;
  END IF;

  -- At least 4 events
  SELECT COUNT(*) INTO v_event_count
  FROM   public.work_order_event
  WHERE  operational_job_id = '20000000-0000-0000-0000-000000000001'::uuid;
  IF v_event_count < 4 THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: only % work_order_event rows (expected >= 4)', v_event_count;
  END IF;

  -- 2 evidence records
  SELECT COUNT(*) INTO v_evidence_count
  FROM   public.completion_evidence
  WHERE  operational_job_id = '20000000-0000-0000-0000-000000000001'::uuid;
  IF v_evidence_count < 2 THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: only % completion_evidence rows (expected >= 2)', v_evidence_count;
  END IF;

  -- All 3 checklist items pass
  SELECT COUNT(*) INTO v_checklist_pass
  FROM   public.service_checklist_result
  WHERE  work_order_id = '23000000-0000-0000-0000-000000000001'::uuid
    AND  result_status = 'pass';
  IF v_checklist_pass <> 3 THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: % checklist pass rows (expected 3)', v_checklist_pass;
  END IF;

  -- pricing_snapshot configuration_version_id must match resolved governed scope
  SELECT configuration_version_id INTO v_ps_cfg_version_id
  FROM   public.pricing_snapshot
  WHERE  id = '14000000-0000-0000-0000-000000000001'::uuid;
  IF v_ps_cfg_version_id IS DISTINCT FROM (SELECT configuration_version_id FROM pg_temp.m008_scope) THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: pricing_snapshot.configuration_version_id does not match resolved published configuration';
  END IF;

  -- operational_handoff lineage matches operational_job commercial authority
  SELECT oh.pricing_snapshot_id, oh.quote_version_id
  INTO   v_oh_ps_id, v_oh_qv_id
  FROM   public.operational_handoff oh
  WHERE  oh.id = '30000000-0000-0000-0000-000000000001'::uuid;

  IF v_oh_ps_id <> '14000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: operational_handoff pricing_snapshot_id mismatch';
  END IF;
  IF v_oh_qv_id <> '15000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'M008 rehearsal assertion FAIL: operational_handoff quote_version_id mismatch';
  END IF;

  RAISE NOTICE 'M008 in-transaction assertions: PASS';
END;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK — no artifacts are committed
-- ---------------------------------------------------------------------------

ROLLBACK;

-- =============================================================================
-- POST-ROLLBACK ZERO-ARTIFACT VERIFICATION
-- =============================================================================
-- This is a READ-ONLY statement executed after the transaction has rolled back.
-- It checks that no Wave 3 records bearing the rehearsal marker remain.
-- Execute this statement separately after running the ROLLBACK above.
-- =============================================================================

WITH rehearsal_artifacts AS (
  SELECT
    (
      -- Wave 1/2 synthetic records created by this rehearsal
      (SELECT COUNT(*) FROM public.customer
       WHERE id = 'd0000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.contact
         WHERE id = 'e0000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.service_location
         WHERE id = 'f0000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.service_request
         WHERE id = '11000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.opportunity
         WHERE id = '12000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.estimate
         WHERE id = '0e000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.quote
         WHERE id = '13000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.pricing_snapshot
         WHERE id = '14000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.quote_version
         WHERE id = '15000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.quote_response
         WHERE id = '0a000000-0000-0000-0000-000000000002'::uuid)
      + (SELECT COUNT(*) FROM public.conversion_record
         WHERE id = '16000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.job_handoff
         WHERE id = '17000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.worker
         WHERE id = '18000000-0000-0000-0000-000000000001'::uuid)

      -- Wave 3 synthetic records created by this rehearsal
      + (SELECT COUNT(*) FROM public.operational_job
         WHERE id = '20000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.schedule_window
         WHERE id = '21000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.worker_assignment
         WHERE id = '22000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.work_order
         WHERE id = '23000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.work_order_event
         WHERE id IN (
           '24000000-0000-0000-0000-000000000001'::uuid,
           '24000000-0000-0000-0000-000000000002'::uuid,
           '27000000-0000-0000-0000-000000000001'::uuid,
           '28000000-0000-0000-0000-000000000002'::uuid,
           '29000000-0000-0000-0000-000000000001'::uuid
         ))
      + (SELECT COUNT(*) FROM public.completion_evidence
         WHERE id IN (
           '25000000-0000-0000-0000-000000000001'::uuid,
           '25000000-0000-0000-0000-000000000002'::uuid
         ))
      + (SELECT COUNT(*) FROM public.service_checklist_result
         WHERE id IN (
           '26000000-0000-0000-0000-000000000001'::uuid,
           '26000000-0000-0000-0000-000000000002'::uuid,
           '26000000-0000-0000-0000-000000000003'::uuid
         ))
      + (SELECT COUNT(*) FROM public.qa_inspection
         WHERE id = '28000000-0000-0000-0000-000000000001'::uuid)
      + (SELECT COUNT(*) FROM public.corrective_action
         WHERE resolution_payload::text LIKE '%wave3_m008_rehearsal_v1%')
      + (SELECT COUNT(*) FROM public.operational_handoff
         WHERE id = '30000000-0000-0000-0000-000000000001'::uuid)
    ) AS remaining_artifact_count
)
SELECT
  CASE
    WHEN remaining_artifact_count = 0
    THEN 'M008_REHEARSAL_PASS_ROLLED_BACK'
    ELSE 'M008_REHEARSAL_FAIL_ARTIFACTS_REMAIN'
  END AS result,
  remaining_artifact_count
FROM rehearsal_artifacts;
