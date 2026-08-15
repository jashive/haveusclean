-- =============================================================================
-- MIGRATION 012 — WAVE 5: BILLING / INVOICE / PAYMENT / CONTRACTOR PAY / JOB FINANCE
-- =============================================================================
-- Additive only. No huc_* table is altered, dropped, or granted.
-- No Wave 1–4 table is modified.
-- DATABASE EXECUTION NOT YET AUTHORIZED.
-- Gated on Wave 4 role/RLS closure.
-- =============================================================================
-- Tables created:
--   billing_readiness_gate
--   invoice_request
--   accounting_sync_outbox
--   payment_observation
--   contractor_compensation_version
--   contractor_payable
--   job_profitability_snapshot
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 1: TABLE DEFINITIONS
-- ---------------------------------------------------------------------------

-- ============================================================
-- 1. billing_readiness_gate
--    Fail-closed operational billing-readiness assessment.
--    One gate per operational_job (UNIQUE).
--    Must be 'ready' before an invoice_request can proceed.
-- ============================================================
CREATE TABLE public.billing_readiness_gate (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,
  jurisdiction_id               uuid        NULL,

  operational_job_id            uuid        NOT NULL,
  work_order_id                 uuid        NOT NULL,
  operational_handoff_id        uuid        NULL,

  pricing_snapshot_id           uuid        NOT NULL,
  quote_version_id              uuid        NOT NULL,

  gate_status                   text        NOT NULL DEFAULT 'pending',
  gate_assessment               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  blocking_reasons              jsonb       NOT NULL DEFAULT '[]'::jsonb,

  assessed_at                   timestamptz NULL,
  assessed_by_app_user_id       uuid        NULL,

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_brg_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_brg_operational_job
    FOREIGN KEY (operational_job_id) REFERENCES public.operational_job(id),
  CONSTRAINT fk_brg_work_order
    FOREIGN KEY (work_order_id) REFERENCES public.work_order(id),
  CONSTRAINT fk_brg_operational_handoff
    FOREIGN KEY (operational_handoff_id) REFERENCES public.operational_handoff(id),
  CONSTRAINT fk_brg_pricing_snapshot
    FOREIGN KEY (pricing_snapshot_id) REFERENCES public.pricing_snapshot(id),
  CONSTRAINT fk_brg_quote_version
    FOREIGN KEY (quote_version_id) REFERENCES public.quote_version(id),

  CONSTRAINT uq_brg_job UNIQUE (operational_job_id),

  CONSTRAINT ck_brg_status CHECK (
    gate_status IN ('pending', 'ready', 'blocked', 'void')
  )
);

COMMENT ON TABLE public.billing_readiness_gate IS
  'Wave 5: Fail-closed billing-readiness gate per operational job. '
  'Must reach ready before invoice_request can be created. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 2. invoice_request
--    ServiceOS request-to-invoice record with frozen financial snapshot.
--    Monetary fields are protected after acknowledgment.
--    One active invoice per operational_job (UNIQUE).
-- ============================================================
CREATE TABLE public.invoice_request (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,
  jurisdiction_id               uuid        NULL,

  billing_readiness_gate_id     uuid        NOT NULL,
  operational_job_id            uuid        NOT NULL,
  work_order_id                 uuid        NOT NULL,
  operational_handoff_id        uuid        NULL,

  customer_id                   uuid        NULL,
  service_location_id           uuid        NULL,

  pricing_snapshot_id           uuid        NOT NULL,
  quote_version_id              uuid        NOT NULL,
  quote_response_id             uuid        NULL,
  conversion_record_id          uuid        NULL,

  -- Frozen financial snapshot (from accepted quote/pricing — NOT recalculated)
  currency_code                 text        NOT NULL,
  subtotal_amount               numeric(12,2) NOT NULL,
  tax_amount                    numeric(12,2) NOT NULL,
  total_amount                  numeric(12,2) NOT NULL,
  tax_name                      text        NULL,
  tax_rate                      numeric(6,4) NULL,

  financial_snapshot            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  request_status                text        NOT NULL DEFAULT 'draft',

  accounting_provider           text        NULL,
  provider_reference_id         text        NULL,
  provider_acknowledged_at      timestamptz NULL,
  provider_response_snapshot    jsonb       NULL,

  submitted_at                  timestamptz NULL,
  acknowledged_at               timestamptz NULL,

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,
  updated_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_ir_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_ir_billing_readiness_gate
    FOREIGN KEY (billing_readiness_gate_id) REFERENCES public.billing_readiness_gate(id),
  CONSTRAINT fk_ir_operational_job
    FOREIGN KEY (operational_job_id) REFERENCES public.operational_job(id),
  CONSTRAINT fk_ir_work_order
    FOREIGN KEY (work_order_id) REFERENCES public.work_order(id),
  CONSTRAINT fk_ir_operational_handoff
    FOREIGN KEY (operational_handoff_id) REFERENCES public.operational_handoff(id),
  CONSTRAINT fk_ir_customer
    FOREIGN KEY (customer_id) REFERENCES public.customer(id),
  CONSTRAINT fk_ir_pricing_snapshot
    FOREIGN KEY (pricing_snapshot_id) REFERENCES public.pricing_snapshot(id),
  CONSTRAINT fk_ir_quote_version
    FOREIGN KEY (quote_version_id) REFERENCES public.quote_version(id),
  CONSTRAINT fk_ir_quote_response
    FOREIGN KEY (quote_response_id) REFERENCES public.quote_response(id),
  CONSTRAINT fk_ir_conversion_record
    FOREIGN KEY (conversion_record_id) REFERENCES public.conversion_record(id),

  CONSTRAINT uq_ir_job UNIQUE (operational_job_id),

  CONSTRAINT ck_ir_status CHECK (
    request_status IN ('draft', 'submitted', 'acknowledged', 'cancelled', 'void')
  ),
  CONSTRAINT ck_ir_currency CHECK (currency_code <> ''),
  CONSTRAINT ck_ir_subtotal_nonneg CHECK (subtotal_amount >= 0),
  CONSTRAINT ck_ir_tax_nonneg    CHECK (tax_amount >= 0),
  CONSTRAINT ck_ir_total_nonneg  CHECK (total_amount >= 0),
  CONSTRAINT ck_ir_total_coherent CHECK (
    total_amount = subtotal_amount + tax_amount
  )
);

COMMENT ON TABLE public.invoice_request IS
  'Wave 5: ServiceOS invoice request. Frozen financial snapshot from accepted pricing. '
  'QuickBooks remains accounting ledger authority. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 3. accounting_sync_outbox
--    Idempotent provider outbox for QuickBooks sync.
--    Provider reference IDs must be real — never fabricated.
--    Test adapter must be explicitly flagged and cannot run in Production.
-- ============================================================
CREATE TABLE public.accounting_sync_outbox (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,

  invoice_request_id            uuid        NOT NULL,

  idempotency_key               text        NOT NULL,
  provider                      text        NOT NULL DEFAULT 'quickbooks',

  outbox_status                 text        NOT NULL DEFAULT 'pending',

  request_payload               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  response_payload              jsonb       NULL,

  provider_reference_id         text        NULL,
  provider_reference_type       text        NULL,

  attempt_count                 integer     NOT NULL DEFAULT 0,
  last_attempted_at             timestamptz NULL,
  acknowledged_at               timestamptz NULL,

  is_test_adapter               boolean     NOT NULL DEFAULT false,

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_aso_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_aso_invoice_request
    FOREIGN KEY (invoice_request_id) REFERENCES public.invoice_request(id),

  CONSTRAINT uq_aso_idempotency UNIQUE (idempotency_key),

  CONSTRAINT ck_aso_provider CHECK (
    provider IN ('quickbooks', 'preview_test')
  ),
  CONSTRAINT ck_aso_status CHECK (
    outbox_status IN ('pending', 'sent', 'acknowledged', 'failed', 'cancelled')
  ),
  CONSTRAINT ck_aso_idempotency_key_nonempty CHECK (idempotency_key <> ''),
  CONSTRAINT ck_aso_attempts_nonneg CHECK (attempt_count >= 0)
);

COMMENT ON TABLE public.accounting_sync_outbox IS
  'Wave 5: Idempotent provider outbox for QuickBooks accounting sync. '
  'is_test_adapter=true rows blocked in Production via trigger. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 4. payment_observation
--    Canonical payment record derived from provider events.
--    Stripe/provider records are EVIDENCE; QuickBooks is LEDGER authority.
--    Idempotent per (provider, provider_event_id).
-- ============================================================
CREATE TABLE public.payment_observation (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,

  invoice_request_id            uuid        NOT NULL,
  accounting_sync_outbox_id     uuid        NULL,

  provider                      text        NOT NULL,
  provider_event_id             text        NOT NULL,
  provider_event_type           text        NOT NULL,
  provider_reference_id         text        NULL,

  currency_code                 text        NOT NULL,
  amount_observed               numeric(12,2) NOT NULL,

  payment_status                text        NOT NULL DEFAULT 'observed',

  event_payload_snapshot        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  observed_at                   timestamptz NOT NULL,
  settled_at                    timestamptz NULL,

  is_test_provider              boolean     NOT NULL DEFAULT false,

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_po_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_po_invoice_request
    FOREIGN KEY (invoice_request_id) REFERENCES public.invoice_request(id),
  CONSTRAINT fk_po_accounting_sync_outbox
    FOREIGN KEY (accounting_sync_outbox_id) REFERENCES public.accounting_sync_outbox(id),

  CONSTRAINT uq_po_provider_event UNIQUE (provider, provider_event_id),

  CONSTRAINT ck_po_provider CHECK (
    provider IN ('stripe', 'manual', 'preview_test')
  ),
  CONSTRAINT ck_po_status CHECK (
    payment_status IN ('observed', 'verified', 'reconciled', 'disputed', 'voided')
  ),
  CONSTRAINT ck_po_amount_nonneg   CHECK (amount_observed >= 0),
  CONSTRAINT ck_po_currency_nonempty CHECK (currency_code <> ''),
  CONSTRAINT ck_po_event_id_nonempty CHECK (provider_event_id <> '')
);

COMMENT ON TABLE public.payment_observation IS
  'Wave 5: Canonical payment observation per provider event. '
  'Idempotent: (provider, provider_event_id) is UNIQUE. '
  'QuickBooks remains accounting ledger authority. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 5. contractor_compensation_version
--    Versioned compensation contract. Historical rows are immutable
--    once approved/active. Later versions must not alter historical payables.
-- ============================================================
CREATE TABLE public.contractor_compensation_version (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,

  worker_id                     uuid        NOT NULL,

  service_family                text        NULL,
  service_module_key            text        NULL,

  version                       text        NOT NULL,
  compensation_method           text        NOT NULL,
  currency_code                 text        NOT NULL DEFAULT 'CAD',
  rate_value                    numeric(12,4) NOT NULL,

  effective_from                timestamptz NOT NULL,
  effective_to                  timestamptz NULL,

  compensation_status           text        NOT NULL DEFAULT 'draft',

  approved_by_app_user_id       uuid        NULL,
  approved_at                   timestamptz NULL,

  governance_reference_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_ccv_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_ccv_worker
    FOREIGN KEY (worker_id) REFERENCES public.worker(id),

  CONSTRAINT uq_ccv_worker_version UNIQUE (worker_id, organization_id, version),

  CONSTRAINT ck_ccv_method CHECK (
    compensation_method IN ('flat_amount', 'hourly', 'percentage')
  ),
  CONSTRAINT ck_ccv_status CHECK (
    compensation_status IN ('draft', 'approved', 'active', 'retired')
  ),
  CONSTRAINT ck_ccv_rate_nonneg CHECK (rate_value >= 0),
  CONSTRAINT ck_ccv_currency_nonempty CHECK (currency_code <> ''),
  CONSTRAINT ck_ccv_version_nonempty CHECK (version <> ''),
  CONSTRAINT ck_ccv_percentage_range CHECK (
    compensation_method <> 'percentage' OR (rate_value >= 0 AND rate_value <= 1)
  )
);

COMMENT ON TABLE public.contractor_compensation_version IS
  'Wave 5: Versioned compensation contract per worker. '
  'Immutable once approved/active. Historical payables reference frozen version. '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 6. contractor_payable
--    Per-assignment payable linked to a frozen compensation version.
--    Worker may NOT approve/pay their own payable.
--    Duplicate payable for same assignment/compensation basis is prevented.
-- ============================================================
CREATE TABLE public.contractor_payable (
  id                                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id                     uuid        NOT NULL,
  business_unit_id                    uuid        NOT NULL,

  worker_id                           uuid        NOT NULL,
  worker_assignment_id                uuid        NOT NULL,
  operational_job_id                  uuid        NOT NULL,
  work_order_id                       uuid        NOT NULL,

  contractor_compensation_version_id  uuid        NOT NULL,

  -- Frozen computation basis
  compensation_method                 text        NOT NULL,
  currency_code                       text        NOT NULL,
  basis_value                         numeric(12,4) NOT NULL,
  computed_amount                     numeric(12,2) NOT NULL,

  payable_status                      text        NOT NULL DEFAULT 'pending',

  eligibility_assessment              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  eligibility_passed                  boolean     NOT NULL DEFAULT false,

  approved_by_app_user_id             uuid        NULL,
  approved_at                         timestamptz NULL,

  metadata                            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id              uuid        NULL,

  CONSTRAINT fk_cp_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_cp_worker
    FOREIGN KEY (worker_id) REFERENCES public.worker(id),
  CONSTRAINT fk_cp_worker_assignment
    FOREIGN KEY (worker_assignment_id) REFERENCES public.worker_assignment(id),
  CONSTRAINT fk_cp_operational_job
    FOREIGN KEY (operational_job_id) REFERENCES public.operational_job(id),
  CONSTRAINT fk_cp_work_order
    FOREIGN KEY (work_order_id) REFERENCES public.work_order(id),
  CONSTRAINT fk_cp_compensation_version
    FOREIGN KEY (contractor_compensation_version_id) REFERENCES public.contractor_compensation_version(id),

  CONSTRAINT uq_cp_assignment_compensation
    UNIQUE (worker_assignment_id, contractor_compensation_version_id),

  CONSTRAINT ck_cp_status CHECK (
    payable_status IN ('pending', 'approved', 'paid', 'voided')
  ),
  CONSTRAINT ck_cp_method CHECK (
    compensation_method IN ('flat_amount', 'hourly', 'percentage')
  ),
  CONSTRAINT ck_cp_amount_nonneg  CHECK (computed_amount >= 0),
  CONSTRAINT ck_cp_basis_nonneg   CHECK (basis_value >= 0),
  CONSTRAINT ck_cp_currency_nonempty CHECK (currency_code <> '')
);

COMMENT ON TABLE public.contractor_payable IS
  'Wave 5: Per-assignment contractor payable. '
  'Worker may never approve/pay their own payable (enforced by trigger). '
  'Duplicate prevention: UNIQUE (worker_assignment_id, contractor_compensation_version_id). '
  'SOURCE ONLY — not executed.';

-- ============================================================
-- 7. job_profitability_snapshot
--    Persisted profitability calculation for reproducibility.
--    Revenue basis = accepted pricing subtotal (excl. tax) — never recalculated.
--    gross_contribution computed STORED column.
-- ============================================================
CREATE TABLE public.job_profitability_snapshot (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id               uuid        NOT NULL,
  business_unit_id              uuid        NOT NULL,

  operational_job_id            uuid        NOT NULL,
  invoice_request_id            uuid        NULL,

  currency_code                 text        NOT NULL,

  recognized_revenue_amount     numeric(12,2) NOT NULL,
  tax_amount                    numeric(12,2) NOT NULL,
  direct_labor_cost             numeric(12,2) NOT NULL DEFAULT 0,
  other_direct_cost             numeric(12,2) NOT NULL DEFAULT 0,

  gross_contribution            numeric(12,2) GENERATED ALWAYS AS (
    recognized_revenue_amount - direct_labor_cost - other_direct_cost
  ) STORED,

  gross_margin_percent          numeric(8,4) NULL,

  source_lineage                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  snapshot_taken_at             timestamptz NOT NULL DEFAULT now(),

  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_app_user_id        uuid        NULL,

  CONSTRAINT fk_jps_org
    FOREIGN KEY (organization_id) REFERENCES public.organization(id),
  CONSTRAINT fk_jps_operational_job
    FOREIGN KEY (operational_job_id) REFERENCES public.operational_job(id),
  CONSTRAINT fk_jps_invoice_request
    FOREIGN KEY (invoice_request_id) REFERENCES public.invoice_request(id),

  -- A15: append-only model — no UNIQUE(operational_job_id); multiple snapshots per job allowed.
  -- Latest snapshot is determined by MAX(snapshot_taken_at) per operational_job_id.

  CONSTRAINT ck_jps_currency_nonempty   CHECK (currency_code <> ''),
  CONSTRAINT ck_jps_revenue_nonneg      CHECK (recognized_revenue_amount >= 0),
  CONSTRAINT ck_jps_tax_nonneg          CHECK (tax_amount >= 0),
  CONSTRAINT ck_jps_labor_nonneg        CHECK (direct_labor_cost >= 0),
  CONSTRAINT ck_jps_other_nonneg        CHECK (other_direct_cost >= 0)
);

COMMENT ON TABLE public.job_profitability_snapshot IS
  'Wave 5: Append-only persisted job profitability snapshot. '
  'Revenue basis from accepted pricing — NOT recalculated. '
  'Multiple snapshots per operational_job_id are allowed (no UNIQUE constraint). '
  'Latest snapshot is determined by MAX(snapshot_taken_at). '
  'UPDATE and DELETE are prohibited by trigger (trg_jps_append_only). '
  'gross_contribution is a STORED GENERATED column. '
  'gross_margin_percent set by trigger (zero-revenue guard). '
  'SOURCE ONLY — not executed.';

-- ---------------------------------------------------------------------------
-- SECTION 2: INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_brg_org_bu         ON public.billing_readiness_gate (organization_id, business_unit_id);
CREATE INDEX idx_brg_status         ON public.billing_readiness_gate (gate_status);

CREATE INDEX idx_ir_org_bu          ON public.invoice_request (organization_id, business_unit_id);
CREATE INDEX idx_ir_status          ON public.invoice_request (request_status);
CREATE INDEX idx_ir_gate            ON public.invoice_request (billing_readiness_gate_id);

CREATE INDEX idx_aso_invoice        ON public.accounting_sync_outbox (invoice_request_id);
CREATE INDEX idx_aso_status         ON public.accounting_sync_outbox (outbox_status);
CREATE INDEX idx_aso_provider       ON public.accounting_sync_outbox (provider);

CREATE INDEX idx_po_invoice         ON public.payment_observation (invoice_request_id);
CREATE INDEX idx_po_status          ON public.payment_observation (payment_status);
CREATE INDEX idx_po_provider        ON public.payment_observation (provider);

CREATE INDEX idx_ccv_worker         ON public.contractor_compensation_version (worker_id, organization_id);
CREATE INDEX idx_ccv_status         ON public.contractor_compensation_version (compensation_status);

CREATE INDEX idx_cp_worker          ON public.contractor_payable (worker_id, organization_id);
CREATE INDEX idx_cp_assignment      ON public.contractor_payable (worker_assignment_id);
CREATE INDEX idx_cp_job             ON public.contractor_payable (operational_job_id);
CREATE INDEX idx_cp_status          ON public.contractor_payable (payable_status);

CREATE INDEX idx_jps_org_bu         ON public.job_profitability_snapshot (organization_id, business_unit_id);
-- A15: lookup latest snapshot per job (append-only model)
CREATE INDEX idx_jps_job_taken_at    ON public.job_profitability_snapshot (operational_job_id, snapshot_taken_at DESC);

-- ---------------------------------------------------------------------------
-- SECTION 3: TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

-- ============================================================
-- T1: billing_readiness_gate — immutability after ready
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_billing_readiness_gate_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.gate_status = 'ready' THEN
    IF NEW.operational_job_id   <> OLD.operational_job_id   THEN RAISE EXCEPTION 'billing_readiness_gate: operational_job_id is immutable after ready'; END IF;
    IF NEW.work_order_id        <> OLD.work_order_id        THEN RAISE EXCEPTION 'billing_readiness_gate: work_order_id is immutable after ready'; END IF;
    IF NEW.pricing_snapshot_id  <> OLD.pricing_snapshot_id  THEN RAISE EXCEPTION 'billing_readiness_gate: pricing_snapshot_id is immutable after ready'; END IF;
    IF NEW.quote_version_id     <> OLD.quote_version_id     THEN RAISE EXCEPTION 'billing_readiness_gate: quote_version_id is immutable after ready'; END IF;
    IF NEW.organization_id      <> OLD.organization_id      THEN RAISE EXCEPTION 'billing_readiness_gate: organization_id is immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brg_immutability
  BEFORE UPDATE ON public.billing_readiness_gate
  FOR EACH ROW EXECUTE FUNCTION public.trg_billing_readiness_gate_immutability();

-- ============================================================
-- T2: invoice_request — monetary/lineage immutability after acknowledgment
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_request_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  -- Monetary and lineage fields must not change after acknowledgment
  IF OLD.request_status IN ('acknowledged') THEN
    IF NEW.currency_code        <> OLD.currency_code        THEN RAISE EXCEPTION 'invoice_request: currency_code is immutable after acknowledgment'; END IF;
    IF NEW.subtotal_amount      <> OLD.subtotal_amount      THEN RAISE EXCEPTION 'invoice_request: subtotal_amount is immutable after acknowledgment'; END IF;
    IF NEW.tax_amount           <> OLD.tax_amount           THEN RAISE EXCEPTION 'invoice_request: tax_amount is immutable after acknowledgment'; END IF;
    IF NEW.total_amount         <> OLD.total_amount         THEN RAISE EXCEPTION 'invoice_request: total_amount is immutable after acknowledgment'; END IF;
    IF NEW.pricing_snapshot_id  <> OLD.pricing_snapshot_id  THEN RAISE EXCEPTION 'invoice_request: pricing_snapshot_id is immutable after acknowledgment'; END IF;
    IF NEW.quote_version_id     <> OLD.quote_version_id     THEN RAISE EXCEPTION 'invoice_request: quote_version_id is immutable after acknowledgment'; END IF;
    IF NEW.operational_job_id   <> OLD.operational_job_id   THEN RAISE EXCEPTION 'invoice_request: operational_job_id is immutable'; END IF;
    IF NEW.organization_id      <> OLD.organization_id      THEN RAISE EXCEPTION 'invoice_request: organization_id is immutable'; END IF;
  END IF;

  -- Once void or cancelled, no further status change
  IF OLD.request_status IN ('void', 'cancelled') THEN
    IF NEW.request_status <> OLD.request_status THEN
      RAISE EXCEPTION 'invoice_request: cannot transition from terminal status %', OLD.request_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ir_immutability
  BEFORE UPDATE ON public.invoice_request
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_request_immutability();

-- Require billing_readiness_gate = ready before insert
CREATE OR REPLACE FUNCTION public.trg_invoice_request_gate_check()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_gate_status text;
BEGIN
  SELECT gate_status INTO v_gate_status
  FROM public.billing_readiness_gate
  WHERE id = NEW.billing_readiness_gate_id;

  IF v_gate_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION
      'invoice_request: billing_readiness_gate must be ready before creating invoice_request (gate status: %)',
      COALESCE(v_gate_status, 'NOT FOUND');
  END IF;

  -- Validate no duplicate active invoice for this job (exclude void/cancelled)
  IF EXISTS (
    SELECT 1 FROM public.invoice_request ir
    WHERE ir.operational_job_id = NEW.operational_job_id
      AND ir.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ir.request_status NOT IN ('void', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'invoice_request: duplicate active invoice_request for operational_job_id %', NEW.operational_job_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ir_gate_check
  BEFORE INSERT ON public.invoice_request
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_request_gate_check();

-- ============================================================
-- T3: accounting_sync_outbox — test adapter blocked in Production
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_accounting_sync_outbox_production_guard()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_env text;
BEGIN
  v_env := current_setting('app.environment', true);

  IF NEW.is_test_adapter = true AND COALESCE(v_env, '') = 'production' THEN
    RAISE EXCEPTION
      'accounting_sync_outbox: preview/test adapter is PROHIBITED in Production environment. '
      'Set app.environment to a non-production value for test runs.';
  END IF;

  -- Provider reference IDs must NOT be fabricated QB-{timestamp} placeholders
  IF NEW.provider_reference_id IS NOT NULL
     AND NEW.provider_reference_id ~ '^QB-[0-9]+-[0-9]+$' THEN
    RAISE EXCEPTION
      'accounting_sync_outbox: provider_reference_id looks like a fabricated placeholder (%). '
      'Real QuickBooks IDs must be used in production.', NEW.provider_reference_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aso_production_guard
  BEFORE INSERT OR UPDATE ON public.accounting_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.trg_accounting_sync_outbox_production_guard();

-- Immutability: acknowledged outbox entry must not have critical fields changed
CREATE OR REPLACE FUNCTION public.trg_accounting_sync_outbox_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.outbox_status = 'acknowledged' THEN
    IF NEW.invoice_request_id   <> OLD.invoice_request_id   THEN RAISE EXCEPTION 'accounting_sync_outbox: invoice_request_id is immutable after acknowledgment'; END IF;
    IF NEW.idempotency_key      <> OLD.idempotency_key      THEN RAISE EXCEPTION 'accounting_sync_outbox: idempotency_key is immutable'; END IF;
    IF NEW.provider             <> OLD.provider             THEN RAISE EXCEPTION 'accounting_sync_outbox: provider is immutable after acknowledgment'; END IF;
    IF NEW.is_test_adapter      <> OLD.is_test_adapter      THEN RAISE EXCEPTION 'accounting_sync_outbox: is_test_adapter is immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aso_immutability
  BEFORE UPDATE ON public.accounting_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.trg_accounting_sync_outbox_immutability();

-- ============================================================
-- T4: payment_observation — immutability of event/amount/currency
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_payment_observation_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.invoice_request_id  <> OLD.invoice_request_id  THEN RAISE EXCEPTION 'payment_observation: invoice_request_id is immutable'; END IF;
  IF NEW.provider            <> OLD.provider            THEN RAISE EXCEPTION 'payment_observation: provider is immutable'; END IF;
  IF NEW.provider_event_id   <> OLD.provider_event_id   THEN RAISE EXCEPTION 'payment_observation: provider_event_id is immutable'; END IF;
  IF NEW.currency_code       <> OLD.currency_code       THEN RAISE EXCEPTION 'payment_observation: currency_code is immutable'; END IF;
  IF NEW.amount_observed     <> OLD.amount_observed     THEN RAISE EXCEPTION 'payment_observation: amount_observed is immutable'; END IF;
  IF NEW.organization_id     <> OLD.organization_id     THEN RAISE EXCEPTION 'payment_observation: organization_id is immutable'; END IF;
  IF NEW.is_test_provider    <> OLD.is_test_provider    THEN RAISE EXCEPTION 'payment_observation: is_test_provider is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_immutability
  BEFORE UPDATE ON public.payment_observation
  FOR EACH ROW EXECUTE FUNCTION public.trg_payment_observation_immutability();

-- ============================================================
-- T5: contractor_compensation_version — immutability after approved/active
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_ccv_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.compensation_status IN ('approved', 'active') THEN
    IF NEW.compensation_method <> OLD.compensation_method THEN RAISE EXCEPTION 'contractor_compensation_version: compensation_method is immutable after approval'; END IF;
    IF NEW.rate_value          <> OLD.rate_value          THEN RAISE EXCEPTION 'contractor_compensation_version: rate_value is immutable after approval'; END IF;
    IF NEW.currency_code       <> OLD.currency_code       THEN RAISE EXCEPTION 'contractor_compensation_version: currency_code is immutable after approval'; END IF;
    IF NEW.worker_id           <> OLD.worker_id           THEN RAISE EXCEPTION 'contractor_compensation_version: worker_id is immutable'; END IF;
    IF NEW.organization_id     <> OLD.organization_id     THEN RAISE EXCEPTION 'contractor_compensation_version: organization_id is immutable'; END IF;
    IF NEW.version             <> OLD.version             THEN RAISE EXCEPTION 'contractor_compensation_version: version is immutable'; END IF;
    IF NEW.effective_from      <> OLD.effective_from      THEN RAISE EXCEPTION 'contractor_compensation_version: effective_from is immutable after approval'; END IF;
  END IF;

  IF OLD.compensation_status = 'retired' THEN
    IF NEW.compensation_status <> OLD.compensation_status THEN
      RAISE EXCEPTION 'contractor_compensation_version: cannot transition from retired status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ccv_immutability
  BEFORE UPDATE ON public.contractor_compensation_version
  FOR EACH ROW EXECUTE FUNCTION public.trg_ccv_immutability();

-- ============================================================
-- T6: contractor_payable — self-approval prevention + immutability
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_contractor_payable_approval_guard()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_worker_app_user_id uuid;
  v_approver_app_user_id uuid;
BEGIN
  -- If a new approval is being set, verify the approver is not the worker
  IF NEW.approved_by_app_user_id IS NOT NULL
     AND (OLD.approved_by_app_user_id IS NULL OR OLD.approved_by_app_user_id <> NEW.approved_by_app_user_id)
  THEN
    SELECT w.app_user_id INTO v_worker_app_user_id
    FROM public.worker w
    WHERE w.id = NEW.worker_id;

    IF v_worker_app_user_id IS NOT NULL
       AND v_worker_app_user_id = NEW.approved_by_app_user_id THEN
      RAISE EXCEPTION
        'contractor_payable: worker may not approve their own payable (worker_id=%, approved_by_app_user_id=%)',
        NEW.worker_id, NEW.approved_by_app_user_id;
    END IF;
  END IF;

  -- Immutability: core fields after approved/paid
  IF OLD.payable_status IN ('approved', 'paid') THEN
    IF NEW.worker_id                           <> OLD.worker_id                           THEN RAISE EXCEPTION 'contractor_payable: worker_id is immutable after approval'; END IF;
    IF NEW.worker_assignment_id                <> OLD.worker_assignment_id                THEN RAISE EXCEPTION 'contractor_payable: worker_assignment_id is immutable after approval'; END IF;
    IF NEW.contractor_compensation_version_id  <> OLD.contractor_compensation_version_id  THEN RAISE EXCEPTION 'contractor_payable: contractor_compensation_version_id is immutable after approval'; END IF;
    IF NEW.computed_amount                     <> OLD.computed_amount                     THEN RAISE EXCEPTION 'contractor_payable: computed_amount is immutable after approval'; END IF;
    IF NEW.currency_code                       <> OLD.currency_code                       THEN RAISE EXCEPTION 'contractor_payable: currency_code is immutable after approval'; END IF;
  END IF;

  IF OLD.payable_status = 'paid' THEN
    IF NEW.payable_status <> OLD.payable_status THEN
      RAISE EXCEPTION 'contractor_payable: cannot transition from paid status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cp_approval_guard
  BEFORE INSERT OR UPDATE ON public.contractor_payable
  FOR EACH ROW EXECUTE FUNCTION public.trg_contractor_payable_approval_guard();

-- ============================================================
-- T7: job_profitability_snapshot — compute gross_margin_percent
--     (zero-revenue guard, set to NULL if revenue = 0)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_jps_margin_percent()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.recognized_revenue_amount = 0 THEN
    NEW.gross_margin_percent := NULL;
  ELSE
    NEW.gross_margin_percent := ROUND(
      (NEW.recognized_revenue_amount - NEW.direct_labor_cost - NEW.other_direct_cost)
      / NEW.recognized_revenue_amount,
      4
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jps_margin
  BEFORE INSERT OR UPDATE ON public.job_profitability_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.trg_jps_margin_percent();

-- Immutability: revenue basis and source lineage are frozen once set
CREATE OR REPLACE FUNCTION public.trg_jps_immutability()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.operational_job_id          <> OLD.operational_job_id          THEN RAISE EXCEPTION 'job_profitability_snapshot: operational_job_id is immutable'; END IF;
  IF NEW.organization_id             <> OLD.organization_id             THEN RAISE EXCEPTION 'job_profitability_snapshot: organization_id is immutable'; END IF;
  IF NEW.recognized_revenue_amount   <> OLD.recognized_revenue_amount   THEN RAISE EXCEPTION 'job_profitability_snapshot: recognized_revenue_amount is immutable (not recalculated)'; END IF;
  IF NEW.tax_amount                  <> OLD.tax_amount                  THEN RAISE EXCEPTION 'job_profitability_snapshot: tax_amount is immutable'; END IF;
  IF NEW.currency_code               <> OLD.currency_code               THEN RAISE EXCEPTION 'job_profitability_snapshot: currency_code is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jps_immutability
  BEFORE UPDATE ON public.job_profitability_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.trg_jps_immutability();

-- ============================================================
-- T8 (A15): job_profitability_snapshot — append-only (prohibit UPDATE/DELETE)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_jps_append_only()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'job_profitability_snapshot: rows are append-only. '
      'Create a new snapshot instead of updating the existing one. '
      'Use MAX(snapshot_taken_at) per operational_job_id to find the latest.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'job_profitability_snapshot: rows are append-only and cannot be deleted. '
      'Historical profitability snapshots are retained for audit.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_jps_append_only
  BEFORE UPDATE OR DELETE ON public.job_profitability_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.trg_jps_append_only();

-- ============================================================
-- T9 (A16): Reusable cross-scope scope validator
--   Call: public.fn_assert_wave5_scope(label, org_id, bu_id, jur_id, expected_org, expected_bu, expected_jur)
--   Raises EXCEPTION if org/BU/jurisdiction do not match.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_assert_wave5_scope(
  p_label       text,
  p_org_id      uuid,
  p_bu_id       uuid,
  p_jur_id      uuid,
  p_exp_org_id  uuid,
  p_exp_bu_id   uuid,
  p_exp_jur_id  uuid
) RETURNS void LANGUAGE plpgsql AS
$$
BEGIN
  IF p_org_id IS DISTINCT FROM p_exp_org_id THEN
    RAISE EXCEPTION '% scope violation: organization_id mismatch (% vs %)',
      p_label, p_org_id, p_exp_org_id;
  END IF;
  IF p_bu_id IS DISTINCT FROM p_exp_bu_id THEN
    RAISE EXCEPTION '% scope violation: business_unit_id mismatch (% vs %)',
      p_label, p_bu_id, p_exp_bu_id;
  END IF;
  IF p_jur_id IS NOT NULL AND p_exp_jur_id IS NOT NULL
     AND p_jur_id IS DISTINCT FROM p_exp_jur_id THEN
    RAISE EXCEPTION '% scope violation: jurisdiction_id mismatch (% vs %)',
      p_label, p_jur_id, p_exp_jur_id;
  END IF;
END;
$$;

-- ============================================================
-- T10 (A1/A2): billing_readiness_gate — canonical lineage validation
--   Fires BEFORE INSERT OR UPDATE.
--   When NEW.gate_status = 'ready':
--     - operational_handoff_id must be non-null (A2)
--     - operational_job must match org/BU/jurisdiction and pricing/quote lineage
--     - work_order must belong to same job/org/BU/jurisdiction and be QA-complete
--     - operational_handoff must belong to same job/work_order with matching lineage
--     - quote_version must be accepted and reference the same pricing_snapshot
--     - at least one passed/waived qa_inspection must exist
--     - no open blocking corrective_actions
--     - cancelled jobs/work_orders cannot become ready
--     - Wave 4 enrolled work_orders must have applicability record
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_billing_readiness_gate_canonical_lineage()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_job         record;
  v_wo          record;
  v_oh          record;
  v_qv          record;
  v_qa_count    integer;
  v_ca_count    integer;
  v_w4_count    integer;
BEGIN
  -- Only validate canonical lineage when gate_status transitions to or is inserted as 'ready'
  IF NEW.gate_status <> 'ready' THEN
    RETURN NEW;
  END IF;

  -- A2: operational_handoff_id is required for a ready gate
  IF NEW.operational_handoff_id IS NULL THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff_id must be non-null when gate_status = ready. '
      'The handoff represents the canonical Wave 4 → Wave 5 boundary.';
  END IF;

  -- Validate operational_job
  SELECT oj.organization_id, oj.business_unit_id, oj.jurisdiction_id,
         oj.operational_status, oj.pricing_snapshot_id, oj.quote_version_id
  INTO v_job
  FROM public.operational_job oj
  WHERE oj.id = NEW.operational_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_readiness_gate: operational_job % not found', NEW.operational_job_id;
  END IF;

  -- A1: org/BU/jurisdiction must match job
  PERFORM public.fn_assert_wave5_scope(
    'billing_readiness_gate vs operational_job',
    NEW.organization_id, NEW.business_unit_id, NEW.jurisdiction_id,
    v_job.organization_id, v_job.business_unit_id, v_job.jurisdiction_id
  );

  -- A1: cancelled job cannot become billing ready
  IF v_job.operational_status = 'cancelled' THEN
    RAISE EXCEPTION
      'billing_readiness_gate: cancelled operational_job % cannot become billing ready',
      NEW.operational_job_id;
  END IF;

  -- A1: pricing_snapshot_id must match job
  IF v_job.pricing_snapshot_id IS DISTINCT FROM NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: pricing_snapshot_id mismatch — gate has %, operational_job has %',
      NEW.pricing_snapshot_id, v_job.pricing_snapshot_id;
  END IF;

  -- A1: quote_version_id must match job
  IF v_job.quote_version_id IS DISTINCT FROM NEW.quote_version_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: quote_version_id mismatch — gate has %, operational_job has %',
      NEW.quote_version_id, v_job.quote_version_id;
  END IF;

  -- Validate work_order
  SELECT wo.organization_id, wo.business_unit_id, wo.jurisdiction_id,
         wo.operational_job_id, wo.work_order_status
  INTO v_wo
  FROM public.work_order wo
  WHERE wo.id = NEW.work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_readiness_gate: work_order % not found', NEW.work_order_id;
  END IF;

  -- A1: work_order must belong to same operational_job
  IF v_wo.operational_job_id IS DISTINCT FROM NEW.operational_job_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: work_order % belongs to operational_job %, not %',
      NEW.work_order_id, v_wo.operational_job_id, NEW.operational_job_id;
  END IF;

  -- A1: work_order scope must match
  PERFORM public.fn_assert_wave5_scope(
    'billing_readiness_gate vs work_order',
    NEW.organization_id, NEW.business_unit_id, NEW.jurisdiction_id,
    v_wo.organization_id, v_wo.business_unit_id, v_wo.jurisdiction_id
  );

  -- A1: cancelled work_order cannot become billing ready
  IF v_wo.work_order_status = 'cancelled' THEN
    RAISE EXCEPTION
      'billing_readiness_gate: cancelled work_order % cannot become billing ready',
      NEW.work_order_id;
  END IF;

  -- A1: work_order must have completed QA
  IF v_wo.work_order_status NOT IN ('qa_complete', 'closed') THEN
    RAISE EXCEPTION
      'billing_readiness_gate: work_order % must be qa_complete or closed for billing ready (is: %)',
      NEW.work_order_id, v_wo.work_order_status;
  END IF;

  -- Validate operational_handoff (A2: required, A1: lineage)
  SELECT oh.organization_id, oh.business_unit_id,
         oh.operational_job_id, oh.work_order_id,
         oh.pricing_snapshot_id, oh.quote_version_id, oh.handoff_status
  INTO v_oh
  FROM public.operational_handoff oh
  WHERE oh.id = NEW.operational_handoff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_readiness_gate: operational_handoff % not found', NEW.operational_handoff_id;
  END IF;

  -- A1: handoff must belong to same operational_job
  IF v_oh.operational_job_id IS DISTINCT FROM NEW.operational_job_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff % belongs to job %, not %',
      NEW.operational_handoff_id, v_oh.operational_job_id, NEW.operational_job_id;
  END IF;

  -- A1: handoff must belong to same work_order
  IF v_oh.work_order_id IS DISTINCT FROM NEW.work_order_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff % belongs to work_order %, not %',
      NEW.operational_handoff_id, v_oh.work_order_id, NEW.work_order_id;
  END IF;

  -- A1: handoff pricing/quote lineage must match gate
  IF v_oh.pricing_snapshot_id IS DISTINCT FROM NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff pricing_snapshot_id mismatch (% vs gate %)',
      v_oh.pricing_snapshot_id, NEW.pricing_snapshot_id;
  END IF;

  IF v_oh.quote_version_id IS DISTINCT FROM NEW.quote_version_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff quote_version_id mismatch (% vs gate %)',
      v_oh.quote_version_id, NEW.quote_version_id;
  END IF;

  -- A1: cancelled handoff cannot close a billing gate
  IF v_oh.handoff_status = 'cancelled' THEN
    RAISE EXCEPTION
      'billing_readiness_gate: operational_handoff % is cancelled and cannot anchor a ready billing gate',
      NEW.operational_handoff_id;
  END IF;

  -- A1: Validate quote_version is accepted
  SELECT qv.lifecycle_status, qv.pricing_snapshot_id
  INTO v_qv
  FROM public.quote_version qv
  WHERE qv.id = NEW.quote_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_readiness_gate: quote_version % not found', NEW.quote_version_id;
  END IF;

  IF v_qv.lifecycle_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION
      'billing_readiness_gate: quote_version % must be accepted (lifecycle_status = %), not %',
      NEW.quote_version_id, v_qv.lifecycle_status, v_qv.lifecycle_status;
  END IF;

  -- A1: pricing_snapshot must be the one referenced by the accepted quote_version
  IF v_qv.pricing_snapshot_id IS DISTINCT FROM NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION
      'billing_readiness_gate: quote_version.pricing_snapshot_id (%) does not match gate.pricing_snapshot_id (%)',
      v_qv.pricing_snapshot_id, NEW.pricing_snapshot_id;
  END IF;

  -- A1: At least one passed or waived QA inspection must exist for this job/work_order
  --     Failed QA history is allowed when a later distinct passed/waived reinspection exists.
  SELECT COUNT(*) INTO v_qa_count
  FROM public.qa_inspection qi
  WHERE qi.operational_job_id = NEW.operational_job_id
    AND qi.work_order_id = NEW.work_order_id
    AND qi.inspection_status IN ('passed', 'waived');

  IF v_qa_count = 0 THEN
    RAISE EXCEPTION
      'billing_readiness_gate: at least one passed or waived qa_inspection must exist '
      'for operational_job % / work_order % before billing ready',
      NEW.operational_job_id, NEW.work_order_id;
  END IF;

  -- A1: No open blocking corrective_actions
  SELECT COUNT(*) INTO v_ca_count
  FROM public.corrective_action ca
  WHERE ca.operational_job_id = NEW.operational_job_id
    AND ca.action_status NOT IN ('resolved', 'verified', 'cancelled');

  IF v_ca_count > 0 THEN
    RAISE EXCEPTION
      'billing_readiness_gate: % open/unresolved corrective_action(s) exist for operational_job %. '
      'All corrective actions must be resolved, verified, or cancelled before billing ready.',
      v_ca_count, NEW.operational_job_id;
  END IF;

  -- A1: Wave 4 enrolled work_orders — applicability must be present and enrolled
  SELECT COUNT(*) INTO v_w4_count
  FROM public.work_order_wave4_applicability woa
  WHERE woa.work_order_id = NEW.work_order_id;

  IF v_w4_count > 0 THEN
    -- Wave 4 enrolled: verify the enrollment is in the expected enrolled state
    -- (applicability_status CHECK constraint already enforces this is only 'enrolled')
    -- Additional: verify org/BU/jurisdiction scope matches
    PERFORM 1
    FROM public.work_order_wave4_applicability woa
    WHERE woa.work_order_id = NEW.work_order_id
      AND woa.operational_job_id = NEW.operational_job_id
      AND woa.organization_id = NEW.organization_id
      AND woa.business_unit_id = NEW.business_unit_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'billing_readiness_gate: Wave 4 applicability record for work_order % does not match '
        'expected operational_job/org/BU scope. '
        'Wave 4 enrollment/governance close requirements not satisfied.',
        NEW.work_order_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brg_canonical_lineage
  BEFORE INSERT OR UPDATE ON public.billing_readiness_gate
  FOR EACH ROW EXECUTE FUNCTION public.trg_billing_readiness_gate_canonical_lineage();

-- ============================================================
-- T11 (A3): invoice_request — extended lineage + monetary validation
--   Extends the existing trg_invoice_request_gate_check to also verify:
--     - invoice IDs match the gate (org/BU/jur/job/work_order/handoff)
--     - pricing_snapshot_id and quote_version_id match the gate
--     - pricing_snapshot monetary values match the frozen invoice values
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_request_lineage_and_monetary_check()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_gate  record;
  v_ps    record;
BEGIN
  -- Load the gate
  SELECT brg.gate_status,
         brg.organization_id, brg.business_unit_id, brg.jurisdiction_id,
         brg.operational_job_id, brg.work_order_id, brg.operational_handoff_id,
         brg.pricing_snapshot_id, brg.quote_version_id
  INTO v_gate
  FROM public.billing_readiness_gate brg
  WHERE brg.id = NEW.billing_readiness_gate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'invoice_request: billing_readiness_gate % not found',
      NEW.billing_readiness_gate_id;
  END IF;

  -- Gate must be ready
  IF v_gate.gate_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION
      'invoice_request: billing_readiness_gate must be ready before creating invoice_request (gate status: %)',
      v_gate.gate_status;
  END IF;

  -- A3: Invoice IDs must match gate
  IF NEW.organization_id IS DISTINCT FROM v_gate.organization_id THEN
    RAISE EXCEPTION 'invoice_request: organization_id does not match billing_readiness_gate';
  END IF;
  IF NEW.business_unit_id IS DISTINCT FROM v_gate.business_unit_id THEN
    RAISE EXCEPTION 'invoice_request: business_unit_id does not match billing_readiness_gate';
  END IF;
  IF NEW.jurisdiction_id IS NOT NULL AND v_gate.jurisdiction_id IS NOT NULL
     AND NEW.jurisdiction_id IS DISTINCT FROM v_gate.jurisdiction_id THEN
    RAISE EXCEPTION 'invoice_request: jurisdiction_id does not match billing_readiness_gate';
  END IF;
  IF NEW.operational_job_id IS DISTINCT FROM v_gate.operational_job_id THEN
    RAISE EXCEPTION 'invoice_request: operational_job_id does not match billing_readiness_gate';
  END IF;
  IF NEW.work_order_id IS DISTINCT FROM v_gate.work_order_id THEN
    RAISE EXCEPTION 'invoice_request: work_order_id does not match billing_readiness_gate';
  END IF;
  IF v_gate.operational_handoff_id IS NOT NULL
     AND NEW.operational_handoff_id IS DISTINCT FROM v_gate.operational_handoff_id THEN
    RAISE EXCEPTION 'invoice_request: operational_handoff_id does not match billing_readiness_gate';
  END IF;
  IF NEW.pricing_snapshot_id IS DISTINCT FROM v_gate.pricing_snapshot_id THEN
    RAISE EXCEPTION 'invoice_request: pricing_snapshot_id does not match billing_readiness_gate';
  END IF;
  IF NEW.quote_version_id IS DISTINCT FROM v_gate.quote_version_id THEN
    RAISE EXCEPTION 'invoice_request: quote_version_id does not match billing_readiness_gate';
  END IF;

  -- A3: Pricing snapshot monetary values must match frozen invoice values
  SELECT ps.currency_code, ps.subtotal_amount, ps.tax_amount, ps.total_amount
  INTO v_ps
  FROM public.pricing_snapshot ps
  WHERE ps.id = NEW.pricing_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_request: pricing_snapshot % not found', NEW.pricing_snapshot_id;
  END IF;

  IF NEW.currency_code IS DISTINCT FROM v_ps.currency_code THEN
    RAISE EXCEPTION
      'invoice_request: currency_code % does not match pricing_snapshot currency_code %',
      NEW.currency_code, v_ps.currency_code;
  END IF;
  IF NEW.subtotal_amount IS DISTINCT FROM v_ps.subtotal_amount THEN
    RAISE EXCEPTION
      'invoice_request: subtotal_amount % does not match pricing_snapshot subtotal_amount %',
      NEW.subtotal_amount, v_ps.subtotal_amount;
  END IF;
  IF NEW.tax_amount IS DISTINCT FROM v_ps.tax_amount THEN
    RAISE EXCEPTION
      'invoice_request: tax_amount % does not match pricing_snapshot tax_amount %',
      NEW.tax_amount, v_ps.tax_amount;
  END IF;
  IF NEW.total_amount IS DISTINCT FROM v_ps.total_amount THEN
    RAISE EXCEPTION
      'invoice_request: total_amount % does not match pricing_snapshot total_amount %',
      NEW.total_amount, v_ps.total_amount;
  END IF;

  -- A3: Validate no duplicate active invoice for this job (exclude void/cancelled)
  IF EXISTS (
    SELECT 1 FROM public.invoice_request ir
    WHERE ir.operational_job_id = NEW.operational_job_id
      AND ir.id IS DISTINCT FROM NEW.id
      AND ir.request_status NOT IN ('void', 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'invoice_request: duplicate active invoice_request for operational_job_id %',
      NEW.operational_job_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ir_lineage_and_monetary_check
  BEFORE INSERT ON public.invoice_request
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_request_lineage_and_monetary_check();

-- ============================================================
-- T12 (A12): contractor_payable — DB eligibility validation
--   Validates exact lineage and eligibility before INSERT.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_contractor_payable_eligibility()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_wa    record;
  v_oj    record;
  v_wo    record;
  v_ccv   record;
  v_expected_amount numeric(12,2);
BEGIN
  -- Load worker_assignment
  SELECT wa.worker_id, wa.operational_job_id, wa.organization_id,
         wa.business_unit_id, wa.assignment_status,
         wa.assigned_at, wa.acknowledged_at
  INTO v_wa
  FROM public.worker_assignment wa
  WHERE wa.id = NEW.worker_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contractor_payable: worker_assignment % not found', NEW.worker_assignment_id;
  END IF;

  -- A12: worker_assignment.worker_id must match payable.worker_id
  IF v_wa.worker_id IS DISTINCT FROM NEW.worker_id THEN
    RAISE EXCEPTION
      'contractor_payable: worker_id % does not match worker_assignment.worker_id %',
      NEW.worker_id, v_wa.worker_id;
  END IF;

  -- A12: worker_assignment.operational_job_id must match payable
  IF v_wa.operational_job_id IS DISTINCT FROM NEW.operational_job_id THEN
    RAISE EXCEPTION
      'contractor_payable: operational_job_id % does not match worker_assignment.operational_job_id %',
      NEW.operational_job_id, v_wa.operational_job_id;
  END IF;

  -- A12: org/BU must match
  IF v_wa.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'contractor_payable: organization_id does not match worker_assignment';
  END IF;
  IF v_wa.business_unit_id IS DISTINCT FROM NEW.business_unit_id THEN
    RAISE EXCEPTION 'contractor_payable: business_unit_id does not match worker_assignment';
  END IF;

  -- A12: assignment must be in eligible state (acknowledged or completed)
  IF v_wa.assignment_status NOT IN ('acknowledged', 'completed', 'service_complete') THEN
    RAISE EXCEPTION
      'contractor_payable: worker_assignment % is not in an eligible state for payable (status: %)',
      NEW.worker_assignment_id, v_wa.assignment_status;
  END IF;

  -- Load operational_job
  SELECT oj.organization_id, oj.business_unit_id,
         oj.operational_status
  INTO v_oj
  FROM public.operational_job oj
  WHERE oj.id = NEW.operational_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contractor_payable: operational_job % not found', NEW.operational_job_id;
  END IF;

  -- A12: job must be at required QA-complete state
  IF v_oj.operational_status NOT IN ('service_complete', 'qa_pending', 'qa_passed', 'closed') THEN
    RAISE EXCEPTION
      'contractor_payable: operational_job % must be service_complete or later for payable (status: %)',
      NEW.operational_job_id, v_oj.operational_status;
  END IF;

  -- Load work_order
  SELECT wo.operational_job_id, wo.organization_id, wo.business_unit_id
  INTO v_wo
  FROM public.work_order wo
  WHERE wo.id = NEW.work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contractor_payable: work_order % not found', NEW.work_order_id;
  END IF;

  -- A12: work_order must belong to same operational_job
  IF v_wo.operational_job_id IS DISTINCT FROM NEW.operational_job_id THEN
    RAISE EXCEPTION
      'contractor_payable: work_order % belongs to job %, not %',
      NEW.work_order_id, v_wo.operational_job_id, NEW.operational_job_id;
  END IF;

  -- Load contractor_compensation_version
  SELECT ccv.worker_id, ccv.organization_id, ccv.business_unit_id,
         ccv.compensation_status, ccv.compensation_method, ccv.currency_code,
         ccv.rate_value, ccv.effective_from, ccv.effective_to
  INTO v_ccv
  FROM public.contractor_compensation_version ccv
  WHERE ccv.id = NEW.contractor_compensation_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'contractor_payable: contractor_compensation_version % not found',
      NEW.contractor_compensation_version_id;
  END IF;

  -- A12: compensation version must belong to same worker
  IF v_ccv.worker_id IS DISTINCT FROM NEW.worker_id THEN
    RAISE EXCEPTION
      'contractor_payable: contractor_compensation_version worker_id % does not match payable worker_id %',
      v_ccv.worker_id, NEW.worker_id;
  END IF;

  -- A12: compensation version must belong to same org/BU
  IF v_ccv.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'contractor_payable: contractor_compensation_version organization_id mismatch';
  END IF;
  IF v_ccv.business_unit_id IS DISTINCT FROM NEW.business_unit_id THEN
    RAISE EXCEPTION 'contractor_payable: contractor_compensation_version business_unit_id mismatch';
  END IF;

  -- A12: compensation version must be approved or active
  IF v_ccv.compensation_status NOT IN ('approved', 'active') THEN
    RAISE EXCEPTION
      'contractor_payable: contractor_compensation_version % must be approved or active (is: %)',
      NEW.contractor_compensation_version_id, v_ccv.compensation_status;
  END IF;

  -- A12: currency and method must match compensation version
  IF NEW.currency_code IS DISTINCT FROM v_ccv.currency_code THEN
    RAISE EXCEPTION
      'contractor_payable: currency_code % does not match compensation_version currency_code %',
      NEW.currency_code, v_ccv.currency_code;
  END IF;
  IF NEW.compensation_method IS DISTINCT FROM v_ccv.compensation_method THEN
    RAISE EXCEPTION
      'contractor_payable: compensation_method % does not match compensation_version compensation_method %',
      NEW.compensation_method, v_ccv.compensation_method;
  END IF;

  -- A12: No open blocking corrective_actions
  IF EXISTS (
    SELECT 1 FROM public.corrective_action ca
    WHERE ca.operational_job_id = NEW.operational_job_id
      AND ca.action_status NOT IN ('resolved', 'verified', 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'contractor_payable: open corrective_action(s) exist for operational_job % — '
      'contractor pay is held pending resolution',
      NEW.operational_job_id;
  END IF;

  -- A12: Validate computed_amount is derived from frozen compensation version
  --   flat_amount: computed_amount = rate_value
  --   hourly:      computed_amount = round(rate_value * basis_value, 2)
  --   percentage:  computed_amount = round(rate_value * basis_value, 2)
  IF v_ccv.compensation_method = 'flat_amount' THEN
    v_expected_amount := ROUND(v_ccv.rate_value, 2);
  ELSE
    v_expected_amount := ROUND(v_ccv.rate_value * NEW.basis_value, 2);
  END IF;

  IF NEW.computed_amount IS DISTINCT FROM v_expected_amount THEN
    RAISE EXCEPTION
      'contractor_payable: computed_amount % does not match DB-authoritative calculation % '
      '(method=%, rate=%, basis=%)',
      NEW.computed_amount, v_expected_amount,
      v_ccv.compensation_method, v_ccv.rate_value, NEW.basis_value;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cp_eligibility
  BEFORE INSERT ON public.contractor_payable
  FOR EACH ROW EXECUTE FUNCTION public.trg_contractor_payable_eligibility();

-- ============================================================
-- T13 (A13): contractor_compensation_version — self-approval prevention
--   Mirrors the contractor_payable self-approval guard.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_ccv_self_approval_guard()
  RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  v_worker_app_user_id uuid;
BEGIN
  IF NEW.approved_by_app_user_id IS NOT NULL
     AND (OLD.approved_by_app_user_id IS NULL
          OR OLD.approved_by_app_user_id IS DISTINCT FROM NEW.approved_by_app_user_id)
  THEN
    SELECT w.app_user_id INTO v_worker_app_user_id
    FROM public.worker w
    WHERE w.id = NEW.worker_id;

    IF v_worker_app_user_id IS NOT NULL
       AND v_worker_app_user_id = NEW.approved_by_app_user_id THEN
      RAISE EXCEPTION
        'contractor_compensation_version: worker may not approve their own compensation version '
        '(worker_id=%, approved_by_app_user_id=%)',
        NEW.worker_id, NEW.approved_by_app_user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ccv_self_approval_guard
  BEFORE UPDATE ON public.contractor_compensation_version
  FOR EACH ROW EXECUTE FUNCTION public.trg_ccv_self_approval_guard();

-- ============================================================
-- T14 (A14): contractor_payable — status lifecycle transition guard
--   Enforces allowed transitions in DB:
--     pending  → approved | voided     (not directly to paid)
--     approved → paid     | voided
--     paid     → (terminal, no further transitions)
--     voided   → (terminal, no further transitions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_contractor_payable_status_lifecycle()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.payable_status = NEW.payable_status THEN
    RETURN NEW; -- no change
  END IF;

  CASE OLD.payable_status
    WHEN 'pending' THEN
      IF NEW.payable_status NOT IN ('approved', 'voided') THEN
        RAISE EXCEPTION
          'contractor_payable: invalid status transition pending → % '
          '(allowed: approved, voided)',
          NEW.payable_status;
      END IF;
    WHEN 'approved' THEN
      IF NEW.payable_status NOT IN ('paid', 'voided') THEN
        RAISE EXCEPTION
          'contractor_payable: invalid status transition approved → % '
          '(allowed: paid, voided)',
          NEW.payable_status;
      END IF;
    WHEN 'paid' THEN
      RAISE EXCEPTION
        'contractor_payable: paid is a terminal status — no further transitions allowed';
    WHEN 'voided' THEN
      RAISE EXCEPTION
        'contractor_payable: voided is a terminal status — no further transitions allowed';
    ELSE
      RAISE EXCEPTION
        'contractor_payable: unknown payable_status % in transition guard',
        OLD.payable_status;
  END CASE;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cp_status_lifecycle
  BEFORE UPDATE ON public.contractor_payable
  FOR EACH ROW EXECUTE FUNCTION public.trg_contractor_payable_status_lifecycle();

-- ---------------------------------------------------------------------------
-- SECTION 4: ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.billing_readiness_gate          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_request                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sync_outbox          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_observation             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compensation_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_payable              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_profitability_snapshot      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SECTION 5: REVOKE anon
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.billing_readiness_gate          FROM anon;
REVOKE ALL ON public.invoice_request                 FROM anon;
REVOKE ALL ON public.accounting_sync_outbox          FROM anon;
REVOKE ALL ON public.payment_observation             FROM anon;
REVOKE ALL ON public.contractor_compensation_version FROM anon;
REVOKE ALL ON public.contractor_payable              FROM anon;
REVOKE ALL ON public.job_profitability_snapshot      FROM anon;

-- ---------------------------------------------------------------------------
-- SECTION 6: GRANTS to authenticated
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public.billing_readiness_gate          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invoice_request                 TO authenticated;
-- A5: accounting_sync_outbox — SELECT only for authenticated; INSERT/UPDATE is service_role only via server API
GRANT SELECT                 ON public.accounting_sync_outbox          TO authenticated;
-- A11: payment_observation — SELECT only for authenticated; INSERT is service_role only (Stripe webhook)
GRANT SELECT                 ON public.payment_observation             TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contractor_compensation_version TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contractor_payable              TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_profitability_snapshot      TO authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 7: RLS POLICIES
-- ---------------------------------------------------------------------------

-- ── billing_readiness_gate ────────────────────────────────────────────────────

CREATE POLICY pol_brg_owner_admin_all ON public.billing_readiness_gate
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_brg_office_ops_select ON public.billing_readiness_gate
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_brg_office_ops_insert ON public.billing_readiness_gate
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ── invoice_request ────────────────────────────────────────────────────────────

CREATE POLICY pol_ir_owner_admin_all ON public.invoice_request
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_ir_office_ops_select ON public.invoice_request
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

CREATE POLICY pol_ir_office_ops_insert ON public.invoice_request
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ── accounting_sync_outbox ────────────────────────────────────────────────────
-- Server-side only; no RLS policy for worker or qa.

-- A5: accounting_sync_outbox — SELECT only for authenticated roles.
-- INSERT/UPDATE is exclusively via service_role through the governed server API.

CREATE POLICY pol_aso_owner_admin_select ON public.accounting_sync_outbox
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_aso_office_ops_select ON public.accounting_sync_outbox
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ── payment_observation ────────────────────────────────────────────────────────
-- A11: payment_observation — SELECT only for authenticated roles.
-- INSERT is exclusively via service_role through the Stripe webhook server handler.

CREATE POLICY pol_po_owner_admin_select ON public.payment_observation
  FOR SELECT TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_po_office_ops_select ON public.payment_observation
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ── contractor_compensation_version ───────────────────────────────────────────

CREATE POLICY pol_ccv_owner_admin_all ON public.contractor_compensation_version
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

-- Worker may read only their own compensation version
CREATE POLICY pol_ccv_worker_own_select ON public.contractor_compensation_version
  FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id(organization_id));

-- ── contractor_payable ─────────────────────────────────────────────────────────

CREATE POLICY pol_cp_owner_admin_all ON public.contractor_payable
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

-- Worker may read only their own payable
CREATE POLICY pol_cp_worker_own_select ON public.contractor_payable
  FOR SELECT TO authenticated
  USING (worker_id = public.current_worker_id(organization_id));

-- ── job_profitability_snapshot ─────────────────────────────────────────────────

CREATE POLICY pol_jps_owner_admin_all ON public.job_profitability_snapshot
  FOR ALL TO authenticated
  USING  (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']))
  WITH CHECK (public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin']));

CREATE POLICY pol_jps_office_ops_select ON public.job_profitability_snapshot
  FOR SELECT TO authenticated
  USING (public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops']));

-- ---------------------------------------------------------------------------
-- SECTION 8: SELF-VALIDATION (fail-fast structural checks)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
  v_constraint_name text;
  v_trigger_name text;
  v_policy_name text;
BEGIN

  -- [SV-1] All 7 Wave 5 tables exist
  FOR v_constraint_name IN
    SELECT t FROM unnest(ARRAY[
      'billing_readiness_gate',
      'invoice_request',
      'accounting_sync_outbox',
      'payment_observation',
      'contractor_compensation_version',
      'contractor_payable',
      'job_profitability_snapshot'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = v_constraint_name;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M012 SV-1 FAIL: table public.% not found', v_constraint_name;
    END IF;
  END LOOP;

  -- [SV-2] RLS enabled on all 7 tables
  FOR v_constraint_name IN
    SELECT t FROM unnest(ARRAY[
      'billing_readiness_gate',
      'invoice_request',
      'accounting_sync_outbox',
      'payment_observation',
      'contractor_compensation_version',
      'contractor_payable',
      'job_profitability_snapshot'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = v_constraint_name
      AND c.relrowsecurity = true;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M012 SV-2 FAIL: RLS not enabled on public.%', v_constraint_name;
    END IF;
  END LOOP;

  -- [SV-3] Critical UNIQUE constraints exist
  FOR v_constraint_name IN
    SELECT c FROM unnest(ARRAY[
      'uq_brg_job',
      'uq_ir_job',
      'uq_aso_idempotency',
      'uq_po_provider_event',
      'uq_ccv_worker_version',
      'uq_cp_assignment_compensation',
      'uq_jps_job'
    ]) c
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_constraint
    WHERE conname = v_constraint_name
      AND contype = 'u';
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M012 SV-3 FAIL: UNIQUE constraint % not found', v_constraint_name;
    END IF;
  END LOOP;

  -- [SV-4] Critical triggers exist
  FOR v_trigger_name IN
    SELECT t FROM unnest(ARRAY[
      'trg_brg_immutability',
      'trg_brg_canonical_lineage',
      'trg_ir_immutability',
      'trg_ir_gate_check',
      'trg_ir_lineage_and_monetary_check',
      'trg_aso_production_guard',
      'trg_aso_immutability',
      'trg_po_immutability',
      'trg_ccv_immutability',
      'trg_ccv_self_approval_guard',
      'trg_cp_approval_guard',
      'trg_cp_eligibility',
      'trg_cp_status_lifecycle',
      'trg_jps_margin',
      'trg_jps_immutability',
      'trg_jps_append_only'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_trigger
    WHERE tgname = v_trigger_name;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M012 SV-4 FAIL: trigger % not found', v_trigger_name;
    END IF;
  END LOOP;

  -- [SV-5] anon has no privileges on any Wave 5 table
  FOR v_constraint_name IN
    SELECT t FROM unnest(ARRAY[
      'billing_readiness_gate',
      'invoice_request',
      'accounting_sync_outbox',
      'payment_observation',
      'contractor_compensation_version',
      'contractor_payable',
      'job_profitability_snapshot'
    ]) t
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name   = v_constraint_name
      AND grantee      = 'anon';
    IF v_count > 0 THEN
      RAISE EXCEPTION 'M012 SV-5 FAIL: anon has privileges on public.%', v_constraint_name;
    END IF;
  END LOOP;

  -- [SV-6] owner_admin/select policies exist for all tables
  FOR v_policy_name IN
    SELECT p FROM unnest(ARRAY[
      'pol_brg_owner_admin_all',
      'pol_ir_owner_admin_all',
      'pol_aso_owner_admin_select',
      'pol_po_owner_admin_select',
      'pol_ccv_owner_admin_all',
      'pol_cp_owner_admin_all',
      'pol_jps_owner_admin_all'
    ]) p
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = v_policy_name;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'M012 SV-6 FAIL: policy % not found', v_policy_name;
    END IF;
  END LOOP;

  -- [SV-7] Worker self-read policies exist
  SELECT COUNT(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'pol_ccv_worker_own_select';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-7 FAIL: pol_ccv_worker_own_select not found';
  END IF;

  SELECT COUNT(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'pol_cp_worker_own_select';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-7 FAIL: pol_cp_worker_own_select not found';
  END IF;

  -- [SV-8] gross_contribution is a generated column
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'job_profitability_snapshot'
    AND column_name  = 'gross_contribution'
    AND is_generated = 'ALWAYS';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-8 FAIL: job_profitability_snapshot.gross_contribution is not a GENERATED ALWAYS column';
  END IF;

  -- [SV-9] No Wave 1–4 tables altered
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'configuration_version', 'operational_job', 'work_order',
        'worker_assignment', 'qa_inspection', 'operational_handoff',
        'required_evidence_policy', 'work_order_governance_link'
      )
  ) THEN
    -- Tables exist (expected), now verify this migration did not add any
    -- unexpected NEW columns to them (spot-check wave5 naming patterns)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('operational_job', 'work_order', 'qa_inspection')
        AND column_name LIKE 'wave5_%'
    ) THEN
      RAISE EXCEPTION 'M012 SV-9 FAIL: unexpected wave5_* column found on a Wave 1-4 table';
    END IF;
  END IF;

  -- [SV-10] Check FK from invoice_request to billing_readiness_gate exists
  SELECT COUNT(*) INTO v_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
  WHERE rc.constraint_schema = 'public'
    AND kcu.table_name = 'invoice_request'
    AND kcu.column_name = 'billing_readiness_gate_id';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-10 FAIL: FK from invoice_request.billing_readiness_gate_id not found';
  END IF;

  -- [SV-11] billing_readiness_gate canonical lineage trigger function exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'trg_billing_readiness_gate_canonical_lineage'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-11 FAIL: trg_billing_readiness_gate_canonical_lineage() function not found — A1/A2 canonical lineage guard missing';
  END IF;

  -- [SV-12] invoice_request lineage+monetary trigger function exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'trg_invoice_request_lineage_and_monetary_check'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-12 FAIL: trg_invoice_request_lineage_and_monetary_check() function not found — A3 invoice lineage guard missing';
  END IF;

  -- [SV-13] accounting_sync_outbox has no INSERT/UPDATE grant for authenticated
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name   = 'accounting_sync_outbox'
    AND grantee      = 'authenticated'
    AND privilege_type IN ('INSERT', 'UPDATE');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M012 SV-13 FAIL: authenticated role has INSERT/UPDATE on accounting_sync_outbox — A5 server-only boundary violation';
  END IF;

  -- [SV-14] payment_observation has no INSERT grant for authenticated
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name   = 'payment_observation'
    AND grantee      = 'authenticated'
    AND privilege_type IN ('INSERT', 'UPDATE');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M012 SV-14 FAIL: authenticated role has INSERT/UPDATE on payment_observation — A11 server-only boundary violation';
  END IF;

  -- [SV-15] contractor_payable eligibility trigger function exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'trg_contractor_payable_eligibility'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-15 FAIL: trg_contractor_payable_eligibility() function not found — A12 payable DB eligibility guard missing';
  END IF;

  -- [SV-16] contractor_compensation_version self-approval guard exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'trg_ccv_self_approval_guard'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-16 FAIL: trg_ccv_self_approval_guard() function not found — A13 compensation self-approval guard missing';
  END IF;

  -- [SV-17] contractor_payable status lifecycle trigger exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'trg_contractor_payable_status_lifecycle'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-17 FAIL: trg_contractor_payable_status_lifecycle() function not found — A14 payable status lifecycle guard missing';
  END IF;

  -- [SV-18] job_profitability_snapshot has NO UNIQUE(operational_job_id) constraint (append-only)
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints
  WHERE table_schema     = 'public'
    AND table_name       = 'job_profitability_snapshot'
    AND constraint_name  = 'uq_jps_job'
    AND constraint_type  = 'UNIQUE';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M012 SV-18 FAIL: uq_jps_job UNIQUE constraint still exists — A15 append-only model requires its removal';
  END IF;

  -- [SV-19] append-only trigger on job_profitability_snapshot exists
  SELECT COUNT(*) INTO v_count
  FROM pg_trigger
  WHERE tgname = 'trg_jps_append_only';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-19 FAIL: trg_jps_append_only trigger not found — A15 append-only enforcement missing';
  END IF;

  -- [SV-20] cross-scope helper function fn_assert_wave5_scope exists
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'fn_assert_wave5_scope'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M012 SV-20 FAIL: fn_assert_wave5_scope() function not found — A16 cross-scope integrity helper missing';
  END IF;

END;
$$;

-- Final deterministic result
SELECT 'M012_WAVE5_FINANCE_PASS'::text AS result;

COMMIT;
