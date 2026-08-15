// =============================================================================
// STATIC SQL CONTRACT TESTS — Wave 5 Migration 012_wave5_finance.sql
// Inspects the migration source without executing it.
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const migrationPath = resolve(ROOT, "supabase/migrations/012_wave5_finance.sql");
const sql = readFileSync(migrationPath, "utf8");

// ── 1. All 7 Wave 5 tables are created ────────────────────────────────────────
test("1. migration creates billing_readiness_gate", () => {
  assert.ok(/CREATE TABLE public\.billing_readiness_gate/.test(sql));
});
test("2. migration creates invoice_request", () => {
  assert.ok(/CREATE TABLE public\.invoice_request/.test(sql));
});
test("3. migration creates accounting_sync_outbox", () => {
  assert.ok(/CREATE TABLE public\.accounting_sync_outbox/.test(sql));
});
test("4. migration creates payment_observation", () => {
  assert.ok(/CREATE TABLE public\.payment_observation/.test(sql));
});
test("5. migration creates contractor_compensation_version", () => {
  assert.ok(/CREATE TABLE public\.contractor_compensation_version/.test(sql));
});
test("6. migration creates contractor_payable", () => {
  assert.ok(/CREATE TABLE public\.contractor_payable/.test(sql));
});
test("7. migration creates job_profitability_snapshot", () => {
  assert.ok(/CREATE TABLE public\.job_profitability_snapshot/.test(sql));
});

// ── 2. RLS enabled on all tables ─────────────────────────────────────────────
test("8. RLS enabled on all 7 Wave 5 tables", () => {
  const tables = [
    "billing_readiness_gate",
    "invoice_request",
    "accounting_sync_outbox",
    "payment_observation",
    "contractor_compensation_version",
    "contractor_payable",
    "job_profitability_snapshot",
  ];
  for (const t of tables) {
    assert.ok(
      new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(sql),
      `RLS not enabled on ${t}`
    );
  }
});

// ── 3. anon revoked on all tables ─────────────────────────────────────────────
test("9. anon REVOKED on all 7 Wave 5 tables", () => {
  const tables = [
    "billing_readiness_gate",
    "invoice_request",
    "accounting_sync_outbox",
    "payment_observation",
    "contractor_compensation_version",
    "contractor_payable",
    "job_profitability_snapshot",
  ];
  for (const t of tables) {
    assert.ok(
      new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon`).test(sql),
      `anon not revoked on ${t}`
    );
  }
});

// ── 4. Critical UNIQUE constraints ────────────────────────────────────────────
test("10. uq_brg_job UNIQUE constraint exists", () => {
  assert.ok(/uq_brg_job/.test(sql));
});
test("11. uq_ir_job UNIQUE constraint exists (invoice per job)", () => {
  assert.ok(/uq_ir_job/.test(sql));
});
test("12. uq_aso_idempotency UNIQUE constraint exists (idempotent outbox)", () => {
  assert.ok(/uq_aso_idempotency/.test(sql));
});
test("13. uq_po_provider_event UNIQUE constraint exists (no duplicate payment events)", () => {
  assert.ok(/uq_po_provider_event/.test(sql));
});
test("14. uq_ccv_worker_version UNIQUE constraint exists", () => {
  assert.ok(/uq_ccv_worker_version/.test(sql));
});
test("15. uq_cp_assignment_compensation UNIQUE constraint exists (no duplicate payable)", () => {
  assert.ok(/uq_cp_assignment_compensation/.test(sql));
});
test("16. uq_jps_job UNIQUE constraint exists (one profitability snapshot per job)", () => {
  assert.ok(/uq_jps_job/.test(sql));
});

// ── 5. Idempotency and production guard triggers ───────────────────────────────
test("17. invoice_request billing gate check trigger exists", () => {
  assert.ok(/trg_ir_gate_check/.test(sql));
});
test("18. accounting_sync_outbox production guard trigger exists", () => {
  assert.ok(/trg_aso_production_guard/.test(sql));
});
test("19. production guard rejects is_test_adapter in production environment", () => {
  assert.ok(
    sql.includes("is_test_adapter = true") &&
    sql.includes("production") &&
    sql.includes("PROHIBITED in Production")
  );
});
test("20. fabricated QB-timestamp IDs rejected by production guard trigger", () => {
  assert.ok(
    sql.includes("QB-") &&
    /provider_reference_id.*LIKE.*QB.*\[\^\]/.test(sql) ||
    /provider_reference_id.*~.*QB-\[0-9\]/.test(sql)
  );
});

// ── 6. Immutability triggers ───────────────────────────────────────────────────
test("21. invoice_request monetary immutability trigger exists", () => {
  assert.ok(/trg_ir_immutability/.test(sql));
});
test("22. invoice_request monetary fields listed as immutable after acknowledgment", () => {
  assert.ok(
    sql.includes("subtotal_amount") &&
    sql.includes("tax_amount") &&
    sql.includes("total_amount") &&
    sql.includes("immutable after acknowledgment")
  );
});
test("23. contractor_compensation_version immutability trigger exists", () => {
  assert.ok(/trg_ccv_immutability/.test(sql));
});
test("24. contractor_payable self-approval guard trigger exists", () => {
  assert.ok(/trg_cp_approval_guard/.test(sql));
});
test("25. worker self-approval prevented (trigger checks app_user_id)", () => {
  assert.ok(
    sql.includes("worker may not approve their own payable") ||
    sql.includes("worker may not approve")
  );
});
test("26. payment_observation immutability trigger exists", () => {
  assert.ok(/trg_po_immutability/.test(sql));
});
test("27. job_profitability_snapshot immutability trigger prevents revenue rewrite", () => {
  assert.ok(
    sql.includes("recognized_revenue_amount is immutable") ||
    sql.includes("recognized_revenue_amount.*immutable")
  );
});

// ── 7. gross_contribution is GENERATED STORED ─────────────────────────────────
test("28. gross_contribution is a GENERATED ALWAYS AS STORED column", () => {
  assert.ok(
    /gross_contribution.*GENERATED ALWAYS AS/.test(sql),
    "gross_contribution must be GENERATED ALWAYS AS"
  );
  assert.ok(/STORED/.test(sql));
});

// ── 8. Divide-by-zero guard in margin trigger ─────────────────────────────────
test("29. gross_margin_percent trigger handles zero-revenue guard (NULL on zero)", () => {
  assert.ok(
    sql.includes("recognized_revenue_amount = 0") &&
    (sql.includes("NULL") || sql.includes("null")),
    "Zero-revenue guard must set gross_margin_percent to NULL"
  );
});

// ── 9. owner_admin policies on all 7 tables ───────────────────────────────────
test("30. owner_admin policies exist for all 7 tables", () => {
  const policies = [
    "pol_brg_owner_admin_all",
    "pol_ir_owner_admin_all",
    "pol_aso_owner_admin_all",
    "pol_po_owner_admin_all",
    "pol_ccv_owner_admin_all",
    "pol_cp_owner_admin_all",
    "pol_jps_owner_admin_all",
  ];
  for (const p of policies) {
    assert.ok(sql.includes(p), `Policy ${p} not found`);
  }
});

// ── 10. Worker self-read policies ─────────────────────────────────────────────
test("31. worker own compensation_version read policy exists", () => {
  assert.ok(sql.includes("pol_ccv_worker_own_select"));
});
test("32. worker own payable read policy exists", () => {
  assert.ok(sql.includes("pol_cp_worker_own_select"));
});

// ── 11. invoice_request requires ready billing gate (trigger) ──────────────────
test("33. invoice_request gate_check trigger verifies billing_readiness_gate = ready", () => {
  assert.ok(
    sql.includes("gate_status") &&
    sql.includes("must be ready before creating invoice_request")
  );
});

// ── 12. Duplicate active invoice prevention ────────────────────────────────────
test("34. duplicate active invoice_request for same job is prevented", () => {
  assert.ok(
    sql.includes("duplicate active invoice_request")
  );
});

// ── 13. Self-validation block and final result ─────────────────────────────────
test("35. migration has self-validation DO block", () => {
  assert.ok(sql.includes("M012 SV-"));
});
test("36. migration emits M012_WAVE5_FINANCE_PASS result", () => {
  assert.ok(sql.includes("M012_WAVE5_FINANCE_PASS"));
});

// ── 14. No Wave 1–4 table alteration ──────────────────────────────────────────
test("37. migration does not ALTER Wave 1-4 tables", () => {
  const forbidden = [
    /ALTER TABLE public\.operational_job\b/,
    /ALTER TABLE public\.work_order\b/,
    /ALTER TABLE public\.qa_inspection\b/,
    /ALTER TABLE public\.configuration_version\b/,
    /ALTER TABLE public\.required_evidence_policy\b/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(sql),
      `Migration must not ALTER Wave 1-4 table: ${pattern}`
    );
  }
});

// ── 15. Migration wraps in BEGIN/COMMIT ───────────────────────────────────────
test("38. migration is wrapped in BEGIN/COMMIT", () => {
  assert.ok(/^\s*BEGIN\s*;/m.test(sql), "Missing BEGIN;");
  assert.ok(/^\s*COMMIT\s*;/m.test(sql), "Missing COMMIT;");
});

// ── 16. FK from invoice_request to billing_readiness_gate ─────────────────────
test("39. invoice_request has FK to billing_readiness_gate", () => {
  assert.ok(
    /fk_ir_billing_readiness_gate/.test(sql) ||
    /billing_readiness_gate_id.*REFERENCES.*billing_readiness_gate/.test(sql)
  );
});

// ── 17. Compensation method check constraint ─────────────────────────────────
test("40. contractor_compensation_version has method check (flat_amount, hourly, percentage)", () => {
  assert.ok(
    sql.includes("flat_amount") &&
    sql.includes("hourly") &&
    sql.includes("percentage") &&
    sql.includes("compensation_method")
  );
});

// ── 18. Percentage range constraint ──────────────────────────────────────────
test("41. percentage rate must be in [0,1] check constraint", () => {
  assert.ok(
    sql.includes("ck_ccv_percentage_range") ||
    sql.includes("percentage") && sql.includes("rate_value >= 0") && sql.includes("rate_value <= 1")
  );
});
