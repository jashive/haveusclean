-- =============================================================================
-- MIGRATION 009 — WAVE 4: NARROWED DELIVERY QUALITY DATA CONTRACT
-- =============================================================================
-- Additive only. No huc_* table is altered, dropped, or granted.
-- DATABASE EXECUTION NOT YET AUTHORIZED.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 1: TABLE DEFINITIONS
-- ---------------------------------------------------------------------------

-- ============================================================
-- 1. required_evidence_policy
-- Versioned authority rows linked to configuration_version.
-- ============================================================
CREATE TABLE public.required_evidence_policy (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,
  jurisdiction_id             uuid        NOT NULL,
  configuration_version_id    uuid        NOT NULL,

  service_family              text        NOT NULL,
  service_task_key            text        NULL,
  service_module_key          text        NULL,
  requirement_key             text        NOT NULL,
  evidence_type               text        NOT NULL,
  required_count              integer     NOT NULL DEFAULT 1,
  is_mandatory                boolean     NOT NULL DEFAULT true,

  storage_rule_payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id      uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_rep_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_rep_configuration_version
    FOREIGN KEY (configuration_version_id)
    REFERENCES public.configuration_version(id),

  CONSTRAINT uq_rep_configuration_requirement
    UNIQUE (configuration_version_id, requirement_key),

  CONSTRAINT ck_rep_service_family_nonempty CHECK (service_family <> ''),
  CONSTRAINT ck_rep_requirement_key_nonempty CHECK (requirement_key <> ''),
  CONSTRAINT ck_rep_required_count_positive CHECK (required_count > 0),
  CONSTRAINT ck_rep_evidence_type CHECK (
    evidence_type IN (
      'photo_before', 'photo_after', 'photo_detail',
      'note', 'signature', 'timestamp', 'other'
    )
  )
);

-- ============================================================
-- 2. work_order_governance_link
-- Frozen execution-governance linkage for exact historical replay.
-- ============================================================
CREATE TABLE public.work_order_governance_link (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,
  jurisdiction_id             uuid        NOT NULL,

  operational_job_id          uuid        NOT NULL UNIQUE,
  work_order_id               uuid        NOT NULL UNIQUE,
  configuration_version_id    uuid        NOT NULL,

  checklist_version_reference text        NULL,
  task_definition_reference   text        NULL,
  sop_reference_snapshot      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  governance_snapshot         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id      uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_wogl_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_wogl_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_wogl_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_wogl_configuration_version
    FOREIGN KEY (configuration_version_id)
    REFERENCES public.configuration_version(id)
);

-- ============================================================
-- 3. work_order_evidence_requirement
-- Frozen per-work-order evidence rules used for closure decisions.
-- ============================================================
CREATE TABLE public.work_order_evidence_requirement (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id                 uuid        NOT NULL,
  business_unit_id                uuid        NOT NULL,

  operational_job_id              uuid        NOT NULL,
  work_order_id                   uuid        NOT NULL,
  work_order_governance_link_id   uuid        NOT NULL,

  required_evidence_policy_id     uuid        NULL,
  source_configuration_version_id uuid        NOT NULL,

  service_task_key                text        NULL,
  service_module_key              text        NULL,
  requirement_key                 text        NOT NULL,
  evidence_type                   text        NOT NULL,
  required_count                  integer     NOT NULL DEFAULT 1,
  is_mandatory                    boolean     NOT NULL DEFAULT true,

  storage_rule_payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  quality_signal_payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id          uuid        NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_woer_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_woer_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_woer_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_woer_governance_link
    FOREIGN KEY (work_order_governance_link_id)
    REFERENCES public.work_order_governance_link(id),

  CONSTRAINT fk_woer_policy
    FOREIGN KEY (required_evidence_policy_id)
    REFERENCES public.required_evidence_policy(id),

  CONSTRAINT fk_woer_configuration_version
    FOREIGN KEY (source_configuration_version_id)
    REFERENCES public.configuration_version(id),

  CONSTRAINT uq_woer_requirement_per_work_order
    UNIQUE (work_order_id, requirement_key),

  CONSTRAINT ck_woer_requirement_key_nonempty CHECK (requirement_key <> ''),
  CONSTRAINT ck_woer_required_count_positive CHECK (required_count > 0),
  CONSTRAINT ck_woer_evidence_type CHECK (
    evidence_type IN (
      'photo_before', 'photo_after', 'photo_detail',
      'note', 'signature', 'timestamp', 'other'
    )
  )
);

-- ============================================================
-- 4. service_exception
-- Canonical exception / nonconformance contract.
-- ============================================================
CREATE TABLE public.service_exception (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,

  operational_job_id          uuid        NOT NULL,
  work_order_id               uuid        NOT NULL,
  qa_inspection_id            uuid        NULL,
  corrective_action_id        uuid        NULL,

  source_type                 text        NOT NULL DEFAULT 'other',
  actor_worker_id             uuid        NULL,
  actor_app_user_id           uuid        NULL,

  exception_category          text        NOT NULL,
  severity                    text        NOT NULL,
  description                 text        NOT NULL,
  findings                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  triage_status               text        NOT NULL DEFAULT 'reported',
  corrective_action_required  boolean     NOT NULL DEFAULT false,

  reported_at                 timestamptz NOT NULL DEFAULT now(),
  triaged_at                  timestamptz NULL,
  resolution_payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolved_at                 timestamptz NULL,
  closed_at                   timestamptz NULL,

  quality_signal_payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id      uuid        NULL,
  updated_by_app_user_id      uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_se_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_se_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_se_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_se_qa_inspection
    FOREIGN KEY (qa_inspection_id)
    REFERENCES public.qa_inspection(id),

  CONSTRAINT fk_se_corrective_action
    FOREIGN KEY (corrective_action_id)
    REFERENCES public.corrective_action(id),

  CONSTRAINT ck_se_source_type CHECK (
    source_type IN ('worker', 'qa', 'office_ops', 'system', 'customer', 'other')
  ),
  CONSTRAINT ck_se_category CHECK (
    exception_category IN (
      'service_quality', 'safety', 'access',
      'equipment', 'documentation', 'customer_issue', 'other'
    )
  ),
  CONSTRAINT ck_se_severity CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT ck_se_triage_status CHECK (
    triage_status IN (
      'reported', 'triaged', 'corrective_action_required',
      'ready_for_reinspection', 'resolved', 'closed', 'cancelled'
    )
  ),
  CONSTRAINT ck_se_description_nonempty CHECK (description <> '')
);

-- ============================================================
-- 5. customer_outcome
-- Canonical customer outcome / service issue contract.
-- ============================================================
CREATE TABLE public.customer_outcome (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id             uuid        NOT NULL,
  business_unit_id            uuid        NOT NULL,

  operational_job_id          uuid        NOT NULL,
  work_order_id               uuid        NULL,
  customer_id                 uuid        NOT NULL,
  contact_id                  uuid        NULL,
  service_location_id         uuid        NULL,

  outcome_type                text        NOT NULL,
  outcome_status              text        NOT NULL DEFAULT 'reported',
  outcome_source              text        NOT NULL DEFAULT 'customer',
  source_channel              text        NULL,

  reported_at                 timestamptz NOT NULL DEFAULT now(),
  recorded_at                 timestamptz NOT NULL DEFAULT now(),
  description                 text        NOT NULL,
  details                     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolution_payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolved_at                 timestamptz NULL,
  closed_at                   timestamptz NULL,

  quality_signal_payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_app_user_id      uuid        NULL,
  updated_by_app_user_id      uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_co_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organization(id),

  CONSTRAINT fk_co_operational_job
    FOREIGN KEY (operational_job_id)
    REFERENCES public.operational_job(id),

  CONSTRAINT fk_co_work_order
    FOREIGN KEY (work_order_id)
    REFERENCES public.work_order(id),

  CONSTRAINT fk_co_customer
    FOREIGN KEY (customer_id)
    REFERENCES public.customer(id),

  CONSTRAINT fk_co_contact
    FOREIGN KEY (contact_id)
    REFERENCES public.contact(id),

  CONSTRAINT fk_co_service_location
    FOREIGN KEY (service_location_id)
    REFERENCES public.service_location(id),

  CONSTRAINT ck_co_type CHECK (
    outcome_type IN (
      'praise', 'complaint', 'service_issue',
      'reclean_request', 'damage_concern', 'resolution', 'other'
    )
  ),
  CONSTRAINT ck_co_status CHECK (
    outcome_status IN (
      'reported', 'acknowledged', 'investigating',
      'resolved', 'closed', 'dismissed'
    )
  ),
  CONSTRAINT ck_co_source CHECK (
    outcome_source IN ('customer', 'office_ops', 'qa', 'worker', 'system', 'other')
  ),
  CONSTRAINT ck_co_description_nonempty CHECK (description <> '')
);

-- ---------------------------------------------------------------------------
-- SECTION 2: INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_rep_scope            ON public.required_evidence_policy (organization_id, business_unit_id, configuration_version_id);
CREATE INDEX idx_rep_service_family   ON public.required_evidence_policy (service_family, evidence_type);

CREATE INDEX idx_wogl_work_order      ON public.work_order_governance_link (work_order_id);
CREATE INDEX idx_wogl_configuration   ON public.work_order_governance_link (configuration_version_id);

CREATE INDEX idx_woer_work_order      ON public.work_order_evidence_requirement (work_order_id);
CREATE INDEX idx_woer_job             ON public.work_order_evidence_requirement (operational_job_id);

CREATE INDEX idx_se_job               ON public.service_exception (operational_job_id);
CREATE INDEX idx_se_work_order        ON public.service_exception (work_order_id);
CREATE INDEX idx_se_status            ON public.service_exception (triage_status);

CREATE INDEX idx_co_job               ON public.customer_outcome (operational_job_id);
CREATE INDEX idx_co_customer          ON public.customer_outcome (customer_id);
CREATE INDEX idx_co_status            ON public.customer_outcome (outcome_status);

-- ---------------------------------------------------------------------------
-- SECTION 3: TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wave4_validate_required_evidence_policy_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_cfg public.configuration_version%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.configuration_version WHERE id = NEW.configuration_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'required_evidence_policy: configuration_version % not found', NEW.configuration_version_id;
  END IF;
  IF v_cfg.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'required_evidence_policy: organization_id mismatch with configuration_version';
  END IF;
  IF v_cfg.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'required_evidence_policy: business_unit_id mismatch with configuration_version';
  END IF;
  IF v_cfg.jurisdiction_id <> NEW.jurisdiction_id THEN
    RAISE EXCEPTION 'required_evidence_policy: jurisdiction_id mismatch with configuration_version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_required_evidence_policy_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id          <> OLD.organization_id          THEN RAISE EXCEPTION 'required_evidence_policy: organization_id is immutable'; END IF;
  IF NEW.business_unit_id         <> OLD.business_unit_id         THEN RAISE EXCEPTION 'required_evidence_policy: business_unit_id is immutable'; END IF;
  IF NEW.jurisdiction_id          <> OLD.jurisdiction_id          THEN RAISE EXCEPTION 'required_evidence_policy: jurisdiction_id is immutable'; END IF;
  IF NEW.configuration_version_id <> OLD.configuration_version_id THEN RAISE EXCEPTION 'required_evidence_policy: configuration_version_id is immutable'; END IF;
  IF NEW.service_family           <> OLD.service_family           THEN RAISE EXCEPTION 'required_evidence_policy: service_family is immutable'; END IF;
  IF NEW.service_task_key IS DISTINCT FROM OLD.service_task_key   THEN RAISE EXCEPTION 'required_evidence_policy: service_task_key is immutable'; END IF;
  IF NEW.service_module_key IS DISTINCT FROM OLD.service_module_key THEN RAISE EXCEPTION 'required_evidence_policy: service_module_key is immutable'; END IF;
  IF NEW.requirement_key          <> OLD.requirement_key          THEN RAISE EXCEPTION 'required_evidence_policy: requirement_key is immutable'; END IF;
  IF NEW.evidence_type            <> OLD.evidence_type            THEN RAISE EXCEPTION 'required_evidence_policy: evidence_type is immutable'; END IF;
  IF NEW.required_count           <> OLD.required_count           THEN RAISE EXCEPTION 'required_evidence_policy: required_count is immutable'; END IF;
  IF NEW.is_mandatory             <> OLD.is_mandatory             THEN RAISE EXCEPTION 'required_evidence_policy: is_mandatory is immutable'; END IF;
  IF NEW.storage_rule_payload     <> OLD.storage_rule_payload     THEN RAISE EXCEPTION 'required_evidence_policy: storage_rule_payload is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_validate_work_order_governance_link_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj  public.operational_job%ROWTYPE;
  v_wo  public.work_order%ROWTYPE;
  v_cfg public.configuration_version%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_governance_link: operational_job % not found', NEW.operational_job_id; END IF;
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_governance_link: work_order % not found', NEW.work_order_id; END IF;
  SELECT * INTO v_cfg FROM public.configuration_version WHERE id = NEW.configuration_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_governance_link: configuration_version % not found', NEW.configuration_version_id; END IF;

  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'work_order_governance_link: work_order does not belong to declared operational_job';
  END IF;
  IF v_oj.organization_id <> NEW.organization_id OR v_wo.organization_id <> NEW.organization_id OR v_cfg.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'work_order_governance_link: organization_id mismatch';
  END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id OR v_wo.business_unit_id <> NEW.business_unit_id OR v_cfg.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'work_order_governance_link: business_unit_id mismatch';
  END IF;
  IF v_oj.jurisdiction_id <> NEW.jurisdiction_id OR v_wo.jurisdiction_id <> NEW.jurisdiction_id OR v_cfg.jurisdiction_id <> NEW.jurisdiction_id THEN
    RAISE EXCEPTION 'work_order_governance_link: jurisdiction_id mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_work_order_governance_link_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id              <> OLD.organization_id              THEN RAISE EXCEPTION 'work_order_governance_link: organization_id is immutable'; END IF;
  IF NEW.business_unit_id             <> OLD.business_unit_id             THEN RAISE EXCEPTION 'work_order_governance_link: business_unit_id is immutable'; END IF;
  IF NEW.jurisdiction_id              <> OLD.jurisdiction_id              THEN RAISE EXCEPTION 'work_order_governance_link: jurisdiction_id is immutable'; END IF;
  IF NEW.operational_job_id           <> OLD.operational_job_id           THEN RAISE EXCEPTION 'work_order_governance_link: operational_job_id is immutable'; END IF;
  IF NEW.work_order_id                <> OLD.work_order_id                THEN RAISE EXCEPTION 'work_order_governance_link: work_order_id is immutable'; END IF;
  IF NEW.configuration_version_id     <> OLD.configuration_version_id     THEN RAISE EXCEPTION 'work_order_governance_link: configuration_version_id is immutable'; END IF;
  IF NEW.checklist_version_reference IS DISTINCT FROM OLD.checklist_version_reference THEN RAISE EXCEPTION 'work_order_governance_link: checklist_version_reference is immutable'; END IF;
  IF NEW.task_definition_reference  IS DISTINCT FROM OLD.task_definition_reference THEN RAISE EXCEPTION 'work_order_governance_link: task_definition_reference is immutable'; END IF;
  IF NEW.sop_reference_snapshot       <> OLD.sop_reference_snapshot       THEN RAISE EXCEPTION 'work_order_governance_link: sop_reference_snapshot is immutable'; END IF;
  IF NEW.governance_snapshot          <> OLD.governance_snapshot          THEN RAISE EXCEPTION 'work_order_governance_link: governance_snapshot is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_validate_work_order_evidence_requirement_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_wo   public.work_order%ROWTYPE;
  v_wogl public.work_order_governance_link%ROWTYPE;
  v_rep  public.required_evidence_policy%ROWTYPE;
  v_cfg  public.configuration_version%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_evidence_requirement: work_order % not found', NEW.work_order_id; END IF;
  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'work_order_evidence_requirement: work_order does not belong to declared operational_job';
  END IF;

  SELECT * INTO v_wogl FROM public.work_order_governance_link WHERE id = NEW.work_order_governance_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_evidence_requirement: governance link % not found', NEW.work_order_governance_link_id; END IF;
  IF v_wogl.operational_job_id <> NEW.operational_job_id OR v_wogl.work_order_id <> NEW.work_order_id THEN
    RAISE EXCEPTION 'work_order_evidence_requirement: governance link does not belong to declared operational chain';
  END IF;

  SELECT * INTO v_cfg FROM public.configuration_version WHERE id = NEW.source_configuration_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_order_evidence_requirement: source configuration_version % not found', NEW.source_configuration_version_id; END IF;
  IF v_cfg.organization_id <> NEW.organization_id OR v_cfg.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'work_order_evidence_requirement: configuration_version scope mismatch';
  END IF;

  IF NEW.required_evidence_policy_id IS NOT NULL THEN
    SELECT * INTO v_rep FROM public.required_evidence_policy WHERE id = NEW.required_evidence_policy_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'work_order_evidence_requirement: required_evidence_policy % not found', NEW.required_evidence_policy_id; END IF;
    IF v_rep.configuration_version_id <> NEW.source_configuration_version_id THEN
      RAISE EXCEPTION 'work_order_evidence_requirement: policy configuration_version_id mismatch';
    END IF;
    IF v_rep.requirement_key <> NEW.requirement_key THEN
      RAISE EXCEPTION 'work_order_evidence_requirement: policy requirement_key mismatch';
    END IF;
    IF v_rep.evidence_type <> NEW.evidence_type THEN
      RAISE EXCEPTION 'work_order_evidence_requirement: policy evidence_type mismatch';
    END IF;
  END IF;

  IF v_wo.organization_id <> NEW.organization_id OR v_wo.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'work_order_evidence_requirement: work_order scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_work_order_evidence_requirement_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id                 <> OLD.organization_id                 THEN RAISE EXCEPTION 'work_order_evidence_requirement: organization_id is immutable'; END IF;
  IF NEW.business_unit_id                <> OLD.business_unit_id                THEN RAISE EXCEPTION 'work_order_evidence_requirement: business_unit_id is immutable'; END IF;
  IF NEW.operational_job_id              <> OLD.operational_job_id              THEN RAISE EXCEPTION 'work_order_evidence_requirement: operational_job_id is immutable'; END IF;
  IF NEW.work_order_id                   <> OLD.work_order_id                   THEN RAISE EXCEPTION 'work_order_evidence_requirement: work_order_id is immutable'; END IF;
  IF NEW.work_order_governance_link_id   <> OLD.work_order_governance_link_id   THEN RAISE EXCEPTION 'work_order_evidence_requirement: work_order_governance_link_id is immutable'; END IF;
  IF NEW.required_evidence_policy_id   IS DISTINCT FROM OLD.required_evidence_policy_id THEN RAISE EXCEPTION 'work_order_evidence_requirement: required_evidence_policy_id is immutable'; END IF;
  IF NEW.source_configuration_version_id <> OLD.source_configuration_version_id THEN RAISE EXCEPTION 'work_order_evidence_requirement: source_configuration_version_id is immutable'; END IF;
  IF NEW.service_task_key IS DISTINCT FROM OLD.service_task_key                 THEN RAISE EXCEPTION 'work_order_evidence_requirement: service_task_key is immutable'; END IF;
  IF NEW.service_module_key IS DISTINCT FROM OLD.service_module_key             THEN RAISE EXCEPTION 'work_order_evidence_requirement: service_module_key is immutable'; END IF;
  IF NEW.requirement_key                 <> OLD.requirement_key                 THEN RAISE EXCEPTION 'work_order_evidence_requirement: requirement_key is immutable'; END IF;
  IF NEW.evidence_type                   <> OLD.evidence_type                   THEN RAISE EXCEPTION 'work_order_evidence_requirement: evidence_type is immutable'; END IF;
  IF NEW.required_count                  <> OLD.required_count                  THEN RAISE EXCEPTION 'work_order_evidence_requirement: required_count is immutable'; END IF;
  IF NEW.is_mandatory                    <> OLD.is_mandatory                    THEN RAISE EXCEPTION 'work_order_evidence_requirement: is_mandatory is immutable'; END IF;
  IF NEW.storage_rule_payload            <> OLD.storage_rule_payload            THEN RAISE EXCEPTION 'work_order_evidence_requirement: storage_rule_payload is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_validate_service_exception_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
  v_wo public.work_order%ROWTYPE;
  v_qi public.qa_inspection%ROWTYPE;
  v_ca public.corrective_action%ROWTYPE;
  v_aw public.worker%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_exception: operational_job % not found', NEW.operational_job_id; END IF;
  SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_exception: work_order % not found', NEW.work_order_id; END IF;

  IF v_wo.operational_job_id <> NEW.operational_job_id THEN
    RAISE EXCEPTION 'service_exception: work_order does not belong to declared operational_job';
  END IF;
  IF v_oj.organization_id <> NEW.organization_id OR v_wo.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'service_exception: organization_id mismatch';
  END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id OR v_wo.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'service_exception: business_unit_id mismatch';
  END IF;

  IF NEW.qa_inspection_id IS NOT NULL THEN
    SELECT * INTO v_qi FROM public.qa_inspection WHERE id = NEW.qa_inspection_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'service_exception: qa_inspection % not found', NEW.qa_inspection_id; END IF;
    IF v_qi.operational_job_id <> NEW.operational_job_id OR v_qi.work_order_id <> NEW.work_order_id THEN
      RAISE EXCEPTION 'service_exception: qa_inspection does not belong to declared operational chain';
    END IF;
  END IF;

  IF NEW.corrective_action_id IS NOT NULL THEN
    SELECT * INTO v_ca FROM public.corrective_action WHERE id = NEW.corrective_action_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'service_exception: corrective_action % not found', NEW.corrective_action_id; END IF;
    IF v_ca.operational_job_id <> NEW.operational_job_id OR v_ca.work_order_id <> NEW.work_order_id THEN
      RAISE EXCEPTION 'service_exception: corrective_action does not belong to declared operational chain';
    END IF;
  END IF;

  IF NEW.actor_worker_id IS NOT NULL THEN
    SELECT * INTO v_aw FROM public.worker WHERE id = NEW.actor_worker_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'service_exception: actor_worker % not found', NEW.actor_worker_id; END IF;
    IF v_aw.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'service_exception: actor_worker does not belong to same organization';
    END IF;
  END IF;

  IF NEW.corrective_action_required = true AND NEW.triage_status = 'ready_for_reinspection' AND NEW.corrective_action_id IS NULL THEN
    RAISE EXCEPTION 'service_exception: corrective_action_id required before ready_for_reinspection';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_service_exception_lifecycle()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.triage_status = NEW.triage_status THEN RETURN NEW; END IF;
  IF OLD.triage_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'service_exception: cannot transition from terminal status %', OLD.triage_status;
  END IF;

  CASE OLD.triage_status
    WHEN 'reported' THEN
      IF NEW.triage_status NOT IN ('triaged', 'cancelled') THEN
        RAISE EXCEPTION 'service_exception: invalid transition % -> %', OLD.triage_status, NEW.triage_status;
      END IF;
    WHEN 'triaged' THEN
      IF NEW.triage_status NOT IN ('corrective_action_required', 'resolved', 'cancelled') THEN
        RAISE EXCEPTION 'service_exception: invalid transition % -> %', OLD.triage_status, NEW.triage_status;
      END IF;
    WHEN 'corrective_action_required' THEN
      IF NEW.triage_status NOT IN ('ready_for_reinspection', 'cancelled') THEN
        RAISE EXCEPTION 'service_exception: invalid transition % -> %', OLD.triage_status, NEW.triage_status;
      END IF;
    WHEN 'ready_for_reinspection' THEN
      IF NEW.triage_status NOT IN ('resolved', 'cancelled') THEN
        RAISE EXCEPTION 'service_exception: invalid transition % -> %', OLD.triage_status, NEW.triage_status;
      END IF;
    WHEN 'resolved' THEN
      IF NEW.triage_status <> 'closed' THEN
        RAISE EXCEPTION 'service_exception: invalid transition % -> %', OLD.triage_status, NEW.triage_status;
      END IF;
    ELSE
      RAISE EXCEPTION 'service_exception: unrecognised source status %', OLD.triage_status;
  END CASE;

  IF NEW.triage_status IN ('corrective_action_required', 'ready_for_reinspection') AND NEW.corrective_action_required = false THEN
    RAISE EXCEPTION 'service_exception: corrective_action_required must be true for status %', NEW.triage_status;
  END IF;

  IF NEW.triage_status = 'ready_for_reinspection' AND NEW.corrective_action_id IS NULL THEN
    RAISE EXCEPTION 'service_exception: corrective_action_id required for ready_for_reinspection';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_service_exception_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id        <> OLD.organization_id        THEN RAISE EXCEPTION 'service_exception: organization_id is immutable'; END IF;
  IF NEW.business_unit_id       <> OLD.business_unit_id       THEN RAISE EXCEPTION 'service_exception: business_unit_id is immutable'; END IF;
  IF NEW.operational_job_id     <> OLD.operational_job_id     THEN RAISE EXCEPTION 'service_exception: operational_job_id is immutable'; END IF;
  IF NEW.work_order_id          <> OLD.work_order_id          THEN RAISE EXCEPTION 'service_exception: work_order_id is immutable'; END IF;
  IF NEW.source_type            <> OLD.source_type            THEN RAISE EXCEPTION 'service_exception: source_type is immutable'; END IF;
  IF NEW.actor_worker_id      IS DISTINCT FROM OLD.actor_worker_id THEN RAISE EXCEPTION 'service_exception: actor_worker_id is immutable'; END IF;
  IF NEW.actor_app_user_id    IS DISTINCT FROM OLD.actor_app_user_id THEN RAISE EXCEPTION 'service_exception: actor_app_user_id is immutable'; END IF;
  IF NEW.exception_category     <> OLD.exception_category     THEN RAISE EXCEPTION 'service_exception: exception_category is immutable'; END IF;
  IF NEW.severity               <> OLD.severity               THEN RAISE EXCEPTION 'service_exception: severity is immutable'; END IF;
  IF NEW.description            <> OLD.description            THEN RAISE EXCEPTION 'service_exception: description is immutable'; END IF;
  IF NEW.reported_at            <> OLD.reported_at            THEN RAISE EXCEPTION 'service_exception: reported_at is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_validate_customer_outcome_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_oj public.operational_job%ROWTYPE;
  v_wo public.work_order%ROWTYPE;
BEGIN
  SELECT * INTO v_oj FROM public.operational_job WHERE id = NEW.operational_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_outcome: operational_job % not found', NEW.operational_job_id; END IF;

  IF NEW.work_order_id IS NOT NULL THEN
    SELECT * INTO v_wo FROM public.work_order WHERE id = NEW.work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer_outcome: work_order % not found', NEW.work_order_id; END IF;
    IF v_wo.operational_job_id <> NEW.operational_job_id THEN
      RAISE EXCEPTION 'customer_outcome: work_order does not belong to declared operational_job';
    END IF;
  END IF;

  IF v_oj.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'customer_outcome: organization_id mismatch';
  END IF;
  IF v_oj.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'customer_outcome: business_unit_id mismatch';
  END IF;
  IF v_oj.customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'customer_outcome: customer_id must match operational_job lineage';
  END IF;
  IF NEW.contact_id IS NOT NULL AND v_oj.contact_id <> NEW.contact_id THEN
    RAISE EXCEPTION 'customer_outcome: contact_id must match operational_job lineage';
  END IF;
  IF NEW.service_location_id IS NOT NULL AND v_oj.service_location_id <> NEW.service_location_id THEN
    RAISE EXCEPTION 'customer_outcome: service_location_id must match operational_job lineage';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_customer_outcome_lifecycle()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF OLD.outcome_status = NEW.outcome_status THEN RETURN NEW; END IF;
  IF OLD.outcome_status IN ('closed', 'dismissed') THEN
    RAISE EXCEPTION 'customer_outcome: cannot transition from terminal status %', OLD.outcome_status;
  END IF;

  CASE OLD.outcome_status
    WHEN 'reported' THEN
      IF NEW.outcome_status NOT IN ('acknowledged', 'dismissed') THEN
        RAISE EXCEPTION 'customer_outcome: invalid transition % -> %', OLD.outcome_status, NEW.outcome_status;
      END IF;
    WHEN 'acknowledged' THEN
      IF NEW.outcome_status NOT IN ('investigating', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'customer_outcome: invalid transition % -> %', OLD.outcome_status, NEW.outcome_status;
      END IF;
    WHEN 'investigating' THEN
      IF NEW.outcome_status NOT IN ('resolved', 'dismissed') THEN
        RAISE EXCEPTION 'customer_outcome: invalid transition % -> %', OLD.outcome_status, NEW.outcome_status;
      END IF;
    WHEN 'resolved' THEN
      IF NEW.outcome_status <> 'closed' THEN
        RAISE EXCEPTION 'customer_outcome: invalid transition % -> %', OLD.outcome_status, NEW.outcome_status;
      END IF;
    ELSE
      RAISE EXCEPTION 'customer_outcome: unrecognised source status %', OLD.outcome_status;
  END CASE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_customer_outcome_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id      <> OLD.organization_id      THEN RAISE EXCEPTION 'customer_outcome: organization_id is immutable'; END IF;
  IF NEW.business_unit_id     <> OLD.business_unit_id     THEN RAISE EXCEPTION 'customer_outcome: business_unit_id is immutable'; END IF;
  IF NEW.operational_job_id   <> OLD.operational_job_id   THEN RAISE EXCEPTION 'customer_outcome: operational_job_id is immutable'; END IF;
  IF NEW.work_order_id      IS DISTINCT FROM OLD.work_order_id THEN RAISE EXCEPTION 'customer_outcome: work_order_id is immutable'; END IF;
  IF NEW.customer_id          <> OLD.customer_id          THEN RAISE EXCEPTION 'customer_outcome: customer_id is immutable'; END IF;
  IF NEW.contact_id         IS DISTINCT FROM OLD.contact_id THEN RAISE EXCEPTION 'customer_outcome: contact_id is immutable'; END IF;
  IF NEW.service_location_id IS DISTINCT FROM OLD.service_location_id THEN RAISE EXCEPTION 'customer_outcome: service_location_id is immutable'; END IF;
  IF NEW.outcome_type         <> OLD.outcome_type         THEN RAISE EXCEPTION 'customer_outcome: outcome_type is immutable'; END IF;
  IF NEW.outcome_source       <> OLD.outcome_source       THEN RAISE EXCEPTION 'customer_outcome: outcome_source is immutable'; END IF;
  IF NEW.reported_at          <> OLD.reported_at          THEN RAISE EXCEPTION 'customer_outcome: reported_at is immutable'; END IF;
  IF NEW.recorded_at          <> OLD.recorded_at          THEN RAISE EXCEPTION 'customer_outcome: recorded_at is immutable'; END IF;
  IF NEW.description          <> OLD.description          THEN RAISE EXCEPTION 'customer_outcome: description is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave4_guard_wo_closure_requirements()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_has_wave4_contract     boolean;
  v_missing_requirements   integer;
  v_passing_qa             integer;
  v_blocking_correctives   integer;
BEGIN
  IF OLD.work_order_status = NEW.work_order_status THEN
    RETURN NEW;
  END IF;

  IF NEW.work_order_status <> 'closed' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
           SELECT 1
           FROM public.work_order_governance_link wogl
           WHERE wogl.work_order_id = NEW.id
             AND wogl.operational_job_id = NEW.operational_job_id
         )
         OR EXISTS (
           SELECT 1
           FROM public.work_order_evidence_requirement woer
           WHERE woer.work_order_id = NEW.id
             AND woer.operational_job_id = NEW.operational_job_id
         )
  INTO v_has_wave4_contract;

  IF NOT v_has_wave4_contract THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.work_order_governance_link wogl
    WHERE wogl.work_order_id = NEW.id
      AND wogl.operational_job_id = NEW.operational_job_id
  ) THEN
    RAISE EXCEPTION 'work_order: frozen governance linkage is required before close';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.work_order_evidence_requirement woer
    WHERE woer.work_order_id = NEW.id
      AND woer.operational_job_id = NEW.operational_job_id
  ) THEN
    RAISE EXCEPTION 'work_order: frozen evidence requirements are required before close';
  END IF;

  SELECT COUNT(*) INTO v_missing_requirements
  FROM public.work_order_evidence_requirement req
  WHERE req.work_order_id = NEW.id
    AND req.operational_job_id = NEW.operational_job_id
    AND req.is_mandatory = true
    AND (
      SELECT COUNT(*)
      FROM public.completion_evidence ce
      WHERE ce.work_order_id = NEW.id
        AND ce.operational_job_id = NEW.operational_job_id
        AND ce.evidence_type = req.evidence_type
        AND ce.evidence_payload ->> 'requirement_key' = req.requirement_key
    ) < req.required_count;

  IF v_missing_requirements > 0 THEN
    RAISE EXCEPTION 'work_order: % mandatory evidence requirement(s) unsatisfied; close blocked', v_missing_requirements;
  END IF;

  SELECT COUNT(*) INTO v_passing_qa
  FROM public.qa_inspection qi
  WHERE qi.operational_job_id = NEW.operational_job_id
    AND qi.work_order_id = NEW.id
    AND qi.inspection_status IN ('passed', 'waived');

  IF v_passing_qa = 0 THEN
    RAISE EXCEPTION 'work_order: QA pass/waiver required before close';
  END IF;

  SELECT COUNT(*) INTO v_blocking_correctives
  FROM public.corrective_action ca
  WHERE ca.operational_job_id = NEW.operational_job_id
    AND ca.work_order_id = NEW.id
    AND ca.action_status NOT IN ('verified', 'cancelled');

  IF v_blocking_correctives > 0 THEN
    RAISE EXCEPTION 'work_order: % unresolved corrective action(s) block close', v_blocking_correctives;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 4: TRIGGERS
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_rep_scope_validate
  BEFORE INSERT OR UPDATE ON public.required_evidence_policy
  FOR EACH ROW EXECUTE FUNCTION public.wave4_validate_required_evidence_policy_scope();

CREATE TRIGGER trg_rep_immutable
  BEFORE UPDATE ON public.required_evidence_policy
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_required_evidence_policy_immutable();

CREATE TRIGGER trg_wogl_scope_validate
  BEFORE INSERT OR UPDATE ON public.work_order_governance_link
  FOR EACH ROW EXECUTE FUNCTION public.wave4_validate_work_order_governance_link_scope();

CREATE TRIGGER trg_wogl_immutable
  BEFORE UPDATE ON public.work_order_governance_link
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_work_order_governance_link_immutable();

CREATE TRIGGER trg_woer_scope_validate
  BEFORE INSERT OR UPDATE ON public.work_order_evidence_requirement
  FOR EACH ROW EXECUTE FUNCTION public.wave4_validate_work_order_evidence_requirement_scope();

CREATE TRIGGER trg_woer_immutable
  BEFORE UPDATE ON public.work_order_evidence_requirement
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_work_order_evidence_requirement_immutable();

CREATE TRIGGER trg_se_scope_validate
  BEFORE INSERT OR UPDATE ON public.service_exception
  FOR EACH ROW EXECUTE FUNCTION public.wave4_validate_service_exception_scope();

CREATE TRIGGER trg_se_lifecycle_guard
  BEFORE UPDATE ON public.service_exception
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_service_exception_lifecycle();

CREATE TRIGGER trg_se_immutable
  BEFORE UPDATE ON public.service_exception
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_service_exception_immutable();

CREATE TRIGGER trg_se_updated_at
  BEFORE UPDATE ON public.service_exception
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

CREATE TRIGGER trg_co_scope_validate
  BEFORE INSERT OR UPDATE ON public.customer_outcome
  FOR EACH ROW EXECUTE FUNCTION public.wave4_validate_customer_outcome_scope();

CREATE TRIGGER trg_co_lifecycle_guard
  BEFORE UPDATE ON public.customer_outcome
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_customer_outcome_lifecycle();

CREATE TRIGGER trg_co_immutable
  BEFORE UPDATE ON public.customer_outcome
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_customer_outcome_immutable();

CREATE TRIGGER trg_co_updated_at
  BEFORE UPDATE ON public.customer_outcome
  FOR EACH ROW EXECUTE FUNCTION public.wave3_set_updated_at();

CREATE TRIGGER trg_wo_wave4_close_gate
  BEFORE UPDATE ON public.work_order
  FOR EACH ROW EXECUTE FUNCTION public.wave4_guard_wo_closure_requirements();

-- ---------------------------------------------------------------------------
-- SECTION 5: ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.required_evidence_policy      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_governance_link    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_evidence_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_exception             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_outcome              ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.required_evidence_policy       FROM anon;
REVOKE ALL ON public.work_order_governance_link     FROM anon;
REVOKE ALL ON public.work_order_evidence_requirement FROM anon;
REVOKE ALL ON public.service_exception              FROM anon;
REVOKE ALL ON public.customer_outcome               FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.required_evidence_policy        TO authenticated;
GRANT SELECT, INSERT         ON public.work_order_governance_link      TO authenticated;
GRANT SELECT, INSERT         ON public.work_order_evidence_requirement TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_exception               TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_outcome                TO authenticated;

CREATE POLICY pol_rep_owner_admin_all ON public.required_evidence_policy
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_rep_office_ops_select ON public.required_evidence_policy
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_rep_qa_select ON public.required_evidence_policy
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_wogl_owner_admin_all ON public.work_order_governance_link
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_wogl_office_ops_select ON public.work_order_governance_link
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_wogl_qa_select ON public.work_order_governance_link
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_wogl_worker_select ON public.work_order_governance_link
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_woer_owner_admin_all ON public.work_order_evidence_requirement
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_woer_office_ops_select ON public.work_order_evidence_requirement
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_woer_qa_select ON public.work_order_evidence_requirement
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_woer_worker_select ON public.work_order_evidence_requirement
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_se_owner_admin_all ON public.service_exception
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_se_qa_all ON public.service_exception
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_se_office_ops_select ON public.service_exception
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_se_worker_select ON public.service_exception
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_se_worker_insert ON public.service_exception
  FOR INSERT TO authenticated
  WITH CHECK (public.worker_has_active_assignment(operational_job_id));

CREATE POLICY pol_co_owner_admin_all ON public.customer_outcome
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_co_office_ops_all ON public.customer_outcome
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_co_qa_select ON public.customer_outcome
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['qa']));

CREATE POLICY pol_co_worker_select ON public.customer_outcome
  FOR SELECT TO authenticated
  USING (public.worker_has_active_assignment(operational_job_id));

-- ---------------------------------------------------------------------------
-- SECTION 6: M009 SELF-VALIDATION
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_wave4_tables_found          integer;
  v_expected_tables             integer := 5;
  v_rls_enabled_count           integer;
  v_anon_priv_violations        integer;
  v_authenticated_table_count   integer;
  v_policy_count                integer;
  v_missing_dep_count           integer;
  v_missing_guard_trigger_count integer;
  v_legacy_huc_touch_count      integer;
  v_append_only_guards_present  boolean;
  v_work_order_close_gate_ok    boolean;

  v_expected_wave4_tables text[] := ARRAY[
    'required_evidence_policy',
    'work_order_governance_link',
    'work_order_evidence_requirement',
    'service_exception',
    'customer_outcome'
  ];

  v_expected_policy_count integer := 20;
BEGIN
  SELECT COUNT(*) INTO v_wave4_tables_found
  FROM   information_schema.tables
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave4_tables);

  IF v_wave4_tables_found <> v_expected_tables THEN
    RAISE EXCEPTION 'M009 FAIL: expected % tables, found %', v_expected_tables, v_wave4_tables_found;
  END IF;

  SELECT COUNT(*) INTO v_rls_enabled_count
  FROM   pg_class c
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relname  = ANY(v_expected_wave4_tables)
    AND  c.relrowsecurity = true;

  IF v_rls_enabled_count <> v_expected_tables THEN
    RAISE EXCEPTION 'M009 FAIL: RLS enabled count % (expected %)', v_rls_enabled_count, v_expected_tables;
  END IF;

  SELECT COUNT(*) INTO v_anon_priv_violations
  FROM   information_schema.role_table_grants
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave4_tables)
    AND  grantee      = 'anon';

  IF v_anon_priv_violations <> 0 THEN
    RAISE EXCEPTION 'M009 FAIL: % anon privilege violation(s) found', v_anon_priv_violations;
  END IF;

  SELECT COUNT(DISTINCT table_name) INTO v_authenticated_table_count
  FROM   information_schema.role_table_grants
  WHERE  table_schema = 'public'
    AND  table_name   = ANY(v_expected_wave4_tables)
    AND  grantee      = 'authenticated';

  IF v_authenticated_table_count <> v_expected_tables THEN
    RAISE EXCEPTION 'M009 FAIL: authenticated grants found on % tables (expected %)', v_authenticated_table_count, v_expected_tables;
  END IF;

  SELECT COUNT(*) INTO v_policy_count
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  tablename  = ANY(v_expected_wave4_tables);

  IF v_policy_count <> v_expected_policy_count THEN
    RAISE EXCEPTION 'M009 FAIL: policy count % (expected %)', v_policy_count, v_expected_policy_count;
  END IF;

  SELECT COUNT(*) INTO v_missing_dep_count
  FROM (
    VALUES
      ('organization'),
      ('configuration_version'),
      ('operational_job'),
      ('work_order'),
      ('completion_evidence'),
      ('qa_inspection'),
      ('corrective_action'),
      ('customer'),
      ('contact'),
      ('service_location')
  ) AS deps(tname)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = deps.tname
  );

  IF v_missing_dep_count <> 0 THEN
    RAISE EXCEPTION 'M009 FAIL: % required dependency table(s) missing', v_missing_dep_count;
  END IF;

  SELECT COUNT(*) INTO v_missing_guard_trigger_count
  FROM (
    VALUES
      ('required_evidence_policy', 'trg_rep_scope_validate'),
      ('required_evidence_policy', 'trg_rep_immutable'),
      ('work_order_governance_link', 'trg_wogl_scope_validate'),
      ('work_order_governance_link', 'trg_wogl_immutable'),
      ('work_order_evidence_requirement', 'trg_woer_scope_validate'),
      ('work_order_evidence_requirement', 'trg_woer_immutable'),
      ('service_exception', 'trg_se_scope_validate'),
      ('service_exception', 'trg_se_lifecycle_guard'),
      ('service_exception', 'trg_se_immutable'),
      ('customer_outcome', 'trg_co_scope_validate'),
      ('customer_outcome', 'trg_co_lifecycle_guard'),
      ('customer_outcome', 'trg_co_immutable'),
      ('work_order', 'trg_wo_wave4_close_gate')
  ) AS expected(table_name, trigger_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers t
    WHERE t.event_object_schema = 'public'
      AND t.event_object_table  = expected.table_name
      AND t.trigger_name        = expected.trigger_name
  );

  IF v_missing_guard_trigger_count <> 0 THEN
    RAISE EXCEPTION 'M009 FAIL: % required wave4 trigger(s) missing', v_missing_guard_trigger_count;
  END IF;

  SELECT COUNT(*) INTO v_legacy_huc_touch_count
  FROM   pg_trigger tr
  JOIN   pg_class c ON c.oid = tr.tgrelid
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  JOIN   pg_proc p ON p.oid = tr.tgfoid
  WHERE  n.nspname = 'public'
    AND  c.relname LIKE 'huc_%'
    AND  p.proname LIKE 'wave4_%';

  IF v_legacy_huc_touch_count <> 0 THEN
    RAISE EXCEPTION 'M009 FAIL: % wave4 trigger(s) found on huc_* tables', v_legacy_huc_touch_count;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'work_order_event'
      AND trigger_name = 'trg_woe_deny_update'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'work_order_event'
      AND trigger_name = 'trg_woe_deny_delete'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'completion_evidence'
      AND trigger_name = 'trg_ce_deny_update'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'completion_evidence'
      AND trigger_name = 'trg_ce_deny_delete'
  ) INTO v_append_only_guards_present;

  IF NOT v_append_only_guards_present THEN
    RAISE EXCEPTION 'M009 FAIL: existing append-only guard triggers are missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'work_order'
      AND trigger_name = 'trg_wo_wave4_close_gate'
  ) INTO v_work_order_close_gate_ok;

  IF NOT v_work_order_close_gate_ok THEN
    RAISE EXCEPTION 'M009 FAIL: work_order close gate trigger missing';
  END IF;

  RAISE NOTICE 'M009_PASS | wave4_tables_found=% | expected_tables=% | rls_enabled_count=% | anon_privilege_violation_count=% | authenticated_table_count=% | policy_count=% | missing_required_dependency_count=% | missing_guard_trigger_count=% | legacy_huc_touch_count=% | append_only_guards_present=% | work_order_close_gate_present=%',
    v_wave4_tables_found,
    v_expected_tables,
    v_rls_enabled_count,
    v_anon_priv_violations,
    v_authenticated_table_count,
    v_policy_count,
    v_missing_dep_count,
    v_missing_guard_trigger_count,
    v_legacy_huc_touch_count,
    v_append_only_guards_present,
    v_work_order_close_gate_ok;
END;
$$;

COMMIT;
