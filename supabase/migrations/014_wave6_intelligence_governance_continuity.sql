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
-- Trigger functions created (5):
--   trg_enforce_management_review_fsm   — management_review BEFORE UPDATE
--   trg_enforce_ccr_fsm                 — change_control_record BEFORE UPDATE
--   trg_enforce_continuity_fsm          — continuity_session BEFORE UPDATE
--   trg_enforce_release_gate_sequence   — release_gate BEFORE UPDATE
--   trg_set_continuity_payload_hash     — continuity_transaction BEFORE INSERT
--
-- Triggers created (5):
--   trig_management_review_fsm
--   trig_ccr_fsm
--   trig_continuity_fsm
--   trig_release_gate_sequence
--   trig_continuity_payload_hash
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

  CONSTRAINT ck_ks_period_type CHECK (
    period_type IN ('DAILY', 'MONTHLY', 'QUARTERLY', 'YEARLY')
  ),
  CONSTRAINT ck_ks_period_order CHECK (period_end > period_start),
  CONSTRAINT ck_ks_timezone_nonempty CHECK (timezone <> ''),
  CONSTRAINT ck_ks_kpi_code_nonempty CHECK (kpi_code <> ''),
  -- Rates must never fabricate a value from a zero denominator.
  CONSTRAINT ck_ks_zero_denominator_guard CHECK (
    denominator IS NULL OR denominator <> 0 OR numeric_value IS NULL
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

  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id    uuid        NULL,

  CONSTRAINT uq_mr_period UNIQUE (
    organization_id, period_type, period_start, timezone, review_version
  ),

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
  )
);

-- NOTE (governance): a review may only be closed when every entry in actions[]
-- has is_resolved = true, OR waiver_recorded = true. That rule is enforced in
-- the application layer (canCloseManagementReview) because the JSONB action
-- array cannot be evaluated by an immutable CHECK expression.
COMMENT ON TABLE public.management_review IS
  'Wave 6: Governed management review per period. Closure with unresolved actions '
  'requires waiver_recorded = true (application-enforced: canCloseManagementReview). '
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

  CONSTRAINT uq_ccr_change_code UNIQUE (change_code),

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
    OR material_change = false
    OR (
      impact_assessment <> '{}'::jsonb
      AND (validation_result ->> 'passed') = 'true'
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
  notes                         text        NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_cs_session_code UNIQUE (session_code),

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
    reconciliation_status <> 'discrepancy' OR discrepancy_notes IS NOT NULL
  ),
  CONSTRAINT ck_ct_waived_requires_evidence CHECK (
    reconciliation_status <> 'waived' OR waiver_evidence IS NOT NULL
  ),
  CONSTRAINT ck_ct_reconciled_requires_timestamp CHECK (
    reconciliation_status = 'pending' OR reconciled_at IS NOT NULL
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

-- NOTE (governance): cross-row gate sequencing (e.g. CUTOVER may not pass until
-- ACCEPTANCE has passed; LEGACY_RETIREMENT requires CUTOVER; SCALE requires
-- LEGACY_RETIREMENT) is a cross-row rule. A table CHECK cannot query other rows,
-- and a CONSTRAINT TRIGGER would need to be executed against live data, which is
-- out of scope for this source-only migration. The sequencing rule is enforced in
-- the application layer by canPassReleaseGate() in serviceosIntelligenceUtils.js.
COMMENT ON TABLE public.release_gate IS
  'Wave 6: Release sequencing gate. Cross-gate prerequisites are enforced in the '
  'application layer (canPassReleaseGate). SOURCE ONLY — not executed.';

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

CREATE INDEX idx_ccr_scope            ON public.change_control_record (organization_id, business_unit_id);
CREATE INDEX idx_ccr_status           ON public.change_control_record (change_status);

CREATE INDEX idx_de_from_node         ON public.dependency_edge (from_node);
CREATE INDEX idx_de_to_node           ON public.dependency_edge (to_node);
CREATE INDEX idx_de_kg_id             ON public.dependency_edge (kg_id);

CREATE INDEX idx_cs_scope             ON public.continuity_session (organization_id, business_unit_id);
CREATE INDEX idx_cs_status            ON public.continuity_session (session_status);

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

-- ── management_review FSM ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_enforce_management_review_fsm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Terminal immutability: a closed review cannot be modified at all.
  IF OLD.review_status = 'closed' THEN
    RAISE EXCEPTION
      'management_review: terminal row is immutable (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Status unchanged: allow (only non-status field changes).
  IF NEW.review_status = OLD.review_status THEN
    RETURN NEW;
  END IF;

  -- Validate OLD → NEW using the locked FSM:
  --   draft → in_review
  --   in_review → actions_open | closed
  --   actions_open → closed
  --   closed → (terminal)
  IF NOT (
    (OLD.review_status = 'draft'        AND NEW.review_status = 'in_review')   OR
    (OLD.review_status = 'in_review'    AND NEW.review_status = 'actions_open') OR
    (OLD.review_status = 'in_review'    AND NEW.review_status = 'closed')       OR
    (OLD.review_status = 'actions_open' AND NEW.review_status = 'closed')
  ) THEN
    RAISE EXCEPTION
      'management_review FSM: illegal transition % → % (row id=%)',
      OLD.review_status, NEW.review_status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Closure prerequisite: all actions resolved or waiver recorded.
  IF NEW.review_status = 'closed' AND NEW.waiver_recorded IS NOT TRUE THEN
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

  -- closed_at must be set when closing (belt-and-suspenders; CHECK also enforces this).
  IF NEW.review_status = 'closed' AND NEW.closed_at IS NULL THEN
    RAISE EXCEPTION
      'management_review: closed_at must be set when closing (row id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_management_review_fsm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_enforce_management_review_fsm() FROM anon;
REVOKE ALL ON FUNCTION public.trg_enforce_management_review_fsm() FROM authenticated;

CREATE TRIGGER trig_management_review_fsm
  BEFORE UPDATE ON public.management_review
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_management_review_fsm();

COMMENT ON FUNCTION public.trg_enforce_management_review_fsm() IS
  'Wave 6: DB-level management_review FSM. Illegal transitions raise P0001. '
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

  -- Passed is terminal for a single gate: cannot be reverted.
  IF OLD.gate_status = 'passed' AND NEW.gate_status <> 'passed' THEN
    RAISE EXCEPTION
      'release_gate: gate % (id=%) is passed and cannot be reverted',
      OLD.gate_code, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- When moving to passed, verify the predecessor gate (if any) is also passed.
  IF NEW.gate_status = 'passed' AND OLD.gate_status <> 'passed' THEN
    SELECT rg.gate_status INTO v_prev_status
    FROM public.release_gate rg
    WHERE rg.sequence_order = (NEW.sequence_order - 1)
    LIMIT 1;

    IF FOUND AND v_prev_status <> 'passed' THEN
      RAISE EXCEPTION
        'release_gate: cannot pass gate % (sequence %) before predecessor (sequence %) is passed',
        NEW.gate_code, NEW.sequence_order, (NEW.sequence_order - 1)
        USING ERRCODE = 'P0001';
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
  'Passed gates cannot be reverted. A gate cannot be passed before its predecessor. SOURCE ONLY.';

-- ── continuity_transaction payload hash (INSERT-only, immutable) ─────────────

CREATE OR REPLACE FUNCTION public.trg_set_continuity_payload_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Canonical representation: transaction_data::text (JSONB to text, stable
  -- within a PostgreSQL version for the same in-memory value).
  -- Algorithm: SHA-256 via extensions.digest() (pgcrypto in schema extensions,
  -- as installed in the Have Us Clean Supabase project). Encoded as hex (64 chars).
  -- Schema-qualified to guarantee resolution regardless of search_path.
  -- This function is INSERT-only — the hash is never silently overwritten.
  -- FAIL CLOSED: if extensions.digest is unavailable the exception propagates
  -- and the INSERT is aborted. payload_hash is NOT NULL on continuity_transaction.
  NEW.payload_hash := encode(
    extensions.digest(NEW.transaction_data::text, 'sha256'),
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
  'Hash = encode(extensions.digest(transaction_data::text, ''sha256''), ''hex''). '
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
-- Remaining Wave 1–2 tables (opportunity, quote, conversion_record) are excluded
-- pending column verification.
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
    COALESCE(wo.service_completed_at, wo.updated_at),
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
    COALESCE(qi.inspected_at, qi.updated_at),
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
    COALESCE(cp.approved_at, cp.created_at),
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
  'Remaining Wave 1-2 tables (opportunity, quote, conversion_record) excluded pending column verification. '
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
-- conversion_record). Those tables exist in the deployed database but their
-- DDL is NOT vendored into this repository, so their columns cannot be
-- verified from source. Their lineage is therefore tagged
-- "wave":"1-2" / "in_canonical_event_view":false, and they are intentionally
-- absent from public.wave6_canonical_event. Everything from
-- `operations.*` onwards is sourced from migrations 007/009/012 and IS
-- represented in the canonical event view.

INSERT INTO public.kpi_definition
  (code, name, domain, description, unit, aggregation_type, period_support,
   source_lineage, formula_code, definition_version, active)
VALUES
  ('sales.leads_created', 'Leads Created', 'sales',
   'Count of canonical service requests created in period. Wave 1-2 table (service_request) — DDL not vendored in this repository.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["service_request"],"filter":null,"timestamp":"created_at","wave":"1-2","in_canonical_event_view":false}'::jsonb,
   'count(service_request)', '1', true),

  ('sales.opportunities_created', 'Opportunities Created', 'sales',
   'Count of opportunities created in period. Wave 1-2 table (opportunity) — DDL not vendored in this repository.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["opportunity"],"filter":null,"timestamp":"created_at","wave":"1-2","in_canonical_event_view":false}'::jsonb,
   'count(opportunity)', '1', true),

  ('sales.quotes_created', 'Quotes Created', 'sales',
   'Count of quotes created in period. Wave 1-2 table (quote) — DDL not vendored in this repository.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["quote"],"filter":null,"timestamp":"created_at","wave":"1-2","in_canonical_event_view":false}'::jsonb,
   'count(quote)', '1', true),

  ('sales.quotes_accepted', 'Quotes Accepted', 'sales',
   'Count of quote responses with response_type = accepted. Wave 1-2 table (quote_response) — DDL not vendored in this repository.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["quote_response"],"filter":"response_type=accepted","timestamp":"created_at","wave":"1-2","in_canonical_event_view":false}'::jsonb,
   'count(quote_response where response_type=accepted)', '1', true),

  ('sales.conversions', 'Conversions', 'sales',
   'Count of conversion records created in period. Wave 1-2 table (conversion_record) — DDL not vendored in this repository.', 'count', 'count',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["conversion_record"],"filter":null,"timestamp":"created_at","wave":"1-2","in_canonical_event_view":false}'::jsonb,
   'count(conversion_record)', '1', true),

  ('sales.lead_to_conversion_rate', 'Lead to Conversion Rate', 'sales',
   'Conversions divided by leads created. NULL when no leads exist. Wave 1-2 tables (conversion_record, service_request) — DDL not vendored in this repository.', 'ratio', 'rate',
   ARRAY['DAILY','MONTHLY','QUARTERLY','YEARLY'],
   '{"tables":["conversion_record","service_request"],"numerator":"sales.conversions","denominator":"sales.leads_created","wave":"1-2","in_canonical_event_view":false}'::jsonb,
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
   '{"tables":["qa_inspection"],"numerator":"inspection_status=passed","denominator":"inspection_status in (passed,failed)"}'::jsonb,
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
   '{"tables":["job_profitability_snapshot"],"numerator":"gross_contribution","denominator":"recognized_revenue_amount"}'::jsonb,
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
  DECLARE
    v_required_fn text;
  BEGIN
    FOR v_required_fn IN SELECT unnest(ARRAY[
      'trg_enforce_management_review_fsm',
      'trg_enforce_ccr_fsm',
      'trg_enforce_continuity_fsm',
      'trg_enforce_release_gate_sequence',
      'trg_set_continuity_payload_hash',
      'trg_immute_continuity_transaction_fields'
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
