-- =============================================================================
-- MIGRATION 007 — WAVE 3: SCHEDULING / WORK EXECUTION / QA
-- =============================================================================
-- Additive only. No huc_* table is altered, dropped, or granted.
-- DATABASE EXECUTION NOT YET AUTHORIZED.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 0: HELPER FUNCTIONS
-- ---------------------------------------------------------------------------

-- current_worker_id: returns the worker.id for the authenticated app user
-- within a given organization.  Returns NULL if no active worker record exists.
CREATE OR REPLACE FUNCTION public.current_worker_id(target_org uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM   public.worker w
  WHERE  w.organization_id = target_org
    AND  w.app_user_id     = public.current_app_user_id()
    AND  w.status          = 'active';

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_count > 1 THEN
    -- Fail closed: multiple active workers is ambiguous; return deterministically
    -- by lowest id. In practice org design should prevent this.
    SELECT w.id INTO v_id
    FROM   public.worker w
    WHERE  w.organization_id = target_org
      AND  w.app_user_id     = public.current_app_user_id()
      AND  w.status          = 'active'
    ORDER BY w.id
    LIMIT 1;
    RETURN v_id;
  END IF;

  SELECT w.id INTO v_id
  FROM   public.worker w
  WHERE  w.organization_id = target_org
    AND  w.app_user_id     = public.current_app_user_id()
    AND  w.status          = 'active';
  RETURN v_id;
END;
$$;



-- ---------------------------------------------------------------------------
-- SECTION 1: TABLE DEFINITIONS
-- ---------------------------------------------------------------------------

-- ============================================================
-- 1. operational_job
-- ============================================================
CREATE TABLE public.operational_job (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,
  jurisdiction_id               uuid        NOT NULL,

  job_handoff_id                uuid        NOT NULL UNIQUE,
  conversion_record_id          uuid        NOT NULL,
  quote_version_id              uuid        NOT NULL,
  pricing_snapshot_id           uuid        NOT NULL,

  customer_id                   uuid        NOT NULL,
  contact_id                    uuid        NOT NULL,
  service_location_id           uuid        NOT NULL,

  service_family                text        NOT NULL,

  operational_status            text        NOT NULL DEFAULT 'ready_to_schedule',

  service_scope_snapshot        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  commercial_authority_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id        uuid        NULL,
  updated_by_app_user_id        uuid        NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_oj_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_oj_job_handoff
    FOREIGN KEY (job_handoff_id)
    REFERENCES public.job_handoff(id),

  CONSTRAINT fk_oj_conversion_record
    FOREIGN KEY (conversion_record_id)
    REFERENCES public.conversion_record(id),

  CONSTRAINT fk_oj_quote_version
    FOREIGN KEY (quote_version_id)
    REFERENCES public.quote_version(id),

  CONSTRAINT fk_oj_pricing_snapshot
    FOREIGN KEY (pricing_snapshot_id)
    REFERENCES public.pricing_snapshot(id),

  CONSTRAINT fk_oj_customer
    FOREIGN KEY (customer_id)
    REFERENCES public.customer(id),

  CONSTRAINT fk_oj_contact
    FOREIGN KEY (contact_id)
    REFERENCES public.contact(id),

  CONSTRAINT fk_oj_service_location
    FOREIGN KEY (service_location_id)
    REFERENCES public.service_location(id),

  CONSTRAINT ck_oj_status CHECK (
    operational_status IN (
      'ready_to_schedule',
      'scheduled',
      'dispatched',
      'in_progress',
      'service_complete',
      'qa_pending',
      'qa_passed',
      'corrective_action_required',
      'closed',
      'cancelled'
    )
  ),

  CONSTRAINT ck_oj_service_family_nonempty CHECK (
    service_family <> ''
  )
);

-- ============================================================
-- 2. schedule_window
-- ============================================================
CREATE TABLE public.schedule_window (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NOT NULL,
  jurisdiction_id           uuid        NOT NULL,
  operational_job_id        uuid        NOT NULL,

  scheduled_start           timestamptz NOT NULL,
  scheduled_end             timestamptz NOT NULL,
  timezone                  text        NOT NULL,

  status                    text        NOT NULL DEFAULT 'planned',

  scheduling_notes          text        NULL,
  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id    uuid        NULL,
  updated_by_app_user_id    uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_sw_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_sw_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT ck_sw_status CHECK (
    status IN ('planned', 'confirmed', 'dispatched', 'fulfilled', 'cancelled', 'rescheduled')
  ),

  CONSTRAINT ck_sw_end_after_start CHECK (
    scheduled_end > scheduled_start
  )
);

-- Only one active (non-cancelled/non-rescheduled) window per job at a time.
CREATE UNIQUE INDEX uix_sw_active_per_job
  ON public.schedule_window (operational_job_id)
  WHERE status NOT IN ('cancelled', 'rescheduled', 'fulfilled');

-- ============================================================
-- 3. worker_assignment
-- ============================================================
CREATE TABLE public.worker_assignment (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NOT NULL,
  operational_job_id        uuid        NOT NULL,
  schedule_window_id        uuid        NOT NULL,
  worker_id                 uuid        NOT NULL,

  assignment_role           text        NOT NULL DEFAULT 'service_worker',
  assignment_status         text        NOT NULL DEFAULT 'proposed',

  assigned_at               timestamptz NULL,
  acknowledged_at           timestamptz NULL,
  released_at               timestamptz NULL,

  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id    uuid        NULL,
  updated_by_app_user_id    uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_wa_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_wa_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_wa_schedule_window
    FOREIGN KEY (schedule_window_id)
    REFERENCES public.schedule_window(id),

  CONSTRAINT fk_wa_worker
    FOREIGN KEY (worker_id)
    REFERENCES public.worker(id),

  CONSTRAINT ck_wa_role CHECK (
    assignment_role IN ('service_worker', 'team_lead', 'trainee', 'inspector')
  ),

  CONSTRAINT ck_wa_status CHECK (
    assignment_status IN (
      'proposed', 'assigned', 'acknowledged',
      'declined', 'released', 'completed', 'cancelled'
    )
  )
);

-- One active assignment per worker per schedule_window.
CREATE UNIQUE INDEX uix_wa_active_worker_window
  ON public.worker_assignment (worker_id, schedule_window_id)
  WHERE assignment_status NOT IN ('declined', 'released', 'cancelled');

-- ============================================================
-- 4. work_order
-- ============================================================
CREATE TABLE public.work_order (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id                 uuid        NOT NULL,
  business_unit_id                uuid        NOT NULL,
  jurisdiction_id                 uuid        NOT NULL,

  operational_job_id              uuid        NOT NULL UNIQUE,
  schedule_window_id              uuid        NULL,

  work_order_number               text        NULL,

  work_order_status               text        NOT NULL DEFAULT 'draft',

  scope_snapshot                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  customer_instruction_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  access_instruction_snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checklist_template_snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  safety_instruction_snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  pricing_reference_snapshot      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  published_at                    timestamptz NULL,
  started_at                      timestamptz NULL,
  service_completed_at            timestamptz NULL,

  metadata                        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id          uuid        NULL,
  updated_by_app_user_id          uuid        NULL,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_wo_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_wo_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_wo_schedule_window
    FOREIGN KEY (schedule_window_id)
    REFERENCES public.schedule_window(id),

  CONSTRAINT ck_wo_status CHECK (
    work_order_status IN (
      'draft', 'published', 'in_progress',
      'service_complete', 'qa_complete', 'closed', 'cancelled'
    )
  )
);

-- ============================================================
-- 5. work_order_event  (append-only)
-- ============================================================
CREATE TABLE public.work_order_event (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id         uuid        NOT NULL,
  business_unit_id        uuid        NOT NULL,

  operational_job_id      uuid        NOT NULL,
  work_order_id           uuid        NOT NULL,
  worker_assignment_id    uuid        NULL,

  event_type              text        NOT NULL,
  event_at                timestamptz NOT NULL DEFAULT now(),

  actor_app_user_id       uuid        NULL,
  actor_worker_id         uuid        NULL,

  event_payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_woe_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_woe_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_woe_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_woe_worker_assignment
    FOREIGN KEY (worker_assignment_id)
    REFERENCES public.worker_assignment(id),

  CONSTRAINT ck_woe_event_type CHECK (
    event_type IN (
      'scheduled',
      'assignment_created',
      'assignment_acknowledged',
      'dispatched',
      'arrived',
      'work_started',
      'paused',
      'resumed',
      'work_completed',
      'completion_submitted',
      'qa_requested',
      'qa_passed',
      'qa_failed',
      'corrective_action_opened',
      'corrective_action_completed',
      'customer_issue_reported',
      'closed'
    )
  )
);

-- ============================================================
-- 6. completion_evidence  (append-only)
-- ============================================================
CREATE TABLE public.completion_evidence (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,

  operational_job_id          uuid        NOT NULL,
  work_order_id               uuid        NOT NULL,
  worker_assignment_id        uuid        NULL,

  evidence_type               text        NOT NULL,

  storage_system              text        NULL,
  storage_reference           text        NULL,

  evidence_payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  captured_at                 timestamptz NOT NULL,

  captured_by_worker_id       uuid        NULL,
  captured_by_app_user_id     uuid        NULL,

  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_ce_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_ce_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_ce_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_ce_worker_assignment
    FOREIGN KEY (worker_assignment_id)
    REFERENCES public.worker_assignment(id),

  CONSTRAINT ck_ce_evidence_type CHECK (
    evidence_type IN (
      'photo_before', 'photo_after', 'photo_detail',
      'note', 'signature', 'timestamp', 'other'
    )
  )
);

-- ============================================================
-- 7. service_checklist_result
-- ============================================================
CREATE TABLE public.service_checklist_result (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,

  operational_job_id          uuid        NOT NULL,
  work_order_id               uuid        NOT NULL,

  checklist_item_key          text        NOT NULL,
  checklist_item_label        text        NOT NULL,

  result_status               text        NOT NULL DEFAULT 'pending',

  result_payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,

  completed_by_worker_id      uuid        NULL,
  completed_by_app_user_id    uuid        NULL,
  completed_at                timestamptz NULL,

  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_scr_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_scr_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_scr_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT ck_scr_result_status CHECK (
    result_status IN ('pending', 'pass', 'fail', 'not_applicable')
  ),

  CONSTRAINT uq_scr_item_per_work_order
    UNIQUE (work_order_id, checklist_item_key)
);

-- ============================================================
-- 8. qa_inspection
-- ============================================================
CREATE TABLE public.qa_inspection (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id         uuid        NOT NULL,
  business_unit_id        uuid        NOT NULL,

  operational_job_id      uuid        NOT NULL,
  work_order_id           uuid        NOT NULL,

  inspector_worker_id     uuid        NULL,
  inspector_app_user_id   uuid        NULL,

  inspection_status       text        NOT NULL DEFAULT 'pending',
  inspection_type         text        NOT NULL DEFAULT 'standard',

  score                   numeric     NULL,

  findings                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  inspected_at            timestamptz NULL,
  waiver_reason           text        NULL,

  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_qi_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_qi_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_qi_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT ck_qi_status CHECK (
    inspection_status IN (
      'pending', 'in_progress', 'passed', 'failed', 'waived'
    )
  ),

  CONSTRAINT ck_qi_type CHECK (
    inspection_type IN (
      'standard', 'spot_check', 'customer_issue', 'reinspection'
    )
  )
);

-- ============================================================
-- 9. corrective_action
-- ============================================================
CREATE TABLE public.corrective_action (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NOT NULL,

  operational_job_id        uuid        NOT NULL,
  work_order_id             uuid        NOT NULL,
  qa_inspection_id          uuid        NULL,

  action_status             text        NOT NULL DEFAULT 'open',
  action_type               text        NOT NULL,

  description               text        NOT NULL,

  assigned_worker_id        uuid        NULL,

  due_at                    timestamptz NULL,

  resolution_payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  resolved_at               timestamptz NULL,
  verified_at               timestamptz NULL,

  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id    uuid        NULL,
  updated_by_app_user_id    uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_ca_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_ca_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_ca_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_ca_qa_inspection
    FOREIGN KEY (qa_inspection_id)
    REFERENCES public.qa_inspection(id),

  CONSTRAINT ck_ca_status CHECK (
    action_status IN (
      'open', 'assigned', 'in_progress',
      'resolved', 'verified', 'cancelled'
    )
  ),

  CONSTRAINT ck_ca_type CHECK (
    action_type IN (
      'rework', 'customer_recovery', 'safety', 'documentation', 'other'
    )
  ),

  CONSTRAINT ck_ca_description_nonempty CHECK (
    description <> ''
  )
);

-- ============================================================
-- 10. operational_handoff
-- ============================================================
CREATE TABLE public.operational_handoff (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NOT NULL,

  operational_job_id        uuid        NOT NULL UNIQUE,
  work_order_id             uuid        NOT NULL,
  qa_inspection_id          uuid        NULL,

  pricing_snapshot_id       uuid        NOT NULL,
  quote_version_id          uuid        NOT NULL,

  handoff_status            text        NOT NULL DEFAULT 'ready',

  handoff_payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  handed_off_at             timestamptz NOT NULL DEFAULT now(),

  created_by_app_user_id    uuid        NULL,

  CONSTRAINT fk_oh_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_oh_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_oh_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_oh_qa_inspection
    FOREIGN KEY (qa_inspection_id)
    REFERENCES public.qa_inspection(id),

  CONSTRAINT fk_oh_pricing_snapshot
    FOREIGN KEY (pricing_snapshot_id)
    REFERENCES public.pricing_snapshot(id),

  CONSTRAINT fk_oh_quote_version
    FOREIGN KEY (quote_version_id)
    REFERENCES public.quote_version(id),

  CONSTRAINT ck_oh_status CHECK (
    handoff_status IN ('ready', 'consumed', 'cancelled')
  )
);

-- ---------------------------------------------------------------------------
-- SECTION 2: INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_oj_org_bu          ON public.operational_job (organization_id, business_unit_id);
CREATE INDEX idx_oj_status          ON public.operational_job (operational_status);
CREATE INDEX idx_oj_customer        ON public.operational_job (customer_id);
CREATE INDEX idx_oj_handoff         ON public.operational_job (job_handoff_id);

CREATE INDEX idx_sw_job             ON public.schedule_window (operational_job_id);
CREATE INDEX idx_sw_status          ON public.schedule_window (status);

CREATE INDEX idx_wa_job             ON public.worker_assignment (operational_job_id);
CREATE INDEX idx_wa_worker          ON public.worker_assignment (worker_id);
CREATE INDEX idx_wa_status          ON public.worker_assignment (assignment_status);

CREATE INDEX idx_wo_job             ON public.work_order (operational_job_id);
CREATE INDEX idx_wo_status          ON public.work_order (work_order_status);

CREATE INDEX idx_woe_job            ON public.work_order_event (operational_job_id);
CREATE INDEX idx_woe_type           ON public.work_order_event (event_type);

CREATE INDEX idx_ce_job             ON public.completion_evidence (operational_job_id);
CREATE INDEX idx_scr_job            ON public.service_checklist_result (operational_job_id);
CREATE INDEX idx_qi_job             ON public.qa_inspection (operational_job_id);
CREATE INDEX idx_qi_status          ON public.qa_inspection (inspection_status);
CREATE INDEX idx_coa_job            ON public.corrective_action (operational_job_id);
CREATE INDEX idx_coa_status         ON public.corrective_action (action_status);
CREATE INDEX idx_oh_job             ON public.operational_handoff (operational_job_id);

-- ---------------------------------------------------------------------------
-- SECTION 3: TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

-- ──────────────────────────────────────────────────────────────────────────
-- T01: updated_at auto-maintenance
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T02: operational_job — lineage / scope validation on INSERT
-- Verifies the full Wave 2 chain: job_handoff -> conversion_record ->
-- customer/contact/service_location -> jurisdiction
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_oj_lineage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_jh  public.job_handoff%ROWTYPE;
  v_cr  public.conversion_record%ROWTYPE;
  v_sl  public.service_location%ROWTYPE;
BEGIN
  -- Load job_handoff
  SELECT * INTO v_jh FROM public.job_handoff WHERE id = NEW.job_handoff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: job_handoff % not found', NEW.job_handoff_id;
  END IF;

  -- org/BU match
  IF v_jh.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff organization_id mismatch';
  END IF;
  IF v_jh.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff business_unit_id mismatch';
  END IF;

  -- lineage FK match
  IF v_jh.conversion_record_id <> NEW.conversion_record_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.conversion_record_id mismatch';
  END IF;
  IF v_jh.quote_version_id <> NEW.quote_version_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.quote_version_id mismatch';
  END IF;
  IF v_jh.pricing_snapshot_id <> NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.pricing_snapshot_id mismatch';
  END IF;

  -- Load conversion_record
  SELECT * INTO v_cr FROM public.conversion_record WHERE id = NEW.conversion_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: conversion_record % not found', NEW.conversion_record_id;
  END IF;

  IF v_cr.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record organization_id mismatch';
  END IF;
  IF v_cr.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record business_unit_id mismatch';
  END IF;
  IF v_cr.customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.customer_id mismatch';
  END IF;
  IF v_cr.contact_id <> NEW.contact_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.contact_id mismatch';
  END IF;
  IF v_cr.service_location_id <> NEW.service_location_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.service_location_id mismatch';
  END IF;

  -- Load service_location for jurisdiction
  SELECT * INTO v_sl FROM public.service_location WHERE id = NEW.service_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: service_location % not found', NEW.service_location_id;
  END IF;
  IF v_sl.jurisdiction_id <> NEW.jurisdiction_id THEN
    RAISE EXCEPTION 'operational_job: service_location.jurisdiction_id mismatch';
  END IF;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T03: operational_job — immutable critical fields on UPDATE
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_guard_oj_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id            <> OLD.organization_id            THEN RAISE EXCEPTION 'operational_job: organization_id is immutable'; END IF;
  IF NEW.business_unit_id           <> OLD.business_unit_id           THEN RAISE EXCEPTION 'operational_job: business_unit_id is immutable'; END IF;
  IF NEW.jurisdiction_id            <> OLD.jurisdiction_id            THEN RAISE EXCEPTION 'operational_job: jurisdiction_id is immutable'; END IF;
  IF NEW.job_handoff_id             <> OLD.job_handoff_id             THEN RAISE EXCEPTION 'operational_job: job_handoff_id is immutable'; END IF;
  IF NEW.conversion_record_id       <> OLD.conversion_record_id       THEN RAISE EXCEPTION 'operational_job: conversion_record_id is immutable'; END IF;
  IF NEW.quote_version_id           <> OLD.quote_version_id           THEN RAISE EXCEPTION 'operational_job: quote_version_id is immutable'; END IF;
  IF NEW.pricing_snapshot_id        <> OLD.pricing_snapshot_id        THEN RAISE EXCEPTION 'operational_job: pricing_snapshot_id is immutable'; END IF;
  IF NEW.customer_id                <> OLD.customer_id                THEN RAISE EXCEPTION 'operational_job: customer_id is immutable'; END IF;
  IF NEW.contact_id                 <> OLD.contact_id                 THEN RAISE EXCEPTION 'operational_job: contact_id is immutable'; END IF;
  IF NEW.service_location_id        <> OLD.service_location_id        THEN RAISE EXCEPTION 'operational_job: service_location_id is immutable'; END IF;
  IF NEW.service_family             <> OLD.service_family             THEN RAISE EXCEPTION 'operational_job: service_family is immutable'; END IF;
  IF NEW.commercial_authority_snapshot <> OLD.commercial_authority_snapshot THEN RAISE EXCEPTION 'operational_job: commercial_authority_snapshot is immutable'; END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T04: operational_job — lifecycle transition guard
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_guard_oj_lifecycle()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.operational_status = NEW.operational_status THEN
    RETURN NEW;
  END IF;

  -- Terminal states may not transition further
  IF OLD.operational_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'operational_job: cannot transition from terminal status %', OLD.operational_status;
  END IF;

  -- Cancellation only allowed before service begins
  IF NEW.operational_status = 'cancelled' THEN
    IF OLD.operational_status NOT IN ('ready_to_schedule', 'scheduled', 'dispatched') THEN
      RAISE EXCEPTION 'operational_job: cancellation not allowed from status %', OLD.operational_status;
    END IF;
    RETURN NEW;
  END IF;

  -- Governed forward transitions
  CASE OLD.operational_status
    WHEN 'ready_to_schedule' THEN
      IF NEW.operational_status NOT IN ('scheduled', 'cancelled') THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'scheduled' THEN
      IF NEW.operational_status NOT IN ('dispatched', 'cancelled') THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'dispatched' THEN
      IF NEW.operational_status NOT IN ('in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'in_progress' THEN
      IF NEW.operational_status <> 'service_complete' THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'service_complete' THEN
      IF NEW.operational_status <> 'qa_pending' THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'qa_pending' THEN
      IF NEW.operational_status NOT IN ('qa_passed', 'corrective_action_required') THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'corrective_action_required' THEN
      IF NEW.operational_status NOT IN ('qa_pending', 'qa_passed') THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    WHEN 'qa_passed' THEN
      IF NEW.operational_status <> 'closed' THEN
        RAISE EXCEPTION 'operational_job: invalid transition % -> %', OLD.operational_status, NEW.operational_status;
      END IF;
    ELSE
      RAISE EXCEPTION 'operational_job: unrecognised source status %', OLD.operational_status;
  END CASE;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T05: operational_job — close gate: no open corrective_action
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_guard_oj_close_gate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_blocking integer;
BEGIN
  IF NEW.operational_status <> 'closed' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_blocking
  FROM   public.corrective_action
  WHERE  operational_job_id = NEW.id
    AND  action_status NOT IN ('verified', 'cancelled');

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'operational_job: cannot close — % unresolved corrective action(s) remain', v_blocking;
  END IF;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T06: schedule_window — scope and time control
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_sw_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_window: operational_job % not found', NEW.operational_job_id;
  END IF;
  IF v_oj.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'schedule_window: organization_id mismatch with operational_job';
  END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'schedule_window: business_unit_id mismatch with operational_job';
  END IF;
  IF v_oj.jurisdiction_id <> NEW.jurisdiction_id THEN
    RAISE EXCEPTION 'schedule_window: jurisdiction_id mismatch with operational_job';
  END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T07: worker_assignment — scope / lifecycle / immutable identity
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_wa_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
  v_sw public.schedule_window%ROWTYPE;
  v_wk public.worker%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_assignment: operational_job % not found', NEW.operational_job_id;
  END IF;
  SELECT * INTO v_sw FROM public.schedule_window WHERE id = NEW.schedule_window_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_assignment: schedule_window % not found', NEW.schedule_window_id;
  END IF;
  IF v_sw.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'worker_assignment: schedule_window does not belong to operational_job';
  END IF;
  SELECT * INTO v_wk FROM public.worker WHERE id = NEW.worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_assignment: worker % not found', NEW.worker_id;
  END IF;
  IF v_wk.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'worker_assignment: worker organization_id mismatch';
  END IF;
  IF v_wk.business_unit_id IS NOT NULL AND v_wk.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'worker_assignment: worker business_unit_id mismatch';
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- worker_assignment lifecycle guard
-- Controlled transitions:
--   proposed   -> assigned | declined | cancelled
--   assigned   -> acknowledged | declined | released | cancelled
--   acknowledged -> completed | released | cancelled
--   declined / released / completed / cancelled = terminal
--
-- Worker self-service: only assigned->acknowledged|declined and
-- acknowledged->completed are permitted when updater IS the assignment worker.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wave3_guard_wa_lifecycle()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_current_worker_id uuid;
  v_is_self_update    boolean;
BEGIN
  -- Terminal states are immutable
  IF OLD.assignment_status IN ('declined', 'released', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'worker_assignment: status % is terminal and cannot be changed', OLD.assignment_status;
  END IF;

  -- No-op if status unchanged
  IF NEW.assignment_status = OLD.assignment_status THEN
    RETURN NEW;
  END IF;

  -- Validate state machine transitions
  CASE OLD.assignment_status
    WHEN 'proposed' THEN
      IF NEW.assignment_status NOT IN ('assigned', 'declined', 'cancelled') THEN
        RAISE EXCEPTION 'worker_assignment: invalid transition % -> %', OLD.assignment_status, NEW.assignment_status;
      END IF;
    WHEN 'assigned' THEN
      IF NEW.assignment_status NOT IN ('acknowledged', 'declined', 'released', 'cancelled') THEN
        RAISE EXCEPTION 'worker_assignment: invalid transition % -> %', OLD.assignment_status, NEW.assignment_status;
      END IF;
    WHEN 'acknowledged' THEN
      IF NEW.assignment_status NOT IN ('completed', 'released', 'cancelled') THEN
        RAISE EXCEPTION 'worker_assignment: invalid transition % -> %', OLD.assignment_status, NEW.assignment_status;
      END IF;
    ELSE
      RAISE EXCEPTION 'worker_assignment: unrecognised source status %', OLD.assignment_status;
  END CASE;

  -- Self-update restriction: if the session user IS the assigned worker,
  -- only the subset of operationally valid worker transitions are permitted.
  SELECT public.current_worker_id(OLD.organization_id) INTO v_current_worker_id;
  v_is_self_update := (v_current_worker_id IS NOT NULL AND v_current_worker_id = OLD.worker_id);

  IF v_is_self_update THEN
    IF OLD.assignment_status = 'assigned' AND NEW.assignment_status NOT IN ('acknowledged', 'declined') THEN
      RAISE EXCEPTION 'worker_assignment: worker may only self-transition assigned->acknowledged|declined';
    END IF;
    IF OLD.assignment_status = 'acknowledged' AND NEW.assignment_status NOT IN ('completed') THEN
      RAISE EXCEPTION 'worker_assignment: worker may only self-transition acknowledged->completed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.wave3_guard_wa_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id      <> OLD.organization_id      THEN RAISE EXCEPTION 'worker_assignment: organization_id is immutable'; END IF;
  IF NEW.business_unit_id     <> OLD.business_unit_id     THEN RAISE EXCEPTION 'worker_assignment: business_unit_id is immutable'; END IF;
  IF NEW.operational_job_id   <> OLD.operational_job_id   THEN RAISE EXCEPTION 'worker_assignment: operational_job_id is immutable'; END IF;
  IF NEW.schedule_window_id   <> OLD.schedule_window_id   THEN RAISE EXCEPTION 'worker_assignment: schedule_window_id is immutable'; END IF;
  IF NEW.worker_id            <> OLD.worker_id            THEN RAISE EXCEPTION 'worker_assignment: worker_id is immutable'; END IF;
  IF NEW.assignment_role      <> OLD.assignment_role      THEN RAISE EXCEPTION 'worker_assignment: assignment_role is immutable'; END IF;
  IF OLD.assigned_at IS NOT NULL AND NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'worker_assignment: assigned_at is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T08: work_order — scope / lifecycle
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_wo_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_order: operational_job % not found', NEW.operational_job_id;
  END IF;
  IF v_oj.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'work_order: organization_id mismatch'; END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'work_order: business_unit_id mismatch'; END IF;
  IF v_oj.jurisdiction_id  <> NEW.jurisdiction_id  THEN RAISE EXCEPTION 'work_order: jurisdiction_id mismatch'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave3_guard_wo_lifecycle()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.work_order_status = NEW.work_order_status THEN RETURN NEW; END IF;
  IF OLD.work_order_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'work_order: cannot transition from terminal status %', OLD.work_order_status;
  END IF;
  IF NEW.work_order_status = 'cancelled' THEN
    IF OLD.work_order_status NOT IN ('draft', 'published') THEN
      RAISE EXCEPTION 'work_order: cancellation not allowed from status %', OLD.work_order_status;
    END IF;
    RETURN NEW;
  END IF;
  CASE OLD.work_order_status
    WHEN 'draft'             THEN IF NEW.work_order_status <> 'published'         THEN RAISE EXCEPTION 'work_order: invalid transition % -> %', OLD.work_order_status, NEW.work_order_status; END IF;
    WHEN 'published'         THEN IF NEW.work_order_status <> 'in_progress'       THEN RAISE EXCEPTION 'work_order: invalid transition % -> %', OLD.work_order_status, NEW.work_order_status; END IF;
    WHEN 'in_progress'       THEN IF NEW.work_order_status <> 'service_complete'  THEN RAISE EXCEPTION 'work_order: invalid transition % -> %', OLD.work_order_status, NEW.work_order_status; END IF;
    WHEN 'service_complete'  THEN IF NEW.work_order_status <> 'qa_complete'       THEN RAISE EXCEPTION 'work_order: invalid transition % -> %', OLD.work_order_status, NEW.work_order_status; END IF;
    WHEN 'qa_complete'       THEN IF NEW.work_order_status <> 'closed'            THEN RAISE EXCEPTION 'work_order: invalid transition % -> %', OLD.work_order_status, NEW.work_order_status; END IF;
    ELSE RAISE EXCEPTION 'work_order: unrecognised source status %', OLD.work_order_status;
  END CASE;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T09: work_order — snapshot immutability after published
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_guard_wo_snapshot_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  -- Once published, these snapshots must not change
  IF OLD.work_order_status <> 'draft' THEN
    IF NEW.scope_snapshot                <> OLD.scope_snapshot                THEN RAISE EXCEPTION 'work_order: scope_snapshot is immutable after published'; END IF;
    IF NEW.customer_instruction_snapshot <> OLD.customer_instruction_snapshot THEN RAISE EXCEPTION 'work_order: customer_instruction_snapshot is immutable after published'; END IF;
    IF NEW.access_instruction_snapshot   <> OLD.access_instruction_snapshot   THEN RAISE EXCEPTION 'work_order: access_instruction_snapshot is immutable after published'; END IF;
    IF NEW.checklist_template_snapshot   <> OLD.checklist_template_snapshot   THEN RAISE EXCEPTION 'work_order: checklist_template_snapshot is immutable after published'; END IF;
    IF NEW.safety_instruction_snapshot   <> OLD.safety_instruction_snapshot   THEN RAISE EXCEPTION 'work_order: safety_instruction_snapshot is immutable after published'; END IF;
    IF NEW.pricing_reference_snapshot    <> OLD.pricing_reference_snapshot    THEN RAISE EXCEPTION 'work_order: pricing_reference_snapshot is immutable after published'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T10: work_order_event — append-only (forbid UPDATE / DELETE)
-- ──────────────────────────────────────────────────────────────────────────

-- work_order_event scope validator: cross-check operational_job/work_order chain
CREATE OR REPLACE FUNCTION public.wave3_validate_woe_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_wo public.work_order%ROWTYPE;
  v_wa public.worker_assignment%ROWTYPE;
BEGIN
  -- work_order must belong to the declared operational_job
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_order_event: work_order % not found', NEW.work_order_id;
  END IF;
  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'work_order_event: work_order does not belong to declared operational_job';
  END IF;
  IF v_wo.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'work_order_event: organization_id mismatch with work_order'; END IF;
  IF v_wo.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'work_order_event: business_unit_id mismatch with work_order'; END IF;

  -- worker_assignment, if provided, must belong to the same operational_job
  IF NEW.worker_assignment_id IS NOT NULL THEN
    SELECT * INTO v_wa FROM public.worker_assignment WHERE id = NEW.worker_assignment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'work_order_event: worker_assignment % not found', NEW.worker_assignment_id;
    END IF;
    IF v_wa.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'work_order_event: worker_assignment does not belong to declared operational_job';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.wave3_deny_woe_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'work_order_event: records are append-only and may not be % ', TG_OP;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T11: completion_evidence — append-only
-- ──────────────────────────────────────────────────────────────────────────

-- completion_evidence scope validator: cross-check operational_job/work_order chain
CREATE OR REPLACE FUNCTION public.wave3_validate_ce_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_wo public.work_order%ROWTYPE;
  v_wa public.worker_assignment%ROWTYPE;
BEGIN
  -- work_order must belong to the declared operational_job
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'completion_evidence: work_order % not found', NEW.work_order_id;
  END IF;
  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'completion_evidence: work_order does not belong to declared operational_job';
  END IF;
  IF v_wo.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'completion_evidence: organization_id mismatch with work_order'; END IF;
  IF v_wo.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'completion_evidence: business_unit_id mismatch with work_order'; END IF;

  -- worker_assignment, if provided, must belong to the same operational_job
  IF NEW.worker_assignment_id IS NOT NULL THEN
    SELECT * INTO v_wa FROM public.worker_assignment WHERE id = NEW.worker_assignment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'completion_evidence: worker_assignment % not found', NEW.worker_assignment_id;
    END IF;
    IF v_wa.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'completion_evidence: worker_assignment does not belong to declared operational_job';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.wave3_deny_ce_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'completion_evidence: records are append-only and may not be % ', TG_OP;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T12: service_checklist_result — final-result immutability
-- ──────────────────────────────────────────────────────────────────────────

-- service_checklist_result scope validator: cross-check work_order belongs to operational_job
CREATE OR REPLACE FUNCTION public.wave3_validate_scr_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_wo public.work_order%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_checklist_result: work_order % not found', NEW.work_order_id;
  END IF;
  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'service_checklist_result: work_order does not belong to declared operational_job';
  END IF;
  IF v_wo.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'service_checklist_result: organization_id mismatch with work_order'; END IF;
  IF v_wo.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'service_checklist_result: business_unit_id mismatch with work_order'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.wave3_guard_scr_final_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.result_status IN ('pass', 'fail', 'not_applicable') THEN
    RAISE EXCEPTION 'service_checklist_result: completed result is immutable (current status: %)', OLD.result_status;
  END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T13: qa_inspection — final outcome immutability + scope guard
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_guard_qi_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
  v_wo public.work_order%ROWTYPE;
  v_iw public.worker%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'qa_inspection: operational_job % not found', NEW.operational_job_id; END IF;
  IF v_oj.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'qa_inspection: organization_id mismatch'; END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'qa_inspection: business_unit_id mismatch'; END IF;

  -- work_order must belong to the declared operational_job
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'qa_inspection: work_order % not found', NEW.work_order_id; END IF;
    IF v_wo.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'qa_inspection: work_order does not belong to declared operational_job';
    END IF;
  END IF;

  -- inspector_worker_id, if provided, must belong to same organization
  IF NEW.inspector_worker_id IS NOT NULL THEN
    SELECT * INTO v_iw FROM public.worker WHERE id = NEW.inspector_worker_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'qa_inspection: inspector_worker % not found', NEW.inspector_worker_id; END IF;
    IF v_iw.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'qa_inspection: inspector_worker does not belong to same organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave3_guard_qi_final_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.inspection_status IN ('passed', 'failed', 'waived') THEN
    RAISE EXCEPTION 'qa_inspection: final outcome is immutable (status: %)', OLD.inspection_status;
  END IF;
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T14: corrective_action — scope / lifecycle guard
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_ca_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
  v_wo public.work_order%ROWTYPE;
  v_qi public.qa_inspection%ROWTYPE;
  v_aw public.worker%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'corrective_action: operational_job % not found', NEW.operational_job_id; END IF;
  IF v_oj.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'corrective_action: organization_id mismatch'; END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'corrective_action: business_unit_id mismatch'; END IF;

  -- work_order must belong to the declared operational_job
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'corrective_action: work_order % not found', NEW.work_order_id; END IF;
    IF v_wo.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'corrective_action: work_order does not belong to declared operational_job';
    END IF;
  END IF;

  -- qa_inspection, if provided, must belong to same operational_job/work_order
  IF NEW.qa_inspection_id IS NOT NULL THEN
    SELECT * INTO v_qi FROM public.qa_inspection WHERE id = NEW.qa_inspection_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'corrective_action: qa_inspection % not found', NEW.qa_inspection_id; END IF;
    IF v_qi.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'corrective_action: qa_inspection does not belong to declared operational_job';
    END IF;
    IF NEW.work_order_id IS NOT NULL AND v_qi.work_order_id IS NOT NULL
       AND v_qi.work_order_id <> NEW.work_order_id THEN
      RAISE EXCEPTION 'corrective_action: qa_inspection does not belong to declared work_order';
    END IF;
  END IF;

  -- assigned_worker_id, if provided, must belong to same organization/BU scope
  IF NEW.assigned_worker_id IS NOT NULL THEN
    SELECT * INTO v_aw FROM public.worker WHERE id = NEW.assigned_worker_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'corrective_action: assigned_worker % not found', NEW.assigned_worker_id; END IF;
    IF v_aw.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'corrective_action: assigned_worker does not belong to same organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- T15: operational_handoff — lineage / readiness / immutability
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wave3_validate_oh_lineage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj  public.operational_job%ROWTYPE;
  v_wo  public.work_order%ROWTYPE;
  v_blocking integer;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'operational_handoff: operational_job % not found', NEW.operational_job_id; END IF;

  -- Commercial lineage must match immutable operational_job lineage
  IF v_oj.pricing_snapshot_id <> NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION 'operational_handoff: pricing_snapshot_id must match operational_job';
  END IF;
  IF v_oj.quote_version_id <> NEW.quote_version_id THEN
    RAISE EXCEPTION 'operational_handoff: quote_version_id must match operational_job';
  END IF;
  IF v_oj.organization_id  <> NEW.organization_id  THEN RAISE EXCEPTION 'operational_handoff: organization_id mismatch'; END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN RAISE EXCEPTION 'operational_handoff: business_unit_id mismatch'; END IF;

  -- QA must be passed or explicitly waived
  IF v_oj.operational_status NOT IN ('qa_passed', 'closed') THEN
    RAISE EXCEPTION 'operational_handoff: operational_job must be qa_passed or closed (is: %)', v_oj.operational_status;
  END IF;

  -- Work order service execution must be complete
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'operational_handoff: work_order % not found', NEW.work_order_id; END IF;
  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'operational_handoff: work_order does not belong to operational_job';
  END IF;
  IF v_wo.work_order_status NOT IN ('service_complete', 'qa_complete', 'closed') THEN
    RAISE EXCEPTION 'operational_handoff: work_order service not complete (status: %)', v_wo.work_order_status;
  END IF;

  -- No blocking corrective actions
  SELECT COUNT(*) INTO v_blocking
  FROM   public.corrective_action
  WHERE  operational_job_id = NEW.operational_job_id
    AND  action_status NOT IN ('verified', 'cancelled');
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'operational_handoff: % unresolved corrective action(s) block handoff', v_blocking;
  END IF;

  -- qa_inspection_id, if provided, must belong to the same operational_job/work_order
  IF NEW.qa_inspection_id IS NOT NULL THEN
    PERFORM 1 FROM public.qa_inspection qi
    WHERE  qi.id = NEW.qa_inspection_id
      AND  qi.operational_job_id = NEW.operational_job_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operational_handoff: qa_inspection does not belong to declared operational_job';
    END IF;
    IF NEW.work_order_id IS NOT NULL THEN
      PERFORM 1 FROM public.qa_inspection qi
      WHERE  qi.id = NEW.qa_inspection_id
        AND  (qi.work_order_id IS NULL OR qi.work_order_id = NEW.work_order_id);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'operational_handoff: qa_inspection does not belong to declared work_order';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave3_guard_oh_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.operational_job_id    <> OLD.operational_job_id    THEN RAISE EXCEPTION 'operational_handoff: operational_job_id is immutable'; END IF;
  IF NEW.pricing_snapshot_id   <> OLD.pricing_snapshot_id   THEN RAISE EXCEPTION 'operational_handoff: pricing_snapshot_id is immutable'; END IF;
  IF NEW.quote_version_id      <> OLD.quote_version_id      THEN RAISE EXCEPTION 'operational_handoff: quote_version_id is immutable'; END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 4: BIND TRIGGERS TO TABLES
-- ---------------------------------------------------------------------------

-- operational_job
CREATE TRIGGER trg_oj_lineage_validate
  BEFORE INSERT ON public.operational_job
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_oj_lineage();

CREATE TRIGGER trg_oj_immutable
  BEFORE UPDATE ON public.operational_job
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_oj_immutable();

CREATE TRIGGER trg_oj_lifecycle
  BEFORE UPDATE OF operational_status ON public.operational_job
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_oj_lifecycle();

CREATE TRIGGER trg_oj_close_gate
  BEFORE UPDATE OF operational_status ON public.operational_job
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_oj_close_gate();

CREATE TRIGGER trg_oj_updated_at
  BEFORE UPDATE ON public.operational_job
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- schedule_window
CREATE TRIGGER trg_sw_scope_validate
  BEFORE INSERT OR UPDATE ON public.schedule_window
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_sw_scope();

CREATE TRIGGER trg_sw_updated_at
  BEFORE UPDATE ON public.schedule_window
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- worker_assignment
CREATE TRIGGER trg_wa_scope_validate
  BEFORE INSERT ON public.worker_assignment
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_wa_scope();
CREATE TRIGGER trg_wa_lifecycle_guard
  BEFORE UPDATE OF assignment_status ON public.worker_assignment
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_wa_lifecycle();
-- worker_has_active_assignment: true when the current authenticated user
-- has a non-terminal, active worker_assignment for the target job,
-- and the worker record is active.
CREATE OR REPLACE FUNCTION public.worker_has_active_assignment(target_job uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.worker_assignment wa
    JOIN   public.worker            w  ON w.id = wa.worker_id
    WHERE  wa.operational_job_id = target_job
      AND  w.app_user_id         = public.current_app_user_id()
      AND  w.status              = 'active'
      AND  wa.assignment_status NOT IN ('released', 'cancelled', 'declined', 'completed')
  );
$$;


CREATE TRIGGER trg_wa_immutable
  BEFORE UPDATE ON public.worker_assignment
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_wa_immutable();

CREATE TRIGGER trg_wa_updated_at
  BEFORE UPDATE ON public.worker_assignment
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- work_order
CREATE TRIGGER trg_wo_scope_validate
  BEFORE INSERT ON public.work_order
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_wo_scope();

CREATE TRIGGER trg_wo_lifecycle
  BEFORE UPDATE OF work_order_status ON public.work_order
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_wo_lifecycle();

CREATE TRIGGER trg_wo_snapshot_immutable
  BEFORE UPDATE ON public.work_order
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_wo_snapshot_immutable();

CREATE TRIGGER trg_wo_updated_at
  BEFORE UPDATE ON public.work_order
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- work_order_event (append-only + scope)
CREATE TRIGGER trg_woe_scope_validate
  BEFORE INSERT ON public.work_order_event
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_woe_scope();

CREATE TRIGGER trg_woe_deny_update
  BEFORE UPDATE ON public.work_order_event
  FOR EACH ROW EXECUTE FUNCTION public.wave3_deny_woe_mutation();

CREATE TRIGGER trg_woe_deny_delete
  BEFORE DELETE ON public.work_order_event
  FOR EACH ROW EXECUTE FUNCTION public.wave3_deny_woe_mutation();

-- completion_evidence (append-only + scope)
CREATE TRIGGER trg_ce_scope_validate
  BEFORE INSERT ON public.completion_evidence
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_ce_scope();

CREATE TRIGGER trg_ce_deny_update
  BEFORE UPDATE ON public.completion_evidence
  FOR EACH ROW EXECUTE FUNCTION public.wave3_deny_ce_mutation();

CREATE TRIGGER trg_ce_deny_delete
  BEFORE DELETE ON public.completion_evidence
  FOR EACH ROW EXECUTE FUNCTION public.wave3_deny_ce_mutation();

-- service_checklist_result
CREATE TRIGGER trg_scr_scope_validate
  BEFORE INSERT ON public.service_checklist_result
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_scr_scope();

CREATE TRIGGER trg_scr_final_immutable
  BEFORE UPDATE ON public.service_checklist_result
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_scr_final_immutable();

CREATE TRIGGER trg_scr_updated_at
  BEFORE UPDATE ON public.service_checklist_result
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- qa_inspection
CREATE TRIGGER trg_qi_scope_validate
  BEFORE INSERT ON public.qa_inspection
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_qi_scope();

CREATE TRIGGER trg_qi_final_immutable
  BEFORE UPDATE ON public.qa_inspection
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_qi_final_immutable();

CREATE TRIGGER trg_qi_updated_at
  BEFORE UPDATE ON public.qa_inspection
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- corrective_action
CREATE TRIGGER trg_ca_scope_validate
  BEFORE INSERT ON public.corrective_action
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_ca_scope();

CREATE TRIGGER trg_ca_updated_at
  BEFORE UPDATE ON public.corrective_action
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

-- operational_handoff
CREATE TRIGGER trg_oh_lineage_validate
  BEFORE INSERT ON public.operational_handoff
  FOR EACH ROW EXECUTE FUNCTION public.wave3_validate_oh_lineage();

CREATE TRIGGER trg_oh_immutable
  BEFORE UPDATE ON public.operational_handoff
  FOR EACH ROW EXECUTE FUNCTION public.wave3_guard_oh_immutable();

-- ---------------------------------------------------------------------------
-- SECTION 5: ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.operational_job         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_window         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_assignment       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_event        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_evidence     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_checklist_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inspection           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrective_action       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_handoff     ENABLE ROW LEVEL SECURITY;

-- Revoke all privileges from anon on Wave 3 tables
REVOKE ALL ON public.operational_job          FROM anon;
REVOKE ALL ON public.schedule_window          FROM anon;
REVOKE ALL ON public.worker_assignment        FROM anon;
REVOKE ALL ON public.work_order               FROM anon;
REVOKE ALL ON public.work_order_event         FROM anon;
REVOKE ALL ON public.completion_evidence      FROM anon;
REVOKE ALL ON public.service_checklist_result FROM anon;
REVOKE ALL ON public.qa_inspection            FROM anon;
REVOKE ALL ON public.corrective_action        FROM anon;
REVOKE ALL ON public.operational_handoff      FROM anon;

-- Grant only necessary DML to authenticated (policies below enforce the rest)
GRANT SELECT, INSERT, UPDATE ON public.operational_job          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.schedule_window          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.worker_assignment        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.work_order               TO authenticated;
GRANT SELECT, INSERT         ON public.work_order_event         TO authenticated;
GRANT SELECT, INSERT         ON public.completion_evidence      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_checklist_result TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.qa_inspection            TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.corrective_action        TO authenticated;
GRANT SELECT, INSERT         ON public.operational_handoff      TO authenticated;

-- ── operational_job policies ──────────────────────────────────────────────

CREATE POLICY pol_oj_owner_admin_all ON public.operational_job
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_oj_office_ops_rw ON public.operational_job
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_oj_sales_select ON public.operational_job
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['sales']));

CREATE POLICY pol_oj_finance_select ON public.operational_job
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['finance']));

CREATE POLICY pol_oj_qa_select ON public.operational_job
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_oj_worker_select ON public.operational_job
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(id));

-- ── schedule_window policies ──────────────────────────────────────────────

CREATE POLICY pol_sw_owner_admin_all ON public.schedule_window
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_sw_office_ops_rw ON public.schedule_window
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_sw_worker_select ON public.schedule_window
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.worker_assignment wa
      JOIN   public.worker w ON w.id = wa.worker_id
      WHERE  wa.schedule_window_id = schedule_window.id
        AND  w.app_user_id = public.current_app_user_id()
        AND  wa.assignment_status NOT IN ('declined', 'released', 'cancelled')
    )
  );

CREATE POLICY pol_sw_qa_select ON public.schedule_window
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

-- ── worker_assignment policies ────────────────────────────────────────────

CREATE POLICY pol_wa_owner_admin_all ON public.worker_assignment
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_wa_office_ops_rw ON public.worker_assignment
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_wa_worker_select ON public.worker_assignment
  FOR SELECT TO authenticated
  USING (
    worker_id = public.current_worker_id(organization_id)
  );

CREATE POLICY pol_wa_worker_update_own ON public.worker_assignment
  FOR UPDATE TO authenticated
  USING  (worker_id = public.current_worker_id(organization_id))
  WITH CHECK (worker_id = public.current_worker_id(organization_id));

-- ── work_order policies ───────────────────────────────────────────────────

CREATE POLICY pol_wo_owner_admin_all ON public.work_order
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_wo_office_ops_rw ON public.work_order
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_wo_finance_select ON public.work_order
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['finance']));

CREATE POLICY pol_wo_qa_select ON public.work_order
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_wo_worker_select ON public.work_order
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

-- ── work_order_event policies ─────────────────────────────────────────────

CREATE POLICY pol_woe_owner_admin_all ON public.work_order_event
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_woe_office_ops_select_insert ON public.work_order_event
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_woe_office_ops_select ON public.work_order_event
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_woe_worker_select ON public.work_order_event
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_woe_worker_insert ON public.work_order_event
  FOR INSERT TO authenticated
  WITH CHECK (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_woe_qa_select ON public.work_order_event
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

-- ── completion_evidence policies ──────────────────────────────────────────

CREATE POLICY pol_ce_owner_admin_all ON public.completion_evidence
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ce_office_ops_select ON public.completion_evidence
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_ce_worker_select ON public.completion_evidence
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_ce_worker_insert ON public.completion_evidence
  FOR INSERT TO authenticated
  WITH CHECK (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_ce_qa_select ON public.completion_evidence
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

-- ── service_checklist_result policies ────────────────────────────────────

CREATE POLICY pol_scr_owner_admin_all ON public.service_checklist_result
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_scr_office_ops_select ON public.service_checklist_result
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_scr_worker_select ON public.service_checklist_result
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_scr_worker_insert ON public.service_checklist_result
  FOR INSERT TO authenticated
  WITH CHECK (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_scr_worker_update ON public.service_checklist_result
  FOR UPDATE TO authenticated
  USING  (public.worker_has_active_assignment(operational_job_id))
  WITH CHECK (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_scr_qa_select ON public.service_checklist_result
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

-- ── qa_inspection policies ────────────────────────────────────────────────

CREATE POLICY pol_qi_owner_admin_all ON public.qa_inspection
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_qi_qa_all ON public.qa_inspection
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_qi_office_ops_select ON public.qa_inspection
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_qi_worker_select ON public.qa_inspection
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_qi_finance_select ON public.qa_inspection
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['finance']));

-- ── corrective_action policies ────────────────────────────────────────────

CREATE POLICY pol_ca_owner_admin_all ON public.corrective_action
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ca_qa_all ON public.corrective_action
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_ca_office_ops_select ON public.corrective_action
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ── operational_handoff policies ──────────────────────────────────────────

CREATE POLICY pol_oh_owner_admin_all ON public.operational_handoff
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_oh_office_ops_rw ON public.operational_handoff
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_oh_finance_select ON public.operational_handoff
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['finance']));

-- ---------------------------------------------------------------------------
-- SECTION 6: M007 SELF-VALIDATION
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_wave3_tables_found           integer;
  v_expected_tables              integer := 10;
  v_rls_enabled_count            integer;
  v_anon_priv_violations         integer;
  v_authenticated_table_count    integer;
  v_policy_count                 integer;
  v_missing_dep_count            integer;
  v_missing_fk_or_unique_count   integer;
  v_missing_guard_trigger_count  integer;
  v_legacy_huc_touch_count       integer;
  v_lifecycle_trigger_present    boolean;
  v_active_worker_helper_ok      boolean;

  v_expected_wave3_tables text[] := ARRAY[
    'operational_job', 'schedule_window', 'worker_assignment',
    'work_order', 'work_order_event', 'completion_evidence',
    'service_checklist_result', 'qa_inspection', 'corrective_action',
    'operational_handoff'
  ];

  -- The exact policy list created in this migration (count locked below)
  v_expected_policy_count integer := 47;
BEGIN

  -- 1. Wave 3 tables found
  SELECT COUNT(*) INTO v_wave3_tables_found
  FROM   information_schema.tables
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave3_tables);

  IF v_wave3_tables_found <> v_expected_tables THEN
    RAISE EXCEPTION 'M007 FAIL: expected % tables, found %', v_expected_tables, v_wave3_tables_found;
  END IF;

  -- 2. RLS enabled on all 10
  SELECT COUNT(*) INTO v_rls_enabled_count
  FROM   pg_class c
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relname  = ANY(v_expected_wave3_tables)
    AND  c.relrowsecurity = true;

  IF v_rls_enabled_count <> v_expected_tables THEN
    RAISE EXCEPTION 'M007 FAIL: RLS enabled count % (expected %)', v_rls_enabled_count, v_expected_tables;
  END IF;

  -- 3. Anon privilege violations (anon must have zero privileges on wave3 tables)
  SELECT COUNT(*) INTO v_anon_priv_violations
  FROM   information_schema.role_table_grants
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave3_tables)
    AND  grantee      = 'anon';

  IF v_anon_priv_violations <> 0 THEN
    RAISE EXCEPTION 'M007 FAIL: % anon privilege violation(s) found', v_anon_priv_violations;
  END IF;

  -- 4. Authenticated grants on all 10 tables
  SELECT COUNT(DISTINCT table_name) INTO v_authenticated_table_count
  FROM   information_schema.role_table_grants
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave3_tables)
    AND  grantee      = 'authenticated';

  IF v_authenticated_table_count <> v_expected_tables THEN
    RAISE EXCEPTION 'M007 FAIL: authenticated grants found on % tables (expected %)', v_authenticated_table_count, v_expected_tables;
  END IF;

  -- 5. Policy count
  SELECT COUNT(*) INTO v_policy_count
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  tablename  = ANY(v_expected_wave3_tables);

  IF v_policy_count <> v_expected_policy_count THEN
    RAISE EXCEPTION 'M007 FAIL: policy count % (expected %)', v_policy_count, v_expected_policy_count;
  END IF;

  -- 6. Missing required Wave 1/2 dependency tables
  SELECT COUNT(*) INTO v_missing_dep_count
  FROM (
    VALUES
      ('organization'),
      ('job_handoff'),
      ('conversion_record'),
      ('quote_version'),
      ('pricing_snapshot'),
      ('customer'),
      ('contact'),
      ('service_location'),
      ('worker')
  ) AS deps(tname)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public' AND table_name = deps.tname
  );

  IF v_missing_dep_count <> 0 THEN
    RAISE EXCEPTION 'M007 FAIL: % required dependency table(s) missing', v_missing_dep_count;
  END IF;

  -- 7. Missing FK or UNIQUE constraints on Wave 3 tables
  -- Check that each wave3 table has at least one FK constraint
  SELECT COUNT(*) INTO v_missing_fk_or_unique_count
  FROM (
    SELECT unnest(v_expected_wave3_tables) AS tname
  ) AS tbls
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    WHERE  tc.table_schema   = 'public'
      AND  tc.table_name     = tbls.tname
      AND  tc.constraint_type IN ('FOREIGN KEY', 'UNIQUE')
  );

  IF v_missing_fk_or_unique_count <> 0 THEN
    RAISE EXCEPTION 'M007 FAIL: % wave3 tables missing FK or UNIQUE constraints', v_missing_fk_or_unique_count;
  END IF;

  -- 8. Missing guard triggers on Wave 3 tables
  -- Each Wave 3 table must have at least one trigger
  SELECT COUNT(*) INTO v_missing_guard_trigger_count
  FROM (
    SELECT unnest(v_expected_wave3_tables) AS tname
  ) AS tbls
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.triggers t
    WHERE  t.event_object_schema = 'public'
      AND  t.event_object_table  = tbls.tname
  );

  IF v_missing_guard_trigger_count <> 0 THEN
    RAISE EXCEPTION 'M007 FAIL: % wave3 tables missing guard triggers', v_missing_guard_trigger_count;
  END IF;

  -- 9. Legacy huc_* touch count (must be zero)
  -- Count triggers on huc_* tables that reference any wave3 trigger function.
  -- If this migration accidentally added triggers to huc_* tables, this will be non-zero.
  SELECT COUNT(*) INTO v_legacy_huc_touch_count
  FROM   pg_trigger    tr
  JOIN   pg_class      c  ON c.oid = tr.tgrelid
  JOIN   pg_namespace  n  ON n.oid = c.relnamespace
  JOIN   pg_proc       p  ON p.oid = tr.tgfoid
  WHERE  n.nspname = 'public'
    AND  c.relname LIKE 'huc_%'
    AND  p.proname LIKE 'wave3_%';

  IF v_legacy_huc_touch_count <> 0 THEN
    RAISE EXCEPTION 'M007 FAIL: % wave3 trigger(s) found on huc_* tables', v_legacy_huc_touch_count;
  END IF;

  -- 10. Worker assignment lifecycle trigger present
  SELECT EXISTS(
    SELECT 1 FROM information_schema.triggers
    WHERE  trigger_schema     = 'public'
      AND  event_object_table = 'worker_assignment'
      AND  trigger_name       = 'trg_wa_lifecycle_guard'
  ) INTO v_lifecycle_trigger_present;

  IF NOT v_lifecycle_trigger_present THEN
    RAISE EXCEPTION 'M007 FAIL: worker_assignment lifecycle guard trigger (trg_wa_lifecycle_guard) missing';
  END IF;

  -- 11. Active-worker helper includes status='active' filter
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname   = 'public'
      AND  p.proname   = 'current_worker_id'
      AND  pg_get_functiondef(p.oid) LIKE '%status%active%'
  ) INTO v_active_worker_helper_ok;

  IF NOT v_active_worker_helper_ok THEN
    RAISE EXCEPTION 'M007 FAIL: current_worker_id helper does not enforce status=''active''';
  END IF;

  -- ALL GATES PASSED
  RAISE NOTICE 'M007_PASS | wave3_tables_found=% | expected_tables=% | rls_enabled_count=% | anon_privilege_violation_count=% | authenticated_table_count=% | policy_count=% | missing_required_dependency_count=% | missing_fk_or_unique_count=% | missing_guard_trigger_count=% | legacy_huc_touch_count=% | lifecycle_trigger_present=% | active_worker_helper_ok=%',
    v_wave3_tables_found,
    v_expected_tables,
    v_rls_enabled_count,
    v_anon_priv_violations,
    v_authenticated_table_count,
    v_policy_count,
    v_missing_dep_count,
    v_missing_fk_or_unique_count,
    v_missing_guard_trigger_count,
    v_legacy_huc_touch_count,
    v_lifecycle_trigger_present,
    v_active_worker_helper_ok;

END;
$$;

COMMIT;
