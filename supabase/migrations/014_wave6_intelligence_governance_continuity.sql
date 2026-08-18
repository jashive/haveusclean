-- =============================================================================
-- MIGRATION 014 — WAVE 6: INTELLIGENCE / GOVERNANCE / CONTINUITY
-- =============================================================================
-- DATABASE EXECUTION NOT YET AUTHORIZED.
-- SOURCE ONLY — this file has NOT been executed against any Supabase project.
--
-- Additive only. No huc_* table is altered, dropped, renamed, or granted.
-- No Wave 1–5 table structure, RLS policy, or retained row is modified.
-- Wave 5 is CLOSED: this migration only hardens redundant privilege bits
-- (TRUNCATE / REFERENCES / TRIGGER) that were never required by the app.
--
-- Tables created (9):
--   kpi_definition
--   kpi_snapshot
--   management_review
--   change_control_record
--   dependency_edge
--   continuity_session
--   continuity_transaction
--   service_module_profile
--   release_gate
--
-- View created (1):
--   wave6_canonical_event  (security_invoker)
--
-- Trigger functions created (18):
--   trg_wave6_mr_governance             — management_review BEFORE UPDATE
--     (combined authoritative stamp + FSM; deterministic single-trigger design)
--   trg_enforce_ccr_fsm                 — change_control_record BEFORE UPDATE
--   trg_enforce_continuity_fsm          — continuity_session BEFORE UPDATE
--   trg_enforce_release_gate_sequence   — release_gate BEFORE UPDATE
--   trg_set_continuity_payload_hash     — continuity_transaction BEFORE INSERT
--   trg_immute_continuity_transaction_fields — continuity_transaction BEFORE UPDATE
--   trg_wave6_stamp_kpi_snapshot_insert — kpi_snapshot BEFORE INSERT
--
-- Triggers created (18):
--   trig_wave6_mr_governance
--   trig_ccr_fsm
--   trig_ccr_dependency_impact_validate
--   trig_continuity_fsm
--   trig_release_gate_sequence
--   trig_continuity_payload_hash
--   trig_immute_continuity_transaction_fields
--   trig_wave6_mr_insert_guard
--   trig_wave6_ccr_insert_guard
--   trig_wave6_ccr_update_stamp
--   trig_wave6_cs_insert_guard
--   trig_wave6_cs_update_stamp
--   trig_wave6_ct_insert_guard
--   trig_wave6_ct_reconciliation_fsm
--   trig_wave6_kpi_snapshot_scope
--   trig_wave6_kpi_snapshot_stamp
--   trig_wave6_management_review_manifest
--   trig_wave6_ccr_manifest
--
-- Terminal marker on success: M014_WAVE6_INTELLIGENCE_PASS
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 1: TABLE DEFINITIONS
-- ---------------------------------------------------------------------------

-- ============================================================
-- 1. kpi_definition
--    Versioned, governed KPI definitions.
--    organization_id NULL => global (platform-governed) definition.
-- ============================================================
CREATE TABLE public.kpi_definition (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  code                      text        NOT NULL,
  name                      text        NOT NULL,
  domain                    text        NOT NULL,
  description               text        NULL,
  unit                      text        NULL,

  aggregation_type          text        NOT NULL,
  period_support            text[]      NOT NULL,

  source_lineage            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  formula_code              text        NULL,

  definition_version        text        NOT NULL DEFAULT '1',
  active                    boolean     NOT NULL DEFAULT true,

  effective_from            timestamptz NULL,
  effective_to              timestamptz NULL,

  organization_id           uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id    uuid        NULL,

  -- Uniqueness is (code, definition_version): a governed KPI code may be
  -- re-issued under a new definition_version, and older versions stay readable
  -- as evidence. A bare UNIQUE (code) would make versioning impossible.
  CONSTRAINT uq_kd_code_version UNIQUE (code, definition_version),
  CONSTRAINT uq_kd_id_code_version UNIQUE (id, code, definition_version),

  CONSTRAINT ck_kd_aggregation CHECK (
    aggregation_type IN ('sum', 'count', 'rate', 'average', 'weighted_average')
  ),
  CONSTRAINT ck_kd_domain CHECK (
    domain IN ('sales', 'operations', 'quality', 'finance')
  ),
  CONSTRAINT ck_kd_code_nonempty CHECK (code <> ''),
  CONSTRAINT ck_kd_period_support_nonempty CHECK (
    array_length(period_support, 1) IS NOT NULL
  ),
  CONSTRAINT ck_kd_effective_window CHECK (
    effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from
  )
);

COMMENT ON TABLE public.kpi_definition IS
  'Wave 6: Versioned governed KPI definitions. organization_id NULL = global definition. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 2. kpi_snapshot
--    Append-only KPI evidence. One row per governed
--    (kpi, version, scope, period, timezone) tuple.
-- ============================================================
CREATE TABLE public.kpi_snapshot (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  kpi_definition_id         uuid        NOT NULL,
  kpi_code                  text        NOT NULL,
  definition_version        text        NOT NULL DEFAULT '1',

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NULL,
  jurisdiction_id           uuid        NULL,

  period_type               text        NOT NULL,
  period_start              timestamptz NOT NULL,
  period_end                timestamptz NOT NULL,
  timezone                  text        NOT NULL,

  numeric_value             numeric     NULL,
  numerator                 numeric     NULL,
  denominator               numeric     NULL,

  source_lineage            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_freshness_at       timestamptz NULL,

  captured_at               timestamptz NOT NULL DEFAULT now(),
  captured_by_app_user_id   uuid        NULL,

  CONSTRAINT fk_ks_definition
    FOREIGN KEY (kpi_definition_id) REFERENCES public.kpi_definition(id),
  CONSTRAINT fk_ks_definition_triplet
    FOREIGN KEY (kpi_definition_id, kpi_code, definition_version)
    REFERENCES public.kpi_definition(id, code, definition_version),

  CONSTRAINT ck_ks_period_type CHECK (
    period_type IN ('DAILY', 'MONTHLY', 'QUARTERLY', 'YEARLY')
  ),
  CONSTRAINT ck_ks_period_order CHECK (period_end > period_start),
  CONSTRAINT ck_ks_timezone_nonempty CHECK (timezone <> ''),
  CONSTRAINT ck_ks_kpi_code_nonempty CHECK (kpi_code <> ''),
  -- Rates must never fabricate a value from a zero denominator.
  CONSTRAINT ck_ks_zero_denominator_guard CHECK (
    denominator IS NULL OR denominator <> 0 OR numeric_value IS NULL
  ),
  CONSTRAINT ck_ks_numeric_lineage_nonempty CHECK (
    numeric_value IS NULL OR source_lineage <> '{}'::jsonb
  )
);

COMMENT ON TABLE public.kpi_snapshot IS
  'Wave 6: Append-only KPI evidence. UPDATE/DELETE are not granted to authenticated. '
  'Duplicate captures are prevented by uq_ks_period_scope. '
  'SOURCE ONLY — not executed.';

-- Duplicate-capture prevention.
--
-- PostgreSQL treats NULLs as distinct inside a UNIQUE constraint, so a plain
-- table-level UNIQUE over (…, business_unit_id, jurisdiction_id, …) would NOT
-- stop two identical org-wide captures (both with NULL scope columns) from
-- being inserted. Dropping the nullable scope columns instead is also wrong —
-- it would block two different business units from capturing the same KPI for
-- the same period.
--
-- The COALESCE sentinel expression below is therefore used: it is NULL-safe,
-- keeps the business-unit / jurisdiction scope in the key, and requires an
-- expression index rather than a table constraint. Behaviour is equivalent to
-- UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+) while remaining portable.
CREATE UNIQUE INDEX uq_ks_period_scope
  ON public.kpi_snapshot (
    kpi_code,
    definition_version,
    organization_id,
    COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(jurisdiction_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    period_type,
    period_start,
    period_end,
    timezone
  );

-- ============================================================
-- 3. management_review
--    Governed management review record per period.
-- ============================================================
CREATE TABLE public.management_review (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NULL,

  period_type               text        NOT NULL,
  period_start              timestamptz NOT NULL,
  period_end                timestamptz NOT NULL,
  timezone                  text        NOT NULL,

  review_status             text        NOT NULL DEFAULT 'draft',

  summary                   text        NULL,
  exceptions                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  decisions                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  actions                   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  kpi_snapshot_manifest     jsonb       NOT NULL DEFAULT '[]'::jsonb,

  owner_app_user_id         uuid        NULL,
  review_version            integer     NOT NULL DEFAULT 1,

  opened_at                 timestamptz NULL,
  closed_at                 timestamptz NULL,
  waiver_recorded           boolean     NOT NULL DEFAULT false,
  waiver_reason             text        NULL,
  waiver_actor_app_user_id  uuid        NULL,
  waiver_recorded_at        timestamptz NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id    uuid        NULL,

  CONSTRAINT ck_mr_status CHECK (
    review_status IN ('draft', 'in_review', 'actions_open', 'closed')
  ),
  CONSTRAINT ck_mr_period_type CHECK (
    period_type IN ('DAILY', 'MONTHLY', 'QUARTERLY', 'YEARLY')
  ),
  CONSTRAINT ck_mr_period_order CHECK (period_end > period_start),
  CONSTRAINT ck_mr_timezone_nonempty CHECK (timezone <> ''),
  CONSTRAINT ck_mr_version_positive CHECK (review_version >= 1),
  CONSTRAINT ck_mr_closed_requires_timestamp CHECK (
    review_status <> 'closed' OR closed_at IS NOT NULL
  ),
  CONSTRAINT ck_mr_waiver_evidence CHECK (
    waiver_recorded = false OR (
      waiver_reason IS NOT NULL
      AND waiver_actor_app_user_id IS NOT NULL
      AND waiver_recorded_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.management_review IS
  'Wave 6: Governed management review per period. Closure with unresolved actions '
  'requires waiver evidence and is enforced by database trigger functions. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 4. change_control_record
--    HEMS change control finite state machine.
-- ============================================================
CREATE TABLE public.change_control_record (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  change_code               text        NOT NULL,
  change_type               text        NOT NULL,
  title                     text        NOT NULL,
  reason                    text        NULL,

  source_kpi_codes          text[]      NOT NULL DEFAULT '{}',
  source_kpi_snapshot_manifest jsonb    NOT NULL DEFAULT '[]'::jsonb,
  impact_assessment         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  affected_dependencies     text[]      NOT NULL DEFAULT '{}',

  change_status             text        NOT NULL DEFAULT 'measure',
  material_change           boolean     NOT NULL DEFAULT false,

  approval_actor_id         uuid        NULL,
  approval_at               timestamptz NULL,

  implementation_plan       text        NULL,
  training_required         boolean     NOT NULL DEFAULT false,
  training_status           text        NULL,

  validation_result         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  hems_decision_reference   text        NULL,
  release_reference         text        NULL,

  organization_id           uuid        NOT NULL,
  business_unit_id          uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id    uuid        NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_ccr_change_type CHECK (
    change_type IN ('process', 'pricing', 'sop', 'training', 'system', 'hems_model')
  ),
  CONSTRAINT ck_ccr_status CHECK (
    change_status IN (
      'measure', 'analyze', 'improve', 'approve',
      'update', 'retrain', 'validate', 'closed'
    )
  ),
  CONSTRAINT ck_ccr_training_status CHECK (
    training_status IS NULL
    OR training_status IN ('pending', 'in_progress', 'completed')
  ),
  CONSTRAINT ck_ccr_title_nonempty CHECK (title <> ''),
  CONSTRAINT ck_ccr_change_code_nonempty CHECK (change_code <> ''),

  -- Material changes cannot close without a real impact assessment AND a
  -- validation result that explicitly passed.
  CONSTRAINT ck_ccr_material_close_evidence CHECK (
    change_status <> 'closed'
    OR (
      validation_result <> '{}'::jsonb
      AND (
        material_change = false OR (
      impact_assessment <> '{}'::jsonb
      AND (validation_result ->> 'passed') = 'true'
        )
      )
    )
  ),
  CONSTRAINT ck_ccr_approval_pair CHECK (
    (approval_actor_id IS NULL) = (approval_at IS NULL)
  )
);

COMMENT ON TABLE public.change_control_record IS
  'Wave 6: HEMS change control FSM (measure→analyze→improve→approve→update→retrain→validate→closed). '
  'Material changes require impact_assessment and validation_result.passed=true before closure. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 5. dependency_edge
--    HEMS knowledge-graph edges (KG-001 .. KG-007).
-- ============================================================
CREATE TABLE public.dependency_edge (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  kg_id                     text        NOT NULL,
  from_node                 text        NOT NULL,
  to_node                   text        NOT NULL,
  edge_type                 text        NOT NULL DEFAULT 'depends_on',
  control_rule              text        NULL,

  organization_id           uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_de_edge UNIQUE (kg_id, from_node, to_node),
  CONSTRAINT ck_de_nodes_nonempty CHECK (from_node <> '' AND to_node <> ''),
  CONSTRAINT ck_de_no_self_loop CHECK (from_node <> to_node)
);

COMMENT ON TABLE public.dependency_edge IS
  'Wave 6: HEMS dependency knowledge graph edges. SOURCE ONLY — not executed.';

-- ============================================================
-- 6. continuity_session
--    Fallback / disaster-recovery session.
-- ============================================================
CREATE TABLE public.continuity_session (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  session_code                  text        NOT NULL,

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NULL,

  fallback_type                 text        NOT NULL,
  session_status                text        NOT NULL DEFAULT 'declared',

  master_sheet_version          text        NULL,

  declared_at                   timestamptz NOT NULL DEFAULT now(),
  declared_by_app_user_id       uuid        NULL,

  service_restored_at           timestamptz NULL,
  reconciliation_started_at     timestamptz NULL,
  reconciliation_completed_at   timestamptz NULL,

  closed_at                     timestamptz NULL,
  closed_by_app_user_id         uuid        NULL,

  waiver_recorded               boolean     NOT NULL DEFAULT false,
  waiver_reason                 text        NULL,
  waiver_actor_app_user_id      uuid        NULL,
  waiver_recorded_at            timestamptz NULL,
  notes                         text        NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_cs_fallback_type CHECK (
    fallback_type IN ('serviceos_outage', 'partial_degradation', 'planned_maintenance')
  ),
  CONSTRAINT ck_cs_status CHECK (
    session_status IN (
      'declared', 'fallback_active', 'service_restored',
      'reconciling', 'reconciled', 'closed'
    )
  ),
  CONSTRAINT ck_cs_session_code_nonempty CHECK (session_code <> ''),
  CONSTRAINT ck_cs_close_requires_reconciliation CHECK (
    session_status <> 'closed'
    OR reconciliation_completed_at IS NOT NULL
    OR waiver_recorded
  ),
  CONSTRAINT ck_cs_closed_requires_timestamp CHECK (
    session_status <> 'closed' OR closed_at IS NOT NULL
  ),
  CONSTRAINT ck_cs_waiver_evidence CHECK (
    waiver_recorded = false OR (
      waiver_reason IS NOT NULL
      AND waiver_actor_app_user_id IS NOT NULL
      AND waiver_recorded_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.continuity_session IS
  'Wave 6: Continuity / DR fallback session. A session cannot be closed without a '
  'completed reconciliation unless waiver_recorded is true. SOURCE ONLY — not executed.';

-- ============================================================
-- 7. continuity_transaction
--    Work captured offline during a fallback session.
-- ============================================================
CREATE TABLE public.continuity_transaction (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  continuity_session_id         uuid        NOT NULL,
  offline_correlation_id        text        NOT NULL,

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NULL,

  transaction_type              text        NOT NULL,
  transaction_data              jsonb       NOT NULL DEFAULT '{}'::jsonb,

  serviceos_entity_type         text        NULL,
  serviceos_entity_id           uuid        NULL,

  reconciliation_status         text        NOT NULL DEFAULT 'pending',
  discrepancy_notes             text        NULL,
  waiver_evidence               text        NULL,

  reconciled_at                 timestamptz NULL,
  reconciled_by_app_user_id     uuid        NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),

  -- Payload integrity: SHA-256 of the canonical transaction_data JSONB snapshot.
  -- Set by trigger on INSERT; immutable (INSERT-only trigger, never overwritten).
  -- Computed via extensions.digest() (pgcrypto installed in schema extensions
  -- on the Have Us Clean Supabase project). NOT NULL: if extensions.digest is
  -- unavailable the INSERT trigger raises an exception — fail closed, never NULL.
  payload_hash                  text        NOT NULL,

  CONSTRAINT fk_ct_session
    FOREIGN KEY (continuity_session_id) REFERENCES public.continuity_session(id),

  -- No silent overwrite of an offline record: one row per correlation id per session.
  CONSTRAINT uq_ct_session_correlation
    UNIQUE (continuity_session_id, offline_correlation_id),

  CONSTRAINT ck_ct_reconciliation_status CHECK (
    reconciliation_status IN ('pending', 'matched', 'discrepancy', 'waived')
  ),
  CONSTRAINT ck_ct_correlation_nonempty CHECK (offline_correlation_id <> ''),
  CONSTRAINT ck_ct_transaction_type_nonempty CHECK (transaction_type <> ''),
  CONSTRAINT ck_ct_discrepancy_requires_notes CHECK (
    reconciliation_status <> 'discrepancy' OR NULLIF(btrim(discrepancy_notes), '') IS NOT NULL
  ),
  CONSTRAINT ck_ct_waived_requires_evidence CHECK (
    reconciliation_status <> 'waived' OR NULLIF(btrim(waiver_evidence), '') IS NOT NULL
  ),
  CONSTRAINT ck_ct_reconciled_requires_timestamp CHECK (
    reconciliation_status = 'pending' OR reconciled_at IS NOT NULL
  ),
  CONSTRAINT ck_ct_transaction_data_nonempty CHECK (
    jsonb_typeof(transaction_data) = 'object' AND transaction_data <> '{}'::jsonb
  ),
  -- Payload hash is a 64-character lowercase hex string (SHA-256). NOT NULL.
  CONSTRAINT ck_ct_payload_hash_format CHECK (
    payload_hash ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE public.continuity_transaction IS
  'Wave 6: Offline transaction captured during a continuity fallback session. '
  'Idempotent by (continuity_session_id, offline_correlation_id). '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 8. service_module_profile
--    Service module configuration (jurisdiction / currency / timezone).
-- ============================================================
CREATE TABLE public.service_module_profile (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  profile_code              text        NOT NULL,
  profile_name              text        NOT NULL,
  jurisdiction              text        NOT NULL,
  currency                  text        NOT NULL,
  timezone                  text        NOT NULL,

  configuration             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  active                    boolean     NOT NULL DEFAULT true,
  profile_version           integer     NOT NULL DEFAULT 1,

  organization_id           uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_smp_profile_code UNIQUE (profile_code),

  CONSTRAINT ck_smp_profile_code CHECK (
    profile_code IN ('RESIDENTIAL_ON', 'COMMERCIAL_ON', 'VACATION_RENTAL_AZ')
  ),
  CONSTRAINT ck_smp_currency CHECK (currency IN ('CAD', 'USD')),
  CONSTRAINT ck_smp_timezone_nonempty CHECK (timezone <> ''),
  CONSTRAINT ck_smp_version_positive CHECK (profile_version >= 1)
);

COMMENT ON TABLE public.service_module_profile IS
  'Wave 6: Service module profile configuration. SOURCE ONLY — not executed.';

-- ============================================================
-- 9. release_gate
--    Release sequencing gates.
-- ============================================================
CREATE TABLE public.release_gate (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  gate_code                 text        NOT NULL,
  gate_name                 text        NOT NULL,
  gate_status               text        NOT NULL DEFAULT 'pending',
  sequence_order            integer     NOT NULL,

  evidence_manifest         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  release_sha               text        NULL,
  deployment_identity       text        NULL,

  passed_at                 timestamptz NULL,
  passed_by_app_user_id     uuid        NULL,

  organization_id           uuid        NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_rg_gate_code UNIQUE (gate_code),

  CONSTRAINT ck_rg_gate_code CHECK (
    gate_code IN ('PILOT', 'ACCEPTANCE', 'CUTOVER', 'LEGACY_RETIREMENT', 'SCALE')
  ),
  CONSTRAINT ck_rg_status CHECK (
    gate_status IN ('pending', 'ready', 'passed', 'blocked')
  ),
  CONSTRAINT ck_rg_sequence_positive CHECK (sequence_order >= 1),
  CONSTRAINT ck_rg_passed_requires_timestamp CHECK (
    gate_status <> 'passed' OR passed_at IS NOT NULL
  ),
  CONSTRAINT ck_rg_passed_requires_release_identity CHECK (
    gate_status <> 'passed' OR release_sha IS NOT NULL
  )
);

COMMENT ON TABLE public.release_gate IS
  'Wave 6: Release sequencing gate. Cross-gate prerequisites are enforced by '
  'database trigger function trg_enforce_release_gate_sequence. SOURCE ONLY — not executed.';

-- ---------------------------------------------------------------------------
-- SECTION 2: INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_kd_domain            ON public.kpi_definition (domain);
CREATE INDEX idx_kd_active            ON public.kpi_definition (active);

CREATE INDEX idx_ks_scope_period      ON public.kpi_snapshot (organization_id, business_unit_id, period_type, period_start);
CREATE INDEX idx_ks_code              ON public.kpi_snapshot (kpi_code);
CREATE INDEX idx_ks_captured_at       ON public.kpi_snapshot (captured_at DESC);

CREATE INDEX idx_mr_scope             ON public.management_review (organization_id, business_unit_id);
CREATE INDEX idx_mr_status            ON public.management_review (review_status);
CREATE UNIQUE INDEX uq_mr_period_scope
  ON public.management_review (
    organization_id,
    COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_type,
    period_start,
    period_end,
    timezone,
    review_version
  );

CREATE INDEX idx_ccr_scope            ON public.change_control_record (organization_id, business_unit_id);
CREATE INDEX idx_ccr_status           ON public.change_control_record (change_status);
CREATE UNIQUE INDEX uq_ccr_change_code_scope
  ON public.change_control_record (
    organization_id,
    COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    change_code
  );

CREATE INDEX idx_de_from_node         ON public.dependency_edge (from_node);
CREATE INDEX idx_de_to_node           ON public.dependency_edge (to_node);
CREATE INDEX idx_de_kg_id             ON public.dependency_edge (kg_id);

CREATE INDEX idx_cs_scope             ON public.continuity_session (organization_id, business_unit_id);
CREATE INDEX idx_cs_status            ON public.continuity_session (session_status);
CREATE UNIQUE INDEX uq_cs_session_code_scope
  ON public.continuity_session (
    organization_id,
    COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    session_code
  );

CREATE INDEX idx_ct_session           ON public.continuity_transaction (continuity_session_id);
CREATE INDEX idx_ct_status            ON public.continuity_transaction (reconciliation_status);

CREATE INDEX idx_smp_active           ON public.service_module_profile (active);

CREATE INDEX idx_rg_sequence          ON public.release_gate (sequence_order);

-- ---------------------------------------------------------------------------
-- SECTION 2.5: GOVERNANCE ENFORCEMENT TRIGGERS
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE triggers enforce FSM transitions at the database level.
-- OLD.status (persisted row) is the authoritative source of current state —
-- caller-supplied "current_status" is never trusted.
-- Authenticated users cannot bypass these via raw REST PATCH.
--
-- Trigger functions use SECURITY DEFINER with a fixed search_path to
-- prevent search_path injection. EXECUTE is NOT granted to PUBLIC, anon,
-- or authenticated — triggers are not directly callable.
--
-- Payload hash trigger uses BEFORE INSERT (INSERT-only, immutable).
-- ---------------------------------------------------------------------------

-- ── management_review combined governance (stamp first, validate second) ──────
--
-- Design rationale: PostgreSQL 17 fires multiple same-event triggers
-- alphabetically by trigger name.  A separate FSM trigger and stamp trigger
-- on the same BEFORE UPDATE event would fire in name order, meaning the FSM
-- could reject closed_at IS NULL before the stamp trigger sets it.
-- Combining both responsibilities into a single deterministic function
-- eliminates the ordering dependency entirely.
--
-- Order of operations inside this function:
--   1. Terminal immutability guard (short-circuit)
--   2. DB-owned field stamping (opened_at, closed_at, waiver evidence)
--   3. Immutability guards on DB-owned identity fields
--   4. FSM transition validation
--   5. Closure prerequisite checks (waiver / unresolved actions)

CREATE OR REPLACE FUNCTION public.trg_wave6_mr_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
  v_to_in_review boolean;
  v_to_closed boolean;
BEGIN
  -- ── 1. Terminal immutability ─────────────────────────────────────────────────
  IF OLD.review_status = 'closed' THEN
    RAISE EXCEPTION
      'management_review: terminal row is immutable (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. DB-owned field stamping ───────────────────────────────────────────────
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'management_review: current_app_user_id() returned NULL'
      USING ERRCODE = 'P0001';
  END IF;

  v_to_in_review := (OLD.review_status = 'draft' AND NEW.review_status = 'in_review');
  v_to_closed := (
    OLD.review_status IN ('in_review', 'actions_open')
    AND NEW.review_status = 'closed'
  );

  -- opened_at: may only be set by DB during draft→in_review.
  IF v_to_in_review THEN
    NEW.opened_at := now();
  ELSIF OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL THEN
    RAISE EXCEPTION
      'management_review: opened_at may only be set during draft→in_review transition (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION
      'management_review: opened_at is DB-owned and immutable once set (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- closed_at: may only be set by DB during legal transition into closed.
  IF v_to_closed THEN
    NEW.closed_at := now();
  ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'management_review: closed_at may only be set during legal transition into closed (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION
      'management_review: closed_at is DB-owned and immutable once set (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Waiver is one-way: once true, it must stay true and evidence is immutable.
  IF NEW.waiver_recorded = true AND OLD.waiver_recorded = false THEN
    IF NULLIF(btrim(COALESCE(NEW.waiver_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION
        'management_review: waiver requires waiver_reason evidence (row id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    NEW.waiver_actor_app_user_id := v_actor;
    NEW.waiver_recorded_at := now();
  ELSIF OLD.waiver_recorded = true THEN
    IF NEW.waiver_recorded IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'management_review: waiver_recorded cannot transition true→false (row id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.waiver_reason IS DISTINCT FROM OLD.waiver_reason
       OR NEW.waiver_actor_app_user_id IS DISTINCT FROM OLD.waiver_actor_app_user_id
       OR NEW.waiver_recorded_at IS DISTINCT FROM OLD.waiver_recorded_at THEN
      RAISE EXCEPTION
        'management_review: waiver evidence is immutable once recorded (row id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.waiver_recorded IS NOT TRUE
     AND (
       NEW.waiver_reason IS NOT NULL
       OR NEW.waiver_actor_app_user_id IS NOT NULL
       OR NEW.waiver_recorded_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'management_review: waiver evidence may not be set unless waiver_recorded=true (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Immutability guards on DB-owned identity fields ──────────────────────
  IF NEW.created_by_app_user_id IS DISTINCT FROM OLD.created_by_app_user_id THEN
    RAISE EXCEPTION
      'management_review: created_by_app_user_id is immutable (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.owner_app_user_id IS DISTINCT FROM OLD.owner_app_user_id THEN
    RAISE EXCEPTION
      'management_review: owner_app_user_id cannot be silently reassigned (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4. FSM transition validation ────────────────────────────────────────────
  IF NEW.review_status <> OLD.review_status THEN
    -- Locked FSM: draft → in_review → actions_open | closed; actions_open → closed.
    IF NOT (
      (OLD.review_status = 'draft'        AND NEW.review_status = 'in_review')    OR
      (OLD.review_status = 'in_review'    AND NEW.review_status = 'actions_open') OR
      (OLD.review_status = 'in_review'    AND NEW.review_status = 'closed')       OR
      (OLD.review_status = 'actions_open' AND NEW.review_status = 'closed')
    ) THEN
      RAISE EXCEPTION
        'management_review FSM: illegal transition % → % (row id=%)',
        OLD.review_status, NEW.review_status, OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 5. Closure prerequisites ─────────────────────────────────────────────────
  IF NEW.review_status = 'closed' THEN
    IF NEW.closed_at IS NULL THEN
      RAISE EXCEPTION
        'management_review: closed_at must be set when closing (row id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.waiver_recorded IS NOT TRUE THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.actions) AS a
        WHERE (a->>'is_resolved')::boolean IS NOT TRUE
      ) THEN
        RAISE EXCEPTION
          'management_review: cannot close with unresolved actions unless waiver_recorded=true (row id=%)',
          OLD.id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_mr_governance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_mr_governance() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_mr_governance() FROM authenticated;

CREATE TRIGGER trig_wave6_mr_governance
  BEFORE UPDATE ON public.management_review
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_mr_governance();

COMMENT ON FUNCTION public.trg_wave6_mr_governance() IS
  'Wave 6: Combined management_review governance trigger. '
  'Stamps DB-owned fields first (opened_at, closed_at, waiver evidence), '
  'then enforces FSM transitions and closure prerequisites. '
  'Single-function design eliminates alphabetical trigger-order dependency. '
  'Closure requires resolved actions or waiver_recorded=true. SOURCE ONLY.';

-- ── change_control_record FSM ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Terminal immutability: a closed change control record cannot be modified.
  IF OLD.change_status = 'closed' THEN
    RAISE EXCEPTION
      'change_control_record: terminal row is immutable (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.change_status = OLD.change_status THEN
    RETURN NEW;
  END IF;

  -- Locked FSM: measure→analyze→improve→approve→update→retrain→validate→closed.
  IF NOT (
    (OLD.change_status = 'measure'  AND NEW.change_status = 'analyze')  OR
    (OLD.change_status = 'analyze'  AND NEW.change_status = 'improve')   OR
    (OLD.change_status = 'improve'  AND NEW.change_status = 'approve')   OR
    (OLD.change_status = 'approve'  AND NEW.change_status = 'update')    OR
    (OLD.change_status = 'update'   AND NEW.change_status = 'retrain')   OR
    (OLD.change_status = 'retrain'  AND NEW.change_status = 'validate')  OR
    (OLD.change_status = 'validate' AND NEW.change_status = 'closed')
  ) THEN
    RAISE EXCEPTION
      'change_control_record FSM: illegal transition % → % (row id=%)',
      OLD.change_status, NEW.change_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Training-required governance: retrain → validate requires training_status = 'completed'.
  IF OLD.change_status = 'retrain' AND NEW.change_status = 'validate' THEN
    IF NEW.training_required = true
       AND NEW.training_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION
        'change_control_record: retrain→validate requires training_status=completed when training_required=true (row id=%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Material-change closure prerequisites: impact_assessment + validation_result.passed=true.
  IF NEW.change_status = 'closed' AND NEW.material_change = true THEN
    IF NEW.impact_assessment IS NULL OR NEW.impact_assessment = '{}'::jsonb THEN
      RAISE EXCEPTION
        'change_control_record: material change requires impact_assessment before closure (row id=%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.validation_result ->> 'passed') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'change_control_record: material change requires validation_result.passed=true before closure (row id=%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_ccr_fsm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_enforce_ccr_fsm() FROM anon;
REVOKE ALL ON FUNCTION public.trg_enforce_ccr_fsm() FROM authenticated;

CREATE TRIGGER trig_ccr_fsm
  BEFORE UPDATE ON public.change_control_record
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_ccr_fsm();

COMMENT ON FUNCTION public.trg_enforce_ccr_fsm() IS
  'Wave 6: DB-level change_control_record FSM. '
  'measure→analyze→improve→approve→update→retrain→validate→closed. '
  'Material changes require impact_assessment + validation_result.passed=true. SOURCE ONLY.';

CREATE OR REPLACE FUNCTION public.trg_validate_ccr_dependency_impact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_requires_assessment boolean;
  v_source text;
  v_paths jsonb;
  v_path jsonb;
  v_edge_exists boolean;
  v_reachable_nodes text[];
  v_node text;
BEGIN
  v_requires_assessment := (
    NEW.material_change = true
    AND NEW.change_status IN ('approve', 'update', 'retrain', 'validate', 'closed')
  );

  IF NOT v_requires_assessment THEN
    RETURN NEW;
  END IF;

  IF NEW.impact_assessment IS NULL OR jsonb_typeof(NEW.impact_assessment) <> 'object' THEN
    RAISE EXCEPTION
      'change_control_record: material change in % requires structured impact_assessment object (row id=%)',
      NEW.change_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  v_source := NULLIF(btrim(COALESCE(NEW.impact_assessment ->> 'dependency_graph_source', '')), '');
  IF v_source IS NULL THEN
    RAISE EXCEPTION
      'change_control_record: impact_assessment.dependency_graph_source is required before % (row id=%)',
      NEW.change_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.dependency_edge de
    WHERE de.from_node = v_source
      AND (de.organization_id IS NULL OR de.organization_id = NEW.organization_id)
  ) THEN
    RAISE EXCEPTION
      'change_control_record: dependency_graph_source "%" is not a visible dependency_edge source node (row id=%)',
      v_source, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  v_paths := NEW.impact_assessment -> 'dependency_paths';
  IF jsonb_typeof(v_paths) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'change_control_record: impact_assessment.dependency_paths must be an array (row id=%)',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_paths) = 0 THEN
    RAISE EXCEPTION
      'change_control_record: impact_assessment.dependency_paths must be non-empty for material change (row id=%)',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_path IN
    SELECT value
    FROM jsonb_array_elements(v_paths)
  LOOP
    IF NULLIF(btrim(COALESCE(v_path ->> 'kg_id', '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_path ->> 'from_node', '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_path ->> 'to_node', '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_path ->> 'edge_type', '')), '') IS NULL THEN
      RAISE EXCEPTION
        'change_control_record: dependency_paths entries must include kg_id/from_node/to_node/edge_type (row id=%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.dependency_edge de
      WHERE de.kg_id = (v_path ->> 'kg_id')
        AND de.from_node = (v_path ->> 'from_node')
        AND de.to_node = (v_path ->> 'to_node')
        AND de.edge_type = (v_path ->> 'edge_type')
        AND (
          (de.control_rule IS NULL AND NULLIF(v_path ->> 'control_rule', '') IS NULL)
          OR de.control_rule = (v_path ->> 'control_rule')
        )
        AND (de.organization_id IS NULL OR de.organization_id = NEW.organization_id)
    ) INTO v_edge_exists;

    IF NOT v_edge_exists THEN
      RAISE EXCEPTION
        'change_control_record: dependency_paths includes edge that does not exist or is not visible (kg_id=% from=% to=% type=%) (row id=%)',
        v_path ->> 'kg_id',
        v_path ->> 'from_node',
        v_path ->> 'to_node',
        v_path ->> 'edge_type',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  WITH RECURSIVE reachable(node, visited) AS (
    SELECT
      de.to_node,
      ARRAY[de.from_node, de.to_node]::text[]
    FROM public.dependency_edge de
    WHERE de.from_node = v_source
      AND (de.organization_id IS NULL OR de.organization_id = NEW.organization_id)

    UNION ALL

    SELECT
      de.to_node,
      (r.visited || de.to_node)::text[]
    FROM reachable r
    JOIN public.dependency_edge de
      ON de.from_node = r.node
    WHERE (de.organization_id IS NULL OR de.organization_id = NEW.organization_id)
      AND NOT de.to_node = ANY(r.visited)
  )
  SELECT COALESCE(array_agg(DISTINCT node), ARRAY[]::text[])
  INTO v_reachable_nodes
  FROM reachable;

  IF NEW.affected_dependencies IS NULL OR array_length(NEW.affected_dependencies, 1) IS NULL THEN
    RAISE EXCEPTION
      'change_control_record: affected_dependencies must be non-empty for material change before % (row id=%)',
      NEW.change_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_node IN ARRAY NEW.affected_dependencies
  LOOP
    IF v_node IS NULL OR btrim(v_node) = '' THEN
      RAISE EXCEPTION
        'change_control_record: affected_dependencies cannot contain blank nodes (row id=%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT (v_node = ANY(v_reachable_nodes)) THEN
      RAISE EXCEPTION
        'change_control_record: affected dependency "%" is not downstream-reachable from source "%" (row id=%)',
        v_node, v_source, OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_validate_ccr_dependency_impact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_validate_ccr_dependency_impact() FROM anon;
REVOKE ALL ON FUNCTION public.trg_validate_ccr_dependency_impact() FROM authenticated;

CREATE TRIGGER trig_ccr_dependency_impact_validate
  BEFORE UPDATE ON public.change_control_record
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_ccr_dependency_impact();

COMMENT ON FUNCTION public.trg_validate_ccr_dependency_impact() IS
  'Wave 6: DB-level dependency-impact validator for material change_control_record transitions into '
  'approve/update/retrain/validate/closed. Validates dependency_graph_source, structured '
  'dependency_paths edges, and downstream-reachable affected_dependencies via recursive cycle-safe CTE. SOURCE ONLY.';


-- ── continuity_session FSM ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_enforce_continuity_fsm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pending_count integer;
BEGIN
  -- Terminal immutability: a closed session cannot be modified at all.
  IF OLD.session_status = 'closed' THEN
    RAISE EXCEPTION
      'continuity_session: terminal row is immutable (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.session_status = OLD.session_status THEN
    RETURN NEW;
  END IF;

  -- Locked FSM: declared→fallback_active→service_restored→reconciling→reconciled→closed.
  IF NOT (
    (OLD.session_status = 'declared'         AND NEW.session_status = 'fallback_active')  OR
    (OLD.session_status = 'fallback_active'  AND NEW.session_status = 'service_restored') OR
    (OLD.session_status = 'service_restored' AND NEW.session_status = 'reconciling')      OR
    (OLD.session_status = 'reconciling'      AND NEW.session_status = 'reconciled')       OR
    (OLD.session_status = 'reconciled'       AND NEW.session_status = 'closed')
  ) THEN
    RAISE EXCEPTION
      'continuity_session FSM: illegal transition % → % (row id=%)',
      OLD.session_status, NEW.session_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Closure prerequisite: no unresolved transactions (unless waiver recorded).
  -- Terminal statuses for continuity_transaction: matched, discrepancy, waived.
  -- Pending/unresolved statuses block closure without a waiver.
  IF NEW.session_status = 'closed' AND NOT COALESCE(NEW.waiver_recorded, false) THEN
    SELECT COUNT(*) INTO v_pending_count
    FROM public.continuity_transaction ct
    WHERE ct.continuity_session_id = NEW.id
      AND ct.reconciliation_status NOT IN ('matched', 'discrepancy', 'waived');
    IF v_pending_count > 0 THEN
      RAISE EXCEPTION
        'continuity_session: cannot close — % unresolved transaction(s) pending reconciliation (row id=%)',
        v_pending_count, OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_continuity_fsm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_enforce_continuity_fsm() FROM anon;
REVOKE ALL ON FUNCTION public.trg_enforce_continuity_fsm() FROM authenticated;

CREATE TRIGGER trig_continuity_fsm
  BEFORE UPDATE ON public.continuity_session
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_continuity_fsm();

COMMENT ON FUNCTION public.trg_enforce_continuity_fsm() IS
  'Wave 6: DB-level continuity_session FSM. '
  'declared→fallback_active→service_restored→reconciling→reconciled→closed. '
  'Closure blocked when unresolved transactions exist (unless waiver_recorded=true). '
  'Terminal rows are immutable. SOURCE ONLY.';

-- ── release_gate sequence enforcement ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_enforce_release_gate_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev_status text;
BEGIN
  -- Terminal immutability: a passed gate row cannot be modified at all.
  IF OLD.gate_status = 'passed' THEN
    RAISE EXCEPTION
      'release_gate: gate % (id=%) is passed — terminal evidence is immutable',
      OLD.gate_code, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- When moving to passed, enforce the linear predecessor chain.
  -- PILOT (sequence 1) has no predecessor and may proceed freely.
  -- Any gate with sequence_order > 1 MUST have exactly one predecessor at
  -- sequence_order - 1 that is already 'passed'.  A missing predecessor is
  -- rejected (fail closed), not silently allowed.
  IF NEW.gate_status = 'passed' AND OLD.gate_status <> 'passed' THEN
    IF NEW.sequence_order > 1 THEN
      SELECT rg.gate_status INTO v_prev_status
      FROM public.release_gate rg
      WHERE rg.sequence_order = (NEW.sequence_order - 1)
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'release_gate: cannot pass gate % (sequence %) — predecessor at sequence % is absent',
          NEW.gate_code, NEW.sequence_order, (NEW.sequence_order - 1)
          USING ERRCODE = 'P0001';
      END IF;

      IF v_prev_status <> 'passed' THEN
        RAISE EXCEPTION
          'release_gate: cannot pass gate % (sequence %) before predecessor (sequence %) is passed',
          NEW.gate_code, NEW.sequence_order, (NEW.sequence_order - 1)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM anon;
REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM authenticated;

CREATE TRIGGER trig_release_gate_sequence
  BEFORE UPDATE ON public.release_gate
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_release_gate_sequence();

COMMENT ON FUNCTION public.trg_enforce_release_gate_sequence() IS
  'Wave 6: DB-level release_gate sequence enforcement. '
  'Passed gates are immutable. A gate with sequence_order > 1 cannot pass if its '
  'predecessor is absent (fail closed) or not yet passed. SOURCE ONLY.';

-- ── continuity_transaction payload hash (INSERT-only, immutable) ─────────────

CREATE OR REPLACE FUNCTION public.trg_set_continuity_payload_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Canonical representation includes identity envelope + transaction_data.
  -- Algorithm: SHA-256 via extensions.digest() (pgcrypto in schema extensions,
  -- as installed in the Have Us Clean Supabase project). Encoded as hex (64 chars).
  -- Schema-qualified to guarantee resolution regardless of search_path.
  -- This function is INSERT-only — the hash is never silently overwritten.
  -- FAIL CLOSED: if extensions.digest is unavailable the exception propagates
  -- and the INSERT is aborted. payload_hash is NOT NULL on continuity_transaction.
  NEW.payload_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'continuity_session_id', NEW.continuity_session_id,
        'offline_correlation_id', NEW.offline_correlation_id,
        'organization_id', NEW.organization_id,
        'business_unit_id', NEW.business_unit_id,
        'transaction_type', NEW.transaction_type,
        'serviceos_entity_type', NEW.serviceos_entity_type,
        'serviceos_entity_id', NEW.serviceos_entity_id,
        'transaction_data', NEW.transaction_data
      )::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_set_continuity_payload_hash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_set_continuity_payload_hash() FROM anon;
REVOKE ALL ON FUNCTION public.trg_set_continuity_payload_hash() FROM authenticated;

CREATE TRIGGER trig_continuity_payload_hash
  BEFORE INSERT ON public.continuity_transaction
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_continuity_payload_hash();

COMMENT ON FUNCTION public.trg_set_continuity_payload_hash() IS
  'Wave 6: Computes SHA-256 payload_hash for continuity_transaction on INSERT. '
  'Hash covers continuity_session_id, offline_correlation_id, organization_id, business_unit_id, transaction_type, serviceos_entity_type, serviceos_entity_id, and transaction_data. '
  'Schema-qualified extensions.digest (pgcrypto in schema extensions). '
  'INSERT-only trigger — hash is immutable after row creation. '
  'FAIL CLOSED: if extensions.digest unavailable the INSERT is aborted. SOURCE ONLY.';
-- ── continuity_transaction field immutability (BEFORE UPDATE) ────────────────
-- Prevents post-insertion mutation of payload_hash, transaction_data, and
-- offline_correlation_id. The hash is bound to the captured payload at INSERT
-- time and must remain bound to it forever.

CREATE OR REPLACE FUNCTION public.trg_immute_continuity_transaction_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
    RAISE EXCEPTION
      'continuity_transaction: payload_hash is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.transaction_data IS DISTINCT FROM OLD.transaction_data THEN
    RAISE EXCEPTION
      'continuity_transaction: transaction_data is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.offline_correlation_id IS DISTINCT FROM OLD.offline_correlation_id THEN
    RAISE EXCEPTION
      'continuity_transaction: offline_correlation_id is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.continuity_session_id IS DISTINCT FROM OLD.continuity_session_id THEN
    RAISE EXCEPTION
      'continuity_transaction: continuity_session_id is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION
      'continuity_transaction: organization_id is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.business_unit_id IS DISTINCT FROM OLD.business_unit_id THEN
    RAISE EXCEPTION
      'continuity_transaction: business_unit_id is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.transaction_type IS DISTINCT FROM OLD.transaction_type THEN
    RAISE EXCEPTION
      'continuity_transaction: transaction_type is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.serviceos_entity_type IS DISTINCT FROM OLD.serviceos_entity_type THEN
    RAISE EXCEPTION
      'continuity_transaction: serviceos_entity_type is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.serviceos_entity_id IS DISTINCT FROM OLD.serviceos_entity_id THEN
    RAISE EXCEPTION
      'continuity_transaction: serviceos_entity_id is immutable after insertion (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_immute_continuity_transaction_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_immute_continuity_transaction_fields() FROM anon;
REVOKE ALL ON FUNCTION public.trg_immute_continuity_transaction_fields() FROM authenticated;

CREATE TRIGGER trig_immute_continuity_transaction_fields
  BEFORE UPDATE ON public.continuity_transaction
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_immute_continuity_transaction_fields();

COMMENT ON FUNCTION public.trg_immute_continuity_transaction_fields() IS
  'Wave 6: Prevents post-insertion mutation of payload_hash, transaction_data, and '
  'offline_correlation_id on continuity_transaction. The hash must remain bound to the '
  'captured payload. Raises P0001 on any attempt to modify these fields. SOURCE ONLY.';

-- ── Wave 6 INSERT guards + DB-owned actor/timestamp ownership ────────────────

CREATE OR REPLACE FUNCTION public.trg_wave6_guard_management_review_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'management_review: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.review_status <> 'draft' THEN
    RAISE EXCEPTION 'management_review: insert must start at draft (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.opened_at IS NOT NULL
     OR NEW.closed_at IS NOT NULL
     OR NEW.waiver_recorded = true
     OR NEW.waiver_reason IS NOT NULL
     OR NEW.waiver_actor_app_user_id IS NOT NULL
     OR NEW.waiver_recorded_at IS NOT NULL THEN
    RAISE EXCEPTION 'management_review: insert cannot pre-populate transition/waiver evidence (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.created_by_app_user_id IS NOT NULL AND NEW.created_by_app_user_id <> v_actor THEN
    RAISE EXCEPTION 'management_review: created_by_app_user_id spoof rejected (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.owner_app_user_id IS NOT NULL AND NEW.owner_app_user_id <> v_actor THEN
    RAISE EXCEPTION 'management_review: owner_app_user_id spoof rejected (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  NEW.created_by_app_user_id := v_actor;
  NEW.owner_app_user_id := COALESCE(NEW.owner_app_user_id, v_actor);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_guard_management_review_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_management_review_insert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_management_review_insert() FROM authenticated;

-- trg_wave6_stamp_management_review_update has been merged into trg_wave6_mr_governance.

CREATE OR REPLACE FUNCTION public.trg_wave6_guard_ccr_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'change_control_record: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.change_status <> 'measure' THEN
    RAISE EXCEPTION 'change_control_record: insert must start at measure (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.approval_at IS NOT NULL OR NEW.approval_actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'change_control_record: insert cannot pre-populate approval evidence (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.created_by_app_user_id IS NOT NULL AND NEW.created_by_app_user_id <> v_actor THEN
    RAISE EXCEPTION 'change_control_record: created_by_app_user_id spoof rejected (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  NEW.created_by_app_user_id := v_actor;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_guard_ccr_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_ccr_insert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_ccr_insert() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_stamp_ccr_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'change_control_record: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.created_by_app_user_id IS DISTINCT FROM OLD.created_by_app_user_id THEN
    RAISE EXCEPTION 'change_control_record: created_by_app_user_id is immutable (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.change_status = 'approve' AND OLD.change_status <> 'approve' THEN
    NEW.approval_actor_id := v_actor;
    NEW.approval_at := now();
  ELSIF NEW.approval_actor_id IS DISTINCT FROM OLD.approval_actor_id THEN
    RAISE EXCEPTION 'change_control_record: approval_actor_id is DB-owned (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.change_status = 'closed' AND NEW.validation_result = '{}'::jsonb THEN
    RAISE EXCEPTION 'change_control_record: validation_result evidence is required before closure (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  -- approval_at is immutable once set.
  IF OLD.approval_at IS NOT NULL AND NEW.approval_at IS DISTINCT FROM OLD.approval_at THEN
    RAISE EXCEPTION 'change_control_record: approval_at is immutable after approval (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_stamp_ccr_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_ccr_update() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_ccr_update() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_guard_continuity_session_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'continuity_session: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.session_status <> 'declared' THEN
    RAISE EXCEPTION 'continuity_session: insert must start at declared (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.service_restored_at IS NOT NULL OR NEW.reconciliation_started_at IS NOT NULL
     OR NEW.reconciliation_completed_at IS NOT NULL OR NEW.closed_at IS NOT NULL
     OR NEW.closed_by_app_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_session: insert cannot pre-populate transition-owned timestamps/actors (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.waiver_recorded = true
     OR NEW.waiver_reason IS NOT NULL
     OR NEW.waiver_actor_app_user_id IS NOT NULL
     OR NEW.waiver_recorded_at IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_session: insert cannot pre-populate waiver evidence (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  -- declared_at has a DEFAULT now(); DB still owns this value and always restamps it.
  NEW.declared_at := now();
  NEW.declared_by_app_user_id := v_actor;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_session_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_session_insert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_session_insert() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_stamp_continuity_session_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
  v_to_service_restored boolean;
  v_to_reconciling boolean;
  v_to_reconciled boolean;
  v_to_closed boolean;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'continuity_session: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;

  v_to_service_restored := (
    OLD.session_status = 'fallback_active'
    AND NEW.session_status = 'service_restored'
  );
  v_to_reconciling := (
    OLD.session_status = 'service_restored'
    AND NEW.session_status = 'reconciling'
  );
  v_to_reconciled := (
    OLD.session_status = 'reconciling'
    AND NEW.session_status = 'reconciled'
  );
  v_to_closed := (
    OLD.session_status = 'reconciled'
    AND NEW.session_status = 'closed'
  );

  IF NEW.declared_at IS DISTINCT FROM OLD.declared_at THEN
    RAISE EXCEPTION 'continuity_session: declared_at is DB-owned and immutable (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.declared_by_app_user_id IS DISTINCT FROM OLD.declared_by_app_user_id THEN
    RAISE EXCEPTION 'continuity_session: declared_by_app_user_id is immutable (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF v_to_service_restored THEN
    NEW.service_restored_at := now();
  ELSIF OLD.service_restored_at IS NULL AND NEW.service_restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_session: service_restored_at may only be set on fallback_active→service_restored (row id=%)', OLD.id USING ERRCODE = 'P0001';
  ELSIF OLD.service_restored_at IS NOT NULL AND NEW.service_restored_at IS DISTINCT FROM OLD.service_restored_at THEN
    RAISE EXCEPTION 'continuity_session: service_restored_at is DB-owned and immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF v_to_reconciling THEN
    NEW.reconciliation_started_at := now();
  ELSIF OLD.reconciliation_started_at IS NULL AND NEW.reconciliation_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_session: reconciliation_started_at may only be set on service_restored→reconciling (row id=%)', OLD.id USING ERRCODE = 'P0001';
  ELSIF OLD.reconciliation_started_at IS NOT NULL AND NEW.reconciliation_started_at IS DISTINCT FROM OLD.reconciliation_started_at THEN
    RAISE EXCEPTION 'continuity_session: reconciliation_started_at is DB-owned and immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF v_to_reconciled THEN
    NEW.reconciliation_completed_at := now();
  ELSIF OLD.reconciliation_completed_at IS NULL AND NEW.reconciliation_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_session: reconciliation_completed_at may only be set on reconciling→reconciled (row id=%)', OLD.id USING ERRCODE = 'P0001';
  ELSIF OLD.reconciliation_completed_at IS NOT NULL AND NEW.reconciliation_completed_at IS DISTINCT FROM OLD.reconciliation_completed_at THEN
    RAISE EXCEPTION 'continuity_session: reconciliation_completed_at is DB-owned and immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF NEW.waiver_recorded = true AND OLD.waiver_recorded = false THEN
    IF NULLIF(btrim(COALESCE(NEW.waiver_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'continuity_session: waiver requires rationale/evidence (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
    NEW.waiver_actor_app_user_id := v_actor;
    NEW.waiver_recorded_at := now();
  ELSIF OLD.waiver_recorded = true THEN
    IF NEW.waiver_recorded IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'continuity_session: waiver_recorded cannot transition true→false (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF NEW.waiver_reason IS DISTINCT FROM OLD.waiver_reason
       OR NEW.waiver_actor_app_user_id IS DISTINCT FROM OLD.waiver_actor_app_user_id
       OR NEW.waiver_recorded_at IS DISTINCT FROM OLD.waiver_recorded_at THEN
      RAISE EXCEPTION 'continuity_session: waiver evidence is immutable once recorded (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.waiver_recorded IS NOT TRUE
     AND (
       NEW.waiver_reason IS NOT NULL
       OR NEW.waiver_actor_app_user_id IS NOT NULL
       OR NEW.waiver_recorded_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'continuity_session: waiver evidence may not be set unless waiver_recorded=true (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF v_to_closed THEN
    NEW.closed_at := now();
    NEW.closed_by_app_user_id := v_actor;
  ELSIF OLD.closed_at IS NULL
        AND (NEW.closed_at IS NOT NULL OR NEW.closed_by_app_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'continuity_session: closed_at/closed_by may only be set on reconciled→closed (row id=%)', OLD.id USING ERRCODE = 'P0001';
  ELSIF OLD.closed_at IS NOT NULL THEN
    IF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'continuity_session: closed_at is DB-owned and immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF NEW.closed_by_app_user_id IS DISTINCT FROM OLD.closed_by_app_user_id THEN
      RAISE EXCEPTION 'continuity_session: closed_by_app_user_id is DB-owned and immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_stamp_continuity_session_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_continuity_session_update() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_continuity_session_update() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_guard_continuity_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_parent public.continuity_session%ROWTYPE;
BEGIN
  IF NEW.reconciliation_status <> 'pending' THEN
    RAISE EXCEPTION 'continuity_transaction: insert must start pending (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.reconciled_at IS NOT NULL OR NEW.reconciled_by_app_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_transaction: insert cannot pre-populate reconciliation evidence (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_parent FROM public.continuity_session WHERE id = NEW.continuity_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'continuity_transaction: parent continuity_session does not exist (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.organization_id <> v_parent.organization_id THEN
    RAISE EXCEPTION 'continuity_transaction: organization must match parent continuity_session (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(NEW.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
     <> COALESCE(v_parent.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'continuity_transaction: business_unit_id must match parent continuity_session (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  -- INSERT must not pre-populate reconciliation evidence.
  IF NEW.discrepancy_notes IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_transaction: insert cannot pre-populate discrepancy_notes (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.waiver_evidence IS NOT NULL THEN
    RAISE EXCEPTION 'continuity_transaction: insert cannot pre-populate waiver_evidence (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_transaction_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_transaction_insert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_transaction_insert() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_enforce_continuity_transaction_fsm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'continuity_transaction: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.reconciliation_status IN ('matched','discrepancy','waived')
     AND NEW.reconciliation_status IS DISTINCT FROM OLD.reconciliation_status THEN
    RAISE EXCEPTION 'continuity_transaction: terminal reconciliation state is immutable (row id=%)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.reconciliation_status = 'pending'
     AND NEW.reconciliation_status IN ('matched','discrepancy','waived') THEN
    NEW.reconciled_at := now();
    NEW.reconciled_by_app_user_id := v_actor;
  ELSIF OLD.reconciliation_status IN ('matched','discrepancy','waived') THEN
    -- Immutability: reconciliation evidence cannot change once terminal.
    IF NEW.discrepancy_notes IS DISTINCT FROM OLD.discrepancy_notes
       OR NEW.waiver_evidence IS DISTINCT FROM OLD.waiver_evidence
       OR NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at
       OR NEW.reconciled_by_app_user_id IS DISTINCT FROM OLD.reconciled_by_app_user_id THEN
      RAISE EXCEPTION 'continuity_transaction: reconciliation evidence is immutable once set (row id=%)', OLD.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_enforce_continuity_transaction_fsm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_enforce_continuity_transaction_fsm() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_enforce_continuity_transaction_fsm() FROM authenticated;

CREATE TRIGGER trig_wave6_mr_insert_guard
  BEFORE INSERT ON public.management_review
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_guard_management_review_insert();

-- trig_wave6_mr_update_stamp removed: replaced by trig_wave6_mr_governance above.

CREATE TRIGGER trig_wave6_ccr_insert_guard
  BEFORE INSERT ON public.change_control_record
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_guard_ccr_insert();

CREATE TRIGGER trig_wave6_ccr_update_stamp
  BEFORE UPDATE ON public.change_control_record
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_stamp_ccr_update();

CREATE TRIGGER trig_wave6_cs_insert_guard
  BEFORE INSERT ON public.continuity_session
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_guard_continuity_session_insert();

CREATE TRIGGER trig_wave6_cs_update_stamp
  BEFORE UPDATE ON public.continuity_session
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_stamp_continuity_session_update();

CREATE TRIGGER trig_wave6_ct_insert_guard
  BEFORE INSERT ON public.continuity_transaction
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_guard_continuity_transaction_insert();

CREATE TRIGGER trig_wave6_ct_reconciliation_fsm
  BEFORE UPDATE ON public.continuity_transaction
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_enforce_continuity_transaction_fsm();

-- kpi_snapshot BEFORE INSERT: DB-stamp captured_at / captured_by_app_user_id
-- and validate governed definition applicability.
CREATE OR REPLACE FUNCTION public.trg_wave6_stamp_kpi_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid;
  v_def   public.kpi_definition%ROWTYPE;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'kpi_snapshot: current_app_user_id() returned NULL' USING ERRCODE = 'P0001';
  END IF;
  -- DB owns captured_at: always override any caller-supplied value.
  NEW.captured_at := now();
  -- DB owns captured_by_app_user_id: always override any caller-supplied value.
  NEW.captured_by_app_user_id := v_actor;

  -- Load and validate the referenced kpi_definition.
  SELECT * INTO v_def FROM public.kpi_definition WHERE id = NEW.kpi_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kpi_snapshot: kpi_definition % not found (row id=%)',
      NEW.kpi_definition_id, NEW.id USING ERRCODE = 'P0001';
  END IF;

  -- Organization scope: org-specific definition must match snapshot org.
  IF v_def.organization_id IS NOT NULL AND v_def.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'kpi_snapshot: definition organization scope mismatch (row id=%)',
      NEW.id USING ERRCODE = 'P0001';
  END IF;

  -- Definition must be active.
  IF v_def.active = false THEN
    RAISE EXCEPTION 'kpi_snapshot: kpi_definition % is inactive (row id=%)',
      NEW.kpi_definition_id, NEW.id USING ERRCODE = 'P0001';
  END IF;

  -- period_support must contain the snapshot period_type.
  IF NOT (NEW.period_type = ANY(v_def.period_support)) THEN
    RAISE EXCEPTION 'kpi_snapshot: definition % does not support period_type % (row id=%)',
      NEW.kpi_definition_id, NEW.period_type, NEW.id USING ERRCODE = 'P0001';
  END IF;

  -- effective_from / effective_to must cover the FULL snapshot period.
  IF v_def.effective_from IS NOT NULL AND v_def.effective_from > NEW.period_start THEN
    RAISE EXCEPTION
      'kpi_snapshot: definition effective_from % is after snapshot period_start % (row id=%)',
      v_def.effective_from, NEW.period_start, NEW.id USING ERRCODE = 'P0001';
  END IF;
  IF v_def.effective_to IS NOT NULL AND v_def.effective_to < NEW.period_end THEN
    RAISE EXCEPTION
      'kpi_snapshot: definition effective_to % is before snapshot period_end % (row id=%)',
      v_def.effective_to, NEW.period_end, NEW.id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_stamp_kpi_snapshot_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_kpi_snapshot_insert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_stamp_kpi_snapshot_insert() FROM authenticated;

-- Scope/lineage validation (fires on INSERT and UPDATE).
CREATE OR REPLACE FUNCTION public.trg_wave6_validate_kpi_snapshot_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_definition_org uuid;
BEGIN
  SELECT kd.organization_id INTO v_definition_org
  FROM public.kpi_definition kd
  WHERE kd.id = NEW.kpi_definition_id;
  IF v_definition_org IS NOT NULL AND v_definition_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'kpi_snapshot: definition organization scope mismatch (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_validate_kpi_snapshot_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_kpi_snapshot_scope() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_kpi_snapshot_scope() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_validate_management_review_manifest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item jsonb;
  v_snapshot public.kpi_snapshot%ROWTYPE;
BEGIN
  IF jsonb_typeof(NEW.kpi_snapshot_manifest) <> 'array' THEN
    RAISE EXCEPTION 'management_review: kpi_snapshot_manifest must be an array (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.kpi_snapshot_manifest)
  LOOP
    SELECT * INTO v_snapshot
    FROM public.kpi_snapshot ks
    WHERE ks.id = (v_item->>'kpi_snapshot_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'management_review: manifest references missing kpi_snapshot_id % (row id=%)', v_item->>'kpi_snapshot_id', NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF v_snapshot.kpi_code <> v_item->>'kpi_code'
       OR v_snapshot.definition_version <> v_item->>'definition_version' THEN
      RAISE EXCEPTION 'management_review: manifest code/version mismatch for snapshot % (row id=%)', v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF v_snapshot.organization_id <> NEW.organization_id
       OR COALESCE(v_snapshot.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
          <> COALESCE(NEW.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
       OR v_snapshot.period_type <> NEW.period_type
       OR v_snapshot.period_start <> NEW.period_start
       OR v_snapshot.period_end <> NEW.period_end
       OR v_snapshot.timezone <> NEW.timezone THEN
      RAISE EXCEPTION 'management_review: manifest snapshot scope mismatch for snapshot % (row id=%)', v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    -- captured_at in the manifest must equal the actual snapshot captured_at.
    IF v_item->>'captured_at' IS NULL THEN
      RAISE EXCEPTION
        'management_review: manifest entry must include captured_at for snapshot % (row id=%)',
        v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF (v_item->>'captured_at')::timestamptz IS DISTINCT FROM v_snapshot.captured_at THEN
      RAISE EXCEPTION
        'management_review: manifest captured_at does not match snapshot captured_at for snapshot % (row id=%)',
        v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_validate_management_review_manifest() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_management_review_manifest() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_management_review_manifest() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_wave6_validate_ccr_kpi_manifest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item           jsonb;
  v_snapshot       public.kpi_snapshot%ROWTYPE;
  v_snapshot_ids   uuid[];
  v_snap_id        uuid;
  v_manifest_codes text[];
  v_manifest_code  text;
  v_source_code    text;
BEGIN
  IF jsonb_typeof(NEW.source_kpi_snapshot_manifest) <> 'array' THEN
    RAISE EXCEPTION 'change_control_record: source_kpi_snapshot_manifest must be an array (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;

  -- Require non-empty manifest when source_kpi_codes is non-empty.
  IF array_length(NEW.source_kpi_codes, 1) IS NOT NULL
     AND array_length(NEW.source_kpi_codes, 1) > 0
     AND jsonb_array_length(NEW.source_kpi_snapshot_manifest) = 0 THEN
    RAISE EXCEPTION 'change_control_record: source_kpi_codes require real kpi_snapshot manifest references (row id=%)', NEW.id USING ERRCODE = 'P0001';
  END IF;

  v_snapshot_ids   := ARRAY[]::uuid[];
  v_manifest_codes := ARRAY[]::text[];

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.source_kpi_snapshot_manifest)
  LOOP
    v_snap_id := (v_item->>'kpi_snapshot_id')::uuid;

    -- Reject duplicate snapshot IDs in the manifest.
    IF v_snap_id = ANY(v_snapshot_ids) THEN
      RAISE EXCEPTION
        'change_control_record: duplicate kpi_snapshot_id % in manifest (row id=%)',
        v_snap_id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    v_snapshot_ids := v_snapshot_ids || v_snap_id;

    SELECT * INTO v_snapshot FROM public.kpi_snapshot ks WHERE ks.id = v_snap_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'change_control_record: manifest references missing kpi_snapshot_id % (row id=%)', v_snap_id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF v_snapshot.kpi_code <> v_item->>'kpi_code'
       OR v_snapshot.definition_version <> v_item->>'definition_version' THEN
      RAISE EXCEPTION 'change_control_record: manifest code/version mismatch for snapshot % (row id=%)', v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF v_snapshot.organization_id <> NEW.organization_id
       OR COALESCE(v_snapshot.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
          <> COALESCE(NEW.business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RAISE EXCEPTION 'change_control_record: manifest scope mismatch for snapshot % (row id=%)', v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;

    -- source_lineage must be a populated object; fail closed on NULL, non-object, or empty.
    IF v_snapshot.source_lineage IS NULL
       OR jsonb_typeof(v_snapshot.source_lineage) <> 'object'
       OR v_snapshot.source_lineage = '{}'::jsonb THEN
      RAISE EXCEPTION
        'change_control_record: manifest snapshot % lacks populated source_lineage (row id=%)',
        v_snapshot.id, NEW.id USING ERRCODE = 'P0001';
    END IF;

    -- Accumulate manifest KPI codes for cross-set validation.
    IF NOT (v_snapshot.kpi_code = ANY(v_manifest_codes)) THEN
      v_manifest_codes := v_manifest_codes || v_snapshot.kpi_code;
    END IF;
  END LOOP;

  -- Exact binding: every source_kpi_code must appear in at least one manifest snapshot.
  IF array_length(NEW.source_kpi_codes, 1) IS NOT NULL THEN
    FOREACH v_source_code IN ARRAY NEW.source_kpi_codes
    LOOP
      IF NOT (v_source_code = ANY(v_manifest_codes)) THEN
        RAISE EXCEPTION
          'change_control_record: source_kpi_code % has no corresponding manifest snapshot (row id=%)',
          v_source_code, NEW.id USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Exact binding: every manifest KPI code must exist in source_kpi_codes.
  FOREACH v_manifest_code IN ARRAY v_manifest_codes
  LOOP
    IF NOT (v_manifest_code = ANY(NEW.source_kpi_codes)) THEN
      RAISE EXCEPTION
        'change_control_record: manifest kpi_code % is not in source_kpi_codes (row id=%)',
        v_manifest_code, NEW.id USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_wave6_validate_ccr_kpi_manifest() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_ccr_kpi_manifest() FROM anon;
REVOKE ALL ON FUNCTION public.trg_wave6_validate_ccr_kpi_manifest() FROM authenticated;

CREATE TRIGGER trig_wave6_kpi_snapshot_stamp
  BEFORE INSERT ON public.kpi_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_stamp_kpi_snapshot_insert();

CREATE TRIGGER trig_wave6_kpi_snapshot_scope
  BEFORE INSERT OR UPDATE ON public.kpi_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_validate_kpi_snapshot_scope();

CREATE TRIGGER trig_wave6_management_review_manifest
  BEFORE INSERT OR UPDATE ON public.management_review
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_validate_management_review_manifest();

CREATE TRIGGER trig_wave6_ccr_manifest
  BEFORE INSERT OR UPDATE ON public.change_control_record
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_wave6_validate_ccr_kpi_manifest();



-- ---------------------------------------------------------------------------
-- SECTION 3: CANONICAL EVENT VIEW
-- ---------------------------------------------------------------------------
-- Read-only canonical event spine.
--
-- SCOPE RULE: this view references ONLY tables whose DDL is present in this
-- repository's migration history — 007 (Wave 3), 009 (Wave 4) and 012 (Wave 5).
-- Every column below was verified against those files:
--
--   operational_job            007:59   organization_id, business_unit_id,
--                                       jurisdiction_id, created_at
--   work_order                 007:252  organization_id, business_unit_id,
--                                       jurisdiction_id, work_order_status,
--                                       service_completed_at, updated_at
--   qa_inspection              007:472  organization_id, business_unit_id,
--                                       inspection_status, inspected_at,
--                                       updated_at   (no jurisdiction_id)
--   service_exception          009:218  organization_id, business_unit_id,
--                                       reported_at  (no jurisdiction_id)
--   customer_outcome           009:299  organization_id, business_unit_id,
--                                       outcome_type, reported_at
--                                       (no jurisdiction_id)
--   invoice_request            012:87   organization_id, business_unit_id,
--                                       jurisdiction_id, created_at
--   payment_observation        012:235  organization_id, business_unit_id,
--                                       observed_at  (no jurisdiction_id)
--   contractor_payable         012:358  organization_id, business_unit_id,
--                                       payable_status, approved_at,
--                                       created_at   (no jurisdiction_id)
--   job_profitability_snapshot 012:428  organization_id, business_unit_id,
--                                       snapshot_taken_at
--                                       (no jurisdiction_id)
--
-- Wave 1–2 table column contracts independently verified against the live
-- Supabase project (2026-08-17):
--   public.service_request : id, organization_id, business_unit_id, created_at, requested_at
--   public.quote_response  : id, organization_id, business_unit_id, response_type, responded_at, created_at
-- Timestamp convention for sales.lead.created: service_request.created_at
--   (canonical ServiceOS lead-creation timestamp, consistent with KPI seed lineage).
-- Timestamp convention for sales.quote.accepted: quote_response.responded_at
--   (semantically the acceptance event; responded_at is set when the response is recorded).
-- Remaining Wave 1–2 tables (opportunity, quote, conversion_record) are absent from
-- wave6_canonical_event because no locked canonical event name currently requires them.
--
-- security_invoker = true so that the caller's RLS policies apply to every
-- underlying table (the view must never widen access).

CREATE VIEW public.wave6_canonical_event
WITH (security_invoker = true)
AS
  -- ops.job.created
  SELECT
    oj.organization_id                        AS organization_id,
    oj.business_unit_id                       AS business_unit_id,
    oj.jurisdiction_id                        AS jurisdiction_id,
    'ops.job.created'::text                   AS event_name,
    oj.created_at                             AS occurred_at,
    'operational_job'::text                   AS entity_type,
    oj.id                                     AS entity_id,
    'operational_job'::text                   AS source_table,
    oj.id                                     AS source_id
  FROM public.operational_job oj

  UNION ALL

  -- ops.work.completed
  SELECT
    wo.organization_id,
    wo.business_unit_id,
    wo.jurisdiction_id,
    'ops.work.completed'::text,
    wo.service_completed_at,
    'work_order'::text,
    wo.id,
    'work_order'::text,
    wo.id
  FROM public.work_order wo
  WHERE wo.work_order_status IN ('qa_complete', 'closed')

  UNION ALL

  -- quality.qa.passed
  SELECT
    qi.organization_id,
    qi.business_unit_id,
    NULL::uuid,
    'quality.qa.passed'::text,
    qi.inspected_at,
    'qa_inspection'::text,
    qi.id,
    'qa_inspection'::text,
    qi.id
  FROM public.qa_inspection qi
  WHERE qi.inspection_status = 'passed'

  UNION ALL

  -- quality.exception.opened
  SELECT
    se.organization_id,
    se.business_unit_id,
    NULL::uuid,
    'quality.exception.opened'::text,
    se.reported_at,
    'service_exception'::text,
    se.id,
    'service_exception'::text,
    se.id
  FROM public.service_exception se

  UNION ALL

  -- quality.outcome.reclean_requested
  SELECT
    co.organization_id,
    co.business_unit_id,
    NULL::uuid,
    'quality.outcome.reclean_requested'::text,
    co.reported_at,
    'customer_outcome'::text,
    co.id,
    'customer_outcome'::text,
    co.id
  FROM public.customer_outcome co
  WHERE co.outcome_type = 'reclean_request'

  UNION ALL

  -- finance.invoice.requested
  SELECT
    ir.organization_id,
    ir.business_unit_id,
    ir.jurisdiction_id,
    'finance.invoice.requested'::text,
    ir.created_at,
    'invoice_request'::text,
    ir.id,
    'invoice_request'::text,
    ir.id
  FROM public.invoice_request ir

  UNION ALL

  -- finance.payment.observed
  SELECT
    po.organization_id,
    po.business_unit_id,
    NULL::uuid,
    'finance.payment.observed'::text,
    po.observed_at,
    'payment_observation'::text,
    po.id,
    'payment_observation'::text,
    po.id
  FROM public.payment_observation po

  UNION ALL

  -- finance.payable.approved
  SELECT
    cp.organization_id,
    cp.business_unit_id,
    NULL::uuid,
    'finance.payable.approved'::text,
    cp.approved_at,
    'contractor_payable'::text,
    cp.id,
    'contractor_payable'::text,
    cp.id
  FROM public.contractor_payable cp
  WHERE cp.payable_status = 'approved'

  UNION ALL

  -- finance.profitability.captured
  SELECT
    jps.organization_id,
    jps.business_unit_id,
    NULL::uuid,
    'finance.profitability.captured'::text,
    jps.snapshot_taken_at,
    'job_profitability_snapshot'::text,
    jps.id,
    'job_profitability_snapshot'::text,
    jps.id
  FROM public.job_profitability_snapshot jps

  UNION ALL

  -- sales.lead.created
  -- Source: service_request (independently verified 2026-08-17).
  -- Timestamp: created_at — canonical ServiceOS lead creation timestamp.
  SELECT
    sr.organization_id,
    sr.business_unit_id,
    NULL::uuid,
    'sales.lead.created'::text,
    sr.created_at,
    'service_request'::text,
    sr.id,
    'service_request'::text,
    sr.id
  FROM public.service_request sr

  UNION ALL

  -- sales.quote.accepted
  -- Source: quote_response where response_type = 'accepted' (verified 2026-08-17).
  -- Timestamp: responded_at — the point in time the acceptance was recorded.
  SELECT
    qr.organization_id,
    qr.business_unit_id,
    NULL::uuid,
    'sales.quote.accepted'::text,
    qr.responded_at,
    'quote_response'::text,
    qr.id,
    'quote_response'::text,
    qr.id
  FROM public.quote_response qr
  WHERE qr.response_type = 'accepted';

-- Explicit re-assertion (idempotent) in case the CREATE VIEW option list is
-- ignored by an older planner version.
ALTER VIEW public.wave6_canonical_event SET (security_invoker = true);

COMMENT ON VIEW public.wave6_canonical_event IS
  'Wave 6: Read-only canonical event spine. '
  'Covers Wave 3/4/5 tables (migrations 007, 009, 012) plus independently verified '
  'Wave 1-2 tables service_request (sales.lead.created) and quote_response (sales.quote.accepted). '
  'Opportunity, quote, and conversion_record remain absent because no locked canonical event name '
  'currently requires them, not because their live schemas are unknown. '
  'security_invoker = true — caller RLS applies. SOURCE ONLY — not executed.';

-- ---------------------------------------------------------------------------
-- SECTION 4: ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.kpi_definition          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_snapshot            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_review       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_control_record   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependency_edge         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuity_session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuity_transaction  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_module_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_gate            ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SECTION 5: REVOKE (fail-closed baseline)
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.kpi_definition          FROM PUBLIC;
REVOKE ALL ON public.kpi_snapshot            FROM PUBLIC;
REVOKE ALL ON public.management_review       FROM PUBLIC;
REVOKE ALL ON public.change_control_record   FROM PUBLIC;
REVOKE ALL ON public.dependency_edge         FROM PUBLIC;
REVOKE ALL ON public.continuity_session      FROM PUBLIC;
REVOKE ALL ON public.continuity_transaction  FROM PUBLIC;
REVOKE ALL ON public.service_module_profile  FROM PUBLIC;
REVOKE ALL ON public.release_gate            FROM PUBLIC;

REVOKE ALL ON public.kpi_definition          FROM anon;
REVOKE ALL ON public.kpi_snapshot            FROM anon;
REVOKE ALL ON public.management_review       FROM anon;
REVOKE ALL ON public.change_control_record   FROM anon;
REVOKE ALL ON public.dependency_edge         FROM anon;
REVOKE ALL ON public.continuity_session      FROM anon;
REVOKE ALL ON public.continuity_transaction  FROM anon;
REVOKE ALL ON public.service_module_profile  FROM anon;
REVOKE ALL ON public.release_gate            FROM anon;

REVOKE ALL ON public.kpi_definition          FROM authenticated;
REVOKE ALL ON public.kpi_snapshot            FROM authenticated;
REVOKE ALL ON public.management_review       FROM authenticated;
REVOKE ALL ON public.change_control_record   FROM authenticated;
REVOKE ALL ON public.dependency_edge         FROM authenticated;
REVOKE ALL ON public.continuity_session      FROM authenticated;
REVOKE ALL ON public.continuity_transaction  FROM authenticated;
REVOKE ALL ON public.service_module_profile  FROM authenticated;
REVOKE ALL ON public.release_gate            FROM authenticated;

REVOKE ALL ON public.wave6_canonical_event   FROM PUBLIC;
REVOKE ALL ON public.wave6_canonical_event   FROM anon;
REVOKE ALL ON public.wave6_canonical_event   FROM authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 6: GRANTS to authenticated (least privilege)
-- ---------------------------------------------------------------------------

-- Reference / governance-controlled catalogs: read-only for the app role.
GRANT SELECT                 ON public.kpi_definition          TO authenticated;
GRANT SELECT                 ON public.dependency_edge         TO authenticated;
GRANT SELECT                 ON public.service_module_profile  TO authenticated;
GRANT SELECT                 ON public.release_gate            TO authenticated;

-- Append-only evidence: SELECT + INSERT only. No UPDATE. No DELETE.
GRANT SELECT, INSERT         ON public.kpi_snapshot            TO authenticated;
REVOKE UPDATE, DELETE        ON public.kpi_snapshot            FROM authenticated;

-- Operable governance / continuity records.
GRANT SELECT, INSERT, UPDATE ON public.management_review       TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.change_control_record   TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.continuity_session      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.continuity_transaction  TO authenticated;

-- Canonical event spine is read-only.
GRANT SELECT                 ON public.wave6_canonical_event   TO authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 7: RLS POLICIES
-- ---------------------------------------------------------------------------

-- kpi_definition (global rows readable; org rows require org role)
CREATE POLICY pol_kd_owner_admin_select ON public.kpi_definition
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['owner_admin'])
  );

CREATE POLICY pol_kd_office_ops_select ON public.kpi_definition
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['office_ops'])
  );

-- kpi_snapshot (append-only evidence)
CREATE POLICY pol_ks_owner_admin_select ON public.kpi_snapshot
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ks_owner_admin_insert ON public.kpi_snapshot
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ks_office_ops_select ON public.kpi_snapshot
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_ks_office_ops_insert ON public.kpi_snapshot
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- management_review
CREATE POLICY pol_mr_owner_admin_all ON public.management_review
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_mr_office_ops_select ON public.management_review
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- change_control_record
CREATE POLICY pol_ccr_owner_admin_all ON public.change_control_record
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ccr_office_ops_select ON public.change_control_record
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- dependency_edge (global knowledge graph)
CREATE POLICY pol_de_owner_admin_select ON public.dependency_edge
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['owner_admin'])
  );

CREATE POLICY pol_de_office_ops_select ON public.dependency_edge
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['office_ops'])
  );

-- continuity_session
CREATE POLICY pol_cs_owner_admin_all ON public.continuity_session
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_cs_office_ops_select ON public.continuity_session
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- continuity_transaction
CREATE POLICY pol_ct_owner_admin_all ON public.continuity_transaction
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ct_office_ops_select ON public.continuity_transaction
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_ct_office_ops_insert ON public.continuity_transaction
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- service_module_profile (global configuration)
CREATE POLICY pol_smp_owner_admin_select ON public.service_module_profile
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['owner_admin'])
  );

CREATE POLICY pol_smp_office_ops_select ON public.service_module_profile
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['office_ops'])
  );

-- release_gate (global release sequencing)
CREATE POLICY pol_rg_owner_admin_select ON public.release_gate
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['owner_admin'])
  );

CREATE POLICY pol_rg_office_ops_select ON public.release_gate
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR public.has_org_role(organization_id, ARRAY['office_ops'])
  );

-- ---------------------------------------------------------------------------
-- SECTION 8: CROSS-WAVE GRANT HARDENING
-- ---------------------------------------------------------------------------
-- Removes privilege bits the application never uses (TRUNCATE / REFERENCES /
-- TRIGGER) from the authenticated role on canonical Wave 2–5 tables.
-- This changes NO data, NO RLS policy, and NO column definition.
-- Guarded so that an absent table cannot abort the migration.

DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT t FROM unnest(ARRAY[
      'service_request',
      'opportunity',
      'estimate',
      'pricing_snapshot',
      'quote',
      'quote_version',
      'quote_response',
      'conversion_record',
      'job_handoff',
      'operational_job',
      'schedule_window',
      'worker_assignment',
      'work_order',
      'work_order_event',
      'service_checklist_result',
      'qa_inspection',
      'completion_evidence',
      'corrective_action',
      'required_evidence_policy',
      'work_order_wave4_applicability',
      'work_order_governance_link',
      'work_order_evidence_requirement',
      'service_exception',
      'customer_outcome',
      'operational_handoff'
    ]) t
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      EXECUTE format(
        'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 9: FUNCTION EXECUTE HARDENING
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.current_worker_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_worker_id(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_worker_id(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_worker_id(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.worker_has_active_assignment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.worker_has_active_assignment(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.worker_has_active_assignment(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.worker_has_active_assignment(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- SECTION 10: GOVERNED KPI DEFINITION SEEDS
-- ---------------------------------------------------------------------------
-- Provenance note: the six `sales.*` KPIs below are sourced from Wave 1-2
-- tables (service_request, opportunity, quote, quote_response,
-- conversion_record). Their live schemas and governed business-event timestamps
-- have been independently verified even though their DDL is not vendored in
-- this repository. service_request and quote_response are represented in
-- public.wave6_canonical_event because locked canonical event names require
-- them; opportunity, quote, and conversion_record remain direct KPI sources
-- because no locked canonical event name currently requires them.

INSERT INTO public.kpi_definition
  (code, name, domain, description, unit, aggregation_type, period_support,
   source_lineage, formula_code, definition_version, active)
VALUES
  ('sales.leads_created', 'Leads Created', 'sales',
   'Count of canonical service requests created in period. Live service_request schema independently verified.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["service_request"],"timestamp_columns":{"service_request":"created_at"},"filters":{"service_request":null},"wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":"sales.lead.created","in_canonical_event_view":true}'::jsonb,
   'count(service_request)', '1', true),

  ('sales.opportunities_created', 'Opportunities Created', 'sales',
   'Count of opportunities created in period. Live opportunity schema independently verified.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["opportunity"],"timestamp_columns":{"opportunity":"created_at"},"filters":{"opportunity":null},"wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":null,"in_canonical_event_view":false}'::jsonb,
   'count(opportunity)', '1', true),

  ('sales.quotes_created', 'Quotes Created', 'sales',
   'Count of quotes created in period. Live quote schema independently verified.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["quote"],"timestamp_columns":{"quote":"created_at"},"filters":{"quote":null},"wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":null,"in_canonical_event_view":false}'::jsonb,
   'count(quote)', '1', true),

  ('sales.quotes_accepted', 'Quotes Accepted', 'sales',
   'Count of quote responses with response_type = accepted. Live quote_response schema independently verified.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["quote_response"],"timestamp_columns":{"quote_response":"responded_at"},"filters":{"quote_response":"response_type=accepted"},"wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":"sales.quote.accepted","in_canonical_event_view":true}'::jsonb,
   'count(quote_response where response_type=accepted)', '1', true),

  ('sales.conversions', 'Conversions', 'sales',
   'Count of conversion records converted in period. Live conversion_record schema independently verified.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["conversion_record"],"timestamp_columns":{"conversion_record":"converted_at"},"filters":{"conversion_record":null},"wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":null,"in_canonical_event_view":false}'::jsonb,
   'count(conversion_record)', '1', true),

  ('sales.lead_to_conversion_rate', 'Lead to Conversion Rate', 'sales',
   'Conversions divided by leads created. NULL when no leads exist. Live conversion_record and service_request schemas independently verified.', 'ratio', 'rate',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["conversion_record","service_request"],"timestamp_columns":{"conversion_record":"converted_at","service_request":"created_at"},"filters":{"conversion_record":null,"service_request":null},"numerator":"sales.conversions","denominator":"sales.leads_created","wave":"1-2","schema_verification":"independently_verified_live","canonical_event_name":null,"in_canonical_event_view":false}'::jsonb,
   'sales.conversions / sales.leads_created', '1', true),

  ('operations.jobs_created', 'Jobs Created', 'operations',
   'Count of operational jobs created in period.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["operational_job"],"filter":null,"timestamp":"created_at"}'::jsonb,
   'count(operational_job)', '1', true),

  ('operations.work_completed', 'Work Completed', 'operations',
   'Count of work orders in qa_complete or closed status.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["work_order"],"filter":"work_order_status in (qa_complete,closed)","timestamp":"service_completed_at"}'::jsonb,
   'count(work_order where work_order_status in (qa_complete,closed))', '1', true),

  ('quality.qa_inspections', 'QA Inspections', 'quality',
   'Count of QA inspections recorded in period.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["qa_inspection"],"filter":null,"timestamp":"created_at"}'::jsonb,
   'count(qa_inspection)', '1', true),

  ('quality.qa_pass_rate', 'QA Pass Rate', 'quality',
   'Passed inspections divided by adjudicated inspections. NULL when none adjudicated.', 'ratio', 'rate',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["qa_inspection"],"timestamp_columns":{"qa_inspection":"inspected_at"},"filters":{"qa_inspection":"inspection_status in (passed,failed)"},"numerator":"inspection_status=passed","denominator":"inspection_status in (passed,failed)"}'::jsonb,
   'count(passed) / count(passed+failed)', '1', true),

  ('quality.exceptions_opened', 'Exceptions Opened', 'quality',
   'Count of service exceptions reported in period.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["service_exception"],"filter":null,"timestamp":"reported_at"}'::jsonb,
   'count(service_exception)', '1', true),

  ('quality.reclean_requests', 'Reclean Requests', 'quality',
   'Count of customer outcomes with outcome_type = reclean_request.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["customer_outcome"],"filter":"outcome_type=reclean_request","timestamp":"reported_at"}'::jsonb,
   'count(customer_outcome where outcome_type=reclean_request)', '1', true),

  ('finance.invoice_subtotal_requested', 'Invoice Subtotal Requested', 'finance',
   'Sum of invoice_request.subtotal_amount in period.', 'currency', 'sum',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["invoice_request"],"field":"subtotal_amount","timestamp":"created_at"}'::jsonb,
   'sum(invoice_request.subtotal_amount)', '1', true),

  ('finance.payments_observed', 'Payments Observed', 'finance',
   'Sum of payment_observation.amount_observed in period.', 'currency', 'sum',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["payment_observation"],"field":"amount_observed","timestamp":"observed_at"}'::jsonb,
   'sum(payment_observation.amount_observed)', '1', true),

  ('finance.contractor_payable_approved', 'Contractor Payable Approved', 'finance',
   'Sum of approved contractor payable amounts in period.', 'currency', 'sum',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["contractor_payable"],"field":"computed_amount","filter":"payable_status=approved","timestamp":"approved_at"}'::jsonb,
   'sum(contractor_payable.computed_amount where payable_status=approved)', '1', true),

  ('finance.recognized_revenue', 'Recognized Revenue', 'finance',
   'Sum of job_profitability_snapshot.recognized_revenue_amount in period.', 'currency', 'sum',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["job_profitability_snapshot"],"field":"recognized_revenue_amount","timestamp":"snapshot_taken_at"}'::jsonb,
   'sum(job_profitability_snapshot.recognized_revenue_amount)', '1', true),

  ('finance.gross_contribution', 'Gross Contribution', 'finance',
   'Sum of job_profitability_snapshot.gross_contribution in period.', 'currency', 'sum',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["job_profitability_snapshot"],"field":"gross_contribution","timestamp":"snapshot_taken_at"}'::jsonb,
   'sum(job_profitability_snapshot.gross_contribution)', '1', true),

  ('finance.gross_margin', 'Gross Margin', 'finance',
   'Weighted gross margin: sum(gross_contribution) / sum(recognized_revenue_amount). NULL when revenue is zero.',
   'ratio', 'weighted_average',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["job_profitability_snapshot"],"timestamp_columns":{"job_profitability_snapshot":"snapshot_taken_at"},"filters":{"job_profitability_snapshot":null},"numerator":"gross_contribution","denominator":"recognized_revenue_amount"}'::jsonb,
   'sum(gross_contribution) / sum(recognized_revenue_amount)', '1', true)
ON CONFLICT (code, definition_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SECTION 11: HEMS DEPENDENCY KNOWLEDGE GRAPH SEEDS (KG-001 .. KG-007)
-- ---------------------------------------------------------------------------

INSERT INTO public.dependency_edge (kg_id, from_node, to_node, edge_type, control_rule)
VALUES
  -- KG-001 Residential Service Definition chain
  ('KG-001', 'ResidentialServiceDefinition', 'Pricing',        'defines_scope', 'Scope change requires pricing re-derivation'),
  ('KG-001', 'Pricing',                      'Estimator',      'inputs_to',     'Estimator must use governed pricing version'),
  ('KG-001', 'Estimator',                    'Quote',          'produces',      'Quote must reference pricing snapshot'),
  ('KG-001', 'Quote',                        'WorkOrder',      'authorizes',    'Only accepted quotes authorize work'),
  ('KG-001', 'WorkOrder',                    'Checklist',      'generates',     'Checklist derives from work order scope'),
  ('KG-001', 'Checklist',                    'QA',             'governs',       'QA evaluates checklist completion'),
  ('KG-001', 'QA',                           'QB',             'feeds',         'QA outcome feeds quality board'),
  ('KG-001', 'QB',                           'KPI',            'measures',      'Quality board rolls up to governed KPIs'),

  -- KG-002 Pricing to Profitability chain
  ('KG-002', 'Pricing',                'PricingSnapshot',   'freezes',      'Pricing snapshot is immutable evidence'),
  ('KG-002', 'PricingSnapshot',        'QuoteVersion',      'binds',        'Quote version binds a pricing snapshot'),
  ('KG-002', 'QuoteVersion',           'InvoiceRequest',    'authorizes',   'Invoice must reproduce accepted amounts'),
  ('KG-002', 'InvoiceRequest',         'PaymentObservation','settles',      'Payments observed against invoice'),
  ('KG-002', 'ContractorPayable',      'JobProfitability',  'reduces',      'Approved payables are direct labor cost'),
  ('KG-002', 'InvoiceRequest',         'JobProfitability',  'revenue_basis','Revenue basis is accepted subtotal'),
  ('KG-002', 'JobProfitability',       'KPI',               'measures',     'Margin KPIs derive from profitability snapshots'),

  -- KG-003 SOP / Quality chain
  ('KG-003', 'SOP',                 'Checklist',        'specifies',   'Checklist templates derive from SOP version'),
  ('KG-003', 'Checklist',           'EvidenceRequirement','requires',  'Evidence policy derives from checklist'),
  ('KG-003', 'EvidenceRequirement', 'CompletionEvidence','validates',  'Completion evidence satisfies requirement'),
  ('KG-003', 'CompletionEvidence',  'QA',               'supports',    'QA reviews captured evidence'),
  ('KG-003', 'QA',                  'CorrectiveAction', 'triggers',    'Failed QA opens corrective action'),
  ('KG-003', 'CorrectiveAction',    'Training',         'informs',     'Recurring failures require retraining'),
  ('KG-003', 'Training',            'SOP',              'updates',     'Training outcomes feed SOP revision'),

  -- KG-004 Lead to Conversion chain
  ('KG-004', 'ServiceRequest',   'Opportunity',      'qualifies',  'Lead qualification creates opportunity'),
  ('KG-004', 'Opportunity',      'Estimate',         'scopes',     'Estimate scoped from opportunity'),
  ('KG-004', 'Estimate',         'Quote',            'produces',   'Quote issued from estimate'),
  ('KG-004', 'Quote',            'QuoteResponse',    'awaits',     'Customer response recorded canonically'),
  ('KG-004', 'QuoteResponse',    'ConversionRecord', 'converts',   'Accepted response creates conversion'),
  ('KG-004', 'ConversionRecord', 'JobHandoff',       'hands_off',  'Conversion hands off to operations'),

  -- KG-005 Worker to Performance chain
  ('KG-005', 'Worker',              'WorkerAssignment',   'assigned_to', 'Assignment binds worker to job'),
  ('KG-005', 'WorkerAssignment',    'WorkOrderEvent',     'emits',       'Field events are append-only'),
  ('KG-005', 'WorkOrderEvent',      'CompletionEvidence', 'captures',    'Evidence captured during execution'),
  ('KG-005', 'CompletionEvidence',  'QA',                 'submits_to',  'QA gate consumes evidence'),
  ('KG-005', 'QA',                  'ContractorPayable',  'gates',       'Payable eligibility requires QA closure'),
  ('KG-005', 'ContractorPayable',   'WorkerPerformance',  'scores',      'Payable and QA feed performance view'),
  ('KG-005', 'WorkerPerformance',   'KPI',                'measures',    'Performance rolls into governed KPIs'),

  -- KG-006 HEMS Change chain
  ('KG-006', 'KPI',                'ManagementReview',   'reviewed_in', 'KPIs are reviewed on a governed cadence'),
  ('KG-006', 'ManagementReview',   'ChangeControlRecord','opens',       'Exceptions open change control'),
  ('KG-006', 'ChangeControlRecord','ImpactAssessment',   'requires',    'Material change requires impact assessment'),
  ('KG-006', 'ImpactAssessment',   'DependencyEdge',     'traverses',   'Impact traversal uses the dependency graph'),
  ('KG-006', 'DependencyEdge',     'ReleaseGate',        'informs',     'Affected dependencies gate the release'),
  ('KG-006', 'ReleaseGate',        'SOP',                'publishes',   'Passed gate publishes updated SOP/model'),

  -- KG-007 Continuity / DR chain
  ('KG-007', 'ContinuitySession',     'MasterSheet',           'activates',   'Fallback activates governed master sheet'),
  ('KG-007', 'MasterSheet',           'ContinuityTransaction', 'records',     'Offline work recorded with correlation id'),
  ('KG-007', 'ContinuityTransaction', 'Reconciliation',        'requires',    'Every offline record must be reconciled'),
  ('KG-007', 'Reconciliation',        'ServiceOSEntity',       'materializes','Matched records materialize canonical rows'),
  ('KG-007', 'ServiceOSEntity',       'KPI',                   'restores',    'Reconciled data restores KPI integrity'),
  ('KG-007', 'Reconciliation',        'ManagementReview',      'reports_to',  'Discrepancies and waivers are reviewed')
ON CONFLICT (kg_id, from_node, to_node) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SECTION 12: SERVICE MODULE PROFILE SEEDS
-- ---------------------------------------------------------------------------

INSERT INTO public.service_module_profile
  (profile_code, profile_name, jurisdiction, currency, timezone, configuration, active, profile_version)
VALUES
  ('RESIDENTIAL_ON', 'Residential — Ontario', 'CA-ON', 'CAD', 'America/Toronto',
   '{"service_families":["residential"],"tax_name":"HST","default_period_type":"MONTHLY"}'::jsonb,
   true, 1),
  ('COMMERCIAL_ON', 'Commercial — Ontario', 'CA-ON', 'CAD', 'America/Toronto',
   '{"service_families":["commercial"],"tax_name":"HST","default_period_type":"MONTHLY"}'::jsonb,
   true, 1),
  ('VACATION_RENTAL_AZ', 'Vacation Rental — Arizona', 'US-AZ', 'USD', 'America/Phoenix',
   '{"service_families":["vacation_rental"],"tax_name":"TPT","default_period_type":"MONTHLY"}'::jsonb,
   true, 1)
ON CONFLICT (profile_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SECTION 13: RELEASE GATE SEEDS
-- ---------------------------------------------------------------------------

INSERT INTO public.release_gate
  (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
VALUES
  ('PILOT',             'Pilot',             'pending', 1, '{"required":["wave6_migration_source","test_suite_pass"]}'::jsonb),
  ('ACCEPTANCE',        'Acceptance',        'pending', 2, '{"required":["kpi_snapshot_evidence","management_review_closed"]}'::jsonb),
  ('CUTOVER',           'Cutover',           'pending', 3, '{"required":["acceptance_passed","continuity_plan_verified"]}'::jsonb),
  ('LEGACY_RETIREMENT', 'Legacy Retirement', 'pending', 4, '{"required":["cutover_passed","legacy_data_retained"]}'::jsonb),
  ('SCALE',             'Scale',             'pending', 5, '{"required":["legacy_retirement_passed","module_profiles_active"]}'::jsonb)
ON CONFLICT (gate_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SECTION 14: SELF-VALIDATION (fail-fast — blocks COMMIT on any failure)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
  v_table text;
BEGIN

  -- [SV-1] All 9 Wave 6 tables exist
  v_count := 0;
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'kpi_definition', 'kpi_snapshot', 'management_review',
      'change_control_record', 'dependency_edge', 'continuity_session',
      'continuity_transaction', 'service_module_profile', 'release_gate'
    );
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'M014 SV-1 FAIL: expected 9 Wave 6 tables, found %', v_count;
  END IF;

  -- [SV-2] RLS enabled on all 9 Wave 6 tables
  FOR v_table IN
    SELECT t FROM unnest(ARRAY[
      'kpi_definition', 'kpi_snapshot', 'management_review',
      'change_control_record', 'dependency_edge', 'continuity_session',
      'continuity_transaction', 'service_module_profile', 'release_gate'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = v_table
      AND c.relrowsecurity = true;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M014 SV-2 FAIL: RLS not enabled on public.%', v_table;
    END IF;
  END LOOP;

  -- [SV-3] anon holds no privilege on any Wave 6 table
  FOR v_table IN
    SELECT t FROM unnest(ARRAY[
      'kpi_definition', 'kpi_snapshot', 'management_review',
      'change_control_record', 'dependency_edge', 'continuity_session',
      'continuity_transaction', 'service_module_profile', 'release_gate'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = v_table
      AND grantee = 'anon';
    IF v_count > 0 THEN
      RAISE EXCEPTION 'M014 SV-3 FAIL: anon has privileges on public.%', v_table;
    END IF;
  END LOOP;

  -- [SV-4] kpi_snapshot is append-only for authenticated (no UPDATE/DELETE)
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'kpi_snapshot'
    AND grantee = 'authenticated'
    AND privilege_type IN ('UPDATE', 'DELETE');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M014 SV-4 FAIL: kpi_snapshot is not append-only for authenticated';
  END IF;

  -- [SV-5] duplicate-capture prevention index exists
  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'kpi_snapshot'
    AND indexname = 'uq_ks_period_scope';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-5 FAIL: uq_ks_period_scope unique index not found';
  END IF;

  -- [SV-6] canonical event view exists and is security_invoker
  SELECT COUNT(*) INTO v_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name = 'wave6_canonical_event';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-6 FAIL: view public.wave6_canonical_event not found';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'wave6_canonical_event'
    AND c.reloptions IS NOT NULL
    AND array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-6 FAIL: wave6_canonical_event is not security_invoker';
  END IF;

  -- [SV-7] governed KPI definition seeds — exact 18 required codes, individually verified
  DECLARE
    v_required_kpi_code text;
  BEGIN
    FOR v_required_kpi_code IN SELECT unnest(ARRAY[
      'sales.leads_created',
      'sales.opportunities_created',
      'sales.quotes_created',
      'sales.quotes_accepted',
      'sales.conversions',
      'sales.lead_to_conversion_rate',
      'operations.jobs_created',
      'operations.work_completed',
      'quality.qa_inspections',
      'quality.qa_pass_rate',
      'quality.exceptions_opened',
      'quality.reclean_requests',
      'finance.invoice_subtotal_requested',
      'finance.payments_observed',
      'finance.contractor_payable_approved',
      'finance.recognized_revenue',
      'finance.gross_contribution',
      'finance.gross_margin'
    ])
    LOOP
      SELECT COUNT(*) INTO v_count
      FROM public.kpi_definition
      WHERE code = v_required_kpi_code AND active = true AND definition_version = '1';
      IF v_count = 0 THEN
        RAISE EXCEPTION 'M014 SV-7 FAIL: required KPI code % (active, version=1) is missing',
          v_required_kpi_code;
      END IF;
    END LOOP;
  END;

  -- Exact active KPI count: must be exactly 18 (future additions require a new version).
  SELECT COUNT(*) INTO v_count FROM public.kpi_definition WHERE active = true AND definition_version = '1';
  IF v_count <> 18 THEN
    RAISE EXCEPTION 'M014 SV-7 FAIL: expected exactly 18 active version-1 kpi_definition rows, found %', v_count;
  END IF;

  -- [SV-8] HEMS dependency graph seeds
  SELECT COUNT(*) INTO v_count FROM public.dependency_edge;
  IF v_count < 35 THEN
    RAISE EXCEPTION 'M014 SV-8 FAIL: expected >= 35 dependency_edge rows, found %', v_count;
  END IF;

  SELECT COUNT(DISTINCT kg_id) INTO v_count FROM public.dependency_edge;
  IF v_count < 7 THEN
    RAISE EXCEPTION 'M014 SV-8 FAIL: expected 7 KG chains, found %', v_count;
  END IF;

  -- [SV-9] service module profile seeds
  SELECT COUNT(*) INTO v_count FROM public.service_module_profile;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'M014 SV-9 FAIL: expected 3 service_module_profile rows, found %', v_count;
  END IF;

  -- [SV-10] release gate seeds
  SELECT COUNT(*) INTO v_count FROM public.release_gate;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'M014 SV-10 FAIL: expected 5 release_gate rows, found %', v_count;
  END IF;

  -- [SV-11] continuity_transaction idempotency constraint exists
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint
  WHERE conname = 'uq_ct_session_correlation';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-11 FAIL: uq_ct_session_correlation constraint not found';
  END IF;

  -- [SV-12] material change closure evidence constraint exists
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint
  WHERE conname = 'ck_ccr_material_close_evidence';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-12 FAIL: ck_ccr_material_close_evidence constraint not found';
  END IF;

  -- [SV-13] continuity closure constraint exists
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint
  WHERE conname = 'ck_cs_close_requires_reconciliation';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-13 FAIL: ck_cs_close_requires_reconciliation constraint not found';
  END IF;

  -- [SV-14] at least one RLS policy per Wave 6 table
  FOR v_table IN
    SELECT t FROM unnest(ARRAY[
      'kpi_definition', 'kpi_snapshot', 'management_review',
      'change_control_record', 'dependency_edge', 'continuity_session',
      'continuity_transaction', 'service_module_profile', 'release_gate'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_table;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M014 SV-14 FAIL: no RLS policy found on public.%', v_table;
    END IF;
  END LOOP;

  -- [SV-15] no huc_* object was touched by this migration
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name LIKE 'huc\_%'
    AND table_name IN (
      'kpi_definition', 'kpi_snapshot', 'management_review',
      'change_control_record', 'dependency_edge', 'continuity_session',
      'continuity_transaction', 'service_module_profile', 'release_gate'
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M014 SV-15 FAIL: Wave 6 namespace collides with a huc_* table';
  END IF;

  -- [SV-16] governance trigger functions exist
  --         (trg_wave6_mr_governance replaces former trg_enforce_management_review_fsm
  --          + trg_wave6_stamp_management_review_update)
  DECLARE
    v_required_fn text;
  BEGIN
    FOR v_required_fn IN SELECT unnest(ARRAY[
      'trg_wave6_mr_governance',
      'trg_enforce_ccr_fsm',
      'trg_validate_ccr_dependency_impact',
      'trg_enforce_continuity_fsm',
      'trg_enforce_release_gate_sequence',
      'trg_set_continuity_payload_hash',
      'trg_immute_continuity_transaction_fields',
      'trg_wave6_stamp_kpi_snapshot_insert',
      'trg_wave6_guard_management_review_insert',
      'trg_wave6_guard_ccr_insert',
      'trg_wave6_stamp_ccr_update',
      'trg_wave6_guard_continuity_session_insert',
      'trg_wave6_stamp_continuity_session_update',
      'trg_wave6_guard_continuity_transaction_insert',
      'trg_wave6_enforce_continuity_transaction_fsm',
      'trg_wave6_validate_kpi_snapshot_scope',
      'trg_wave6_validate_management_review_manifest',
      'trg_wave6_validate_ccr_kpi_manifest'
    ])
    LOOP
      SELECT COUNT(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_required_fn;
      IF v_count = 0 THEN
        RAISE EXCEPTION 'M014 SV-16 FAIL: governance trigger function public.% not found',
          v_required_fn;
      END IF;
    END LOOP;
  END;

  -- [SV-17] Trigger order safety: deprecated per-concern triggers must not exist on
  --         management_review.  Only trig_wave6_mr_governance should handle BEFORE UPDATE.
  DECLARE
    v_bad_trig text;
  BEGIN
    FOR v_bad_trig IN
      SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'management_review'
        AND t.tgname IN ('trig_management_review_fsm', 'trig_wave6_mr_update_stamp')
        AND NOT t.tgisinternal
    LOOP
      RAISE EXCEPTION
        'M014 SV-17 FAIL: deprecated trigger % found on management_review — '
        'combined trig_wave6_mr_governance must be the sole BEFORE UPDATE governance trigger',
        v_bad_trig;
    END LOOP;

    SELECT COUNT(*) INTO v_count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'management_review'
      AND t.tgname = 'trig_wave6_mr_governance'
      AND NOT t.tgisinternal;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M014 SV-17 FAIL: trig_wave6_mr_governance not found on management_review';
    END IF;
  END;

  -- [SV-18] All internal SECURITY DEFINER trigger functions must not
  --         be directly executable by PUBLIC, anon, or authenticated.
  DECLARE
    v_fn_name   text;
    v_has_exec  boolean;
  BEGIN
    FOR v_fn_name IN SELECT unnest(ARRAY[
      'trg_wave6_mr_governance',
      'trg_enforce_ccr_fsm',
      'trg_validate_ccr_dependency_impact',
      'trg_enforce_continuity_fsm',
      'trg_enforce_release_gate_sequence',
      'trg_set_continuity_payload_hash',
      'trg_immute_continuity_transaction_fields',
      'trg_wave6_stamp_kpi_snapshot_insert',
      'trg_wave6_guard_management_review_insert',
      'trg_wave6_guard_ccr_insert',
      'trg_wave6_stamp_ccr_update',
      'trg_wave6_guard_continuity_session_insert',
      'trg_wave6_stamp_continuity_session_update',
      'trg_wave6_guard_continuity_transaction_insert',
      'trg_wave6_enforce_continuity_transaction_fsm',
      'trg_wave6_validate_kpi_snapshot_scope',
      'trg_wave6_validate_management_review_manifest',
      'trg_wave6_validate_ccr_kpi_manifest'
    ])
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(COALESCE(p.proacl, ARRAY[]::aclitem[])) AS acl(entry)
        WHERE n.nspname = 'public'
          AND p.proname = v_fn_name
          AND (
            acl.entry::text LIKE '%anon%=%X%'
            OR acl.entry::text LIKE '%authenticated%=%X%'
            OR acl.entry::text LIKE '=%X%'
          )
      ) INTO v_has_exec;
      IF v_has_exec THEN
        RAISE EXCEPTION
          'M014 SV-18 FAIL: EXECUTE on internal trigger function public.% '
          'is accessible to PUBLIC/anon/authenticated',
          v_fn_name;
      END IF;
    END LOOP;
  END;

  -- [SV-16b] payload_hash column exists on continuity_transaction and is NOT NULL
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'continuity_transaction'
    AND column_name = 'payload_hash';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-16 FAIL: payload_hash column missing from continuity_transaction';
  END IF;
  -- Verify NOT NULL constraint
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'continuity_transaction'
    AND column_name = 'payload_hash'
    AND is_nullable = 'NO';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-16 FAIL: payload_hash must be NOT NULL on continuity_transaction';
  END IF;

  -- [SV-16c] immutability trigger for continuity_transaction exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'trg_immute_continuity_transaction_fields';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M014 SV-16 FAIL: trg_immute_continuity_transaction_fields trigger function not found';
  END IF;

  -- [SV-16d] extensions.digest is available (pgcrypto in schema extensions)
  BEGIN
    PERFORM extensions.digest('probe'::text, 'sha256');
  EXCEPTION
    WHEN undefined_function THEN
      RAISE EXCEPTION
        'M014 SV-16 FAIL: extensions.digest not available — pgcrypto must be installed '
        'in schema extensions before applying this migration';
  END;

  RAISE NOTICE 'M014_WAVE6_INTELLIGENCE_PASS';
END;
$$;

-- Final deterministic result
SELECT 'M014_WAVE6_INTELLIGENCE_PASS'::text AS result;

COMMIT;
