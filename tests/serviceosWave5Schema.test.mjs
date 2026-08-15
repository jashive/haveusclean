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
test("16. uq_jps_job UNIQUE constraint is NOT in SV-3 required ARRAY list (SV-3/SV-18 non-contradiction)", () => {
  // SV-3 requires UNIQUE constraints that should exist.
  // uq_jps_job must NOT appear in the SV-3 required ARRAY because SV-18 asserts it is absent.
  // Extract the SV-3 block: between [SV-3] comment and [SV-4] comment.
  const sv3Match = sql.match(/\[SV-3\][\s\S]*?(?=\[SV-4\])/);
  assert.ok(sv3Match, "SV-3 block must exist in migration");
  const sv3Block = sv3Match[0];
  // Check specifically the ARRAY[] list — comments mentioning uq_jps_job are acceptable.
  const arrayMatch = sv3Block.match(/ARRAY\[[\s\S]*?\]/);
  assert.ok(arrayMatch, "SV-3 must contain an ARRAY[] list of required UNIQUE constraints");
  assert.ok(
    !arrayMatch[0].includes("uq_jps_job"),
    "SV-3 ARRAY list must NOT include uq_jps_job — SV-18 requires it to be absent"
  );
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
    // A5: aso and po are SELECT-only for owner_admin (server-only mutation)
    "pol_aso_owner_admin_select",
    "pol_po_owner_admin_select",
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

// ── 19. SV-3 / SV-18 non-contradiction ──────────────────────────────────────
test("42. SV-18 requires uq_jps_job to be ABSENT (append-only model)", () => {
  // SV-18 must assert that uq_jps_job does not exist (A15 append-only requirement).
  const sv18Match = sql.match(/\[SV-18\][\s\S]*?(?=\[SV-19\])/);
  assert.ok(sv18Match, "SV-18 block must exist in migration");
  const sv18Block = sv18Match[0];
  assert.ok(
    sv18Block.includes("uq_jps_job"),
    "SV-18 must reference uq_jps_job"
  );
  assert.ok(
    sv18Block.includes("SV-18 FAIL") &&
    (sv18Block.includes("still exists") || sv18Block.includes("UNIQUE constraint still exists")),
    "SV-18 must fail when uq_jps_job still exists"
  );
});

test("43. SV-3 and SV-18 are non-contradictory (SV-3 ARRAY excludes uq_jps_job, SV-18 requires absent)", () => {
  const sv3Match = sql.match(/\[SV-3\][\s\S]*?(?=\[SV-4\])/);
  const sv18Match = sql.match(/\[SV-18\][\s\S]*?(?=\[SV-19\])/);
  assert.ok(sv3Match && sv18Match, "Both SV-3 and SV-18 blocks must exist");
  // SV-3 ARRAY[] list must not list uq_jps_job (would contradict SV-18).
  const sv3ArrayMatch = sv3Match[0].match(/ARRAY\[[\s\S]*?\]/);
  assert.ok(sv3ArrayMatch, "SV-3 must contain an ARRAY[] list");
  assert.ok(!sv3ArrayMatch[0].includes("uq_jps_job"), "SV-3 ARRAY must not list uq_jps_job");
  // SV-18 must assert the constraint is absent
  assert.ok(sv18Match[0].includes("uq_jps_job"), "SV-18 must reference uq_jps_job absence");
});

// ── 20. contractor_payable eligibility trigger: correct statuses ──────────────
test("44. trg_contractor_payable_eligibility requires assignment_status = 'completed' only", () => {
  // 'service_complete' is not a real worker_assignment status — must not appear as allowed.
  // 'acknowledged' is not sufficient — only 'completed' proves work is actually done.
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("'completed'"),
    "trigger must accept completed assignment_status"
  );
  // The assignment_status check must require exactly 'completed' — check the actual comparison.
  // Trigger must use assignment_status <> 'completed' (single required status), not a NOT IN list
  // with extra statuses like 'service_complete' or 'acknowledged'.
  assert.ok(
    fn.includes("assignment_status <> 'completed'") ||
    fn.includes("assignment_status != 'completed'") ||
    (fn.includes("assignment_status") && !fn.match(/assignment_status NOT IN \([^)]*'service_complete'/)),
    "trigger assignment_status check must not allow 'service_complete'"
  );
  // The trigger must not include 'service_complete' in an allowed assignment_status list.
  const assignStatusNotInMatch = fn.match(/assignment_status NOT IN \([^)]+\)/);
  if (assignStatusNotInMatch) {
    assert.ok(
      !assignStatusNotInMatch[0].includes("service_complete"),
      "assignment_status NOT IN list must not include service_complete — not a valid wave3 status"
    );
  }
});

test("45. trg_contractor_payable_eligibility requires operational_status qa_passed or closed only", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(fn.includes("'qa_passed'"), "trigger must require qa_passed");
  assert.ok(fn.includes("'closed'"), "trigger must allow closed");
  assert.ok(
    !fn.match(/'qa_pending'.*operational_status|operational_status.*'qa_pending'/),
    "trigger must not allow qa_pending for operational_status"
  );
});

test("46. trg_contractor_payable_eligibility checks work_order_status qa_complete or closed", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(fn.includes("'qa_complete'"), "trigger must check work_order_status = qa_complete");
  assert.ok(fn.includes("work_order_status"), "trigger must check work_order_status");
});

test("47. trg_contractor_payable_eligibility checks work_order org/BU match", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("work_order organization_id") || fn.includes("work_order.organization_id"),
    "trigger must check work_order organization_id matches payable"
  );
  assert.ok(
    fn.includes("work_order business_unit_id") || fn.includes("work_order.business_unit_id"),
    "trigger must check work_order business_unit_id matches payable"
  );
});

test("48. trg_contractor_payable_eligibility requires passed/waived QA for same job/work_order", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("qa_inspection") && fn.includes("'passed'") && fn.includes("'waived'"),
    "trigger must check qa_inspection for passed or waived status"
  );
  assert.ok(
    fn.includes("work_order_id") && fn.includes("qa_inspection"),
    "trigger must check QA for same work_order"
  );
});

test("49. trg_contractor_payable_eligibility uses M009 corrective_action status contract (verified/cancelled)", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  // Must use 'verified' and 'cancelled' as the terminal statuses (not 'resolved').
  // Extract the corrective_action blocking check.
  assert.ok(
    fn.includes("'verified'") && fn.includes("'cancelled'"),
    "trigger must use verified and cancelled as nonblocking corrective_action statuses"
  );
  // 'resolved' must not be listed as a terminal/nonblocking status alongside verified/cancelled
  // in the corrective_action check (it should be treated as blocking, per M009).
  const caCheckMatch = fn.match(/action_status NOT IN \([^)]+\)/);
  if (caCheckMatch) {
    assert.ok(
      !caCheckMatch[0].includes("'resolved'"),
      "corrective_action action_status NOT IN list must not include 'resolved' — matches M009 close gate contract"
    );
  }
});

test("50. trg_contractor_payable_eligibility checks effective_from <= applicable service date", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("effective_from"),
    "trigger must check compensation effective_from"
  );
  assert.ok(
    fn.includes("service_completed_at"),
    "trigger must use work_order.service_completed_at as canonical applicable date"
  );
});

test("51. trg_contractor_payable_eligibility checks effective_to IS NULL or applicable date <= effective_to", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("effective_to"),
    "trigger must check compensation effective_to"
  );
  assert.ok(
    fn.includes("effective_to IS NOT NULL") || fn.includes("v_ccv.effective_to IS NOT NULL"),
    "trigger must guard effective_to IS NULL (NULL means no expiry)"
  );
});

test("52. trg_contractor_payable_eligibility uses DB-authoritative canonical date (not client-supplied)", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_contractor_payable_eligibility\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_contractor_payable_eligibility function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("service_completed_at") &&
    (fn.includes("v_applicable_date") || fn.includes("applicable")),
    "trigger must derive applicable date from work_order.service_completed_at — not client-supplied"
  );
  assert.ok(
    fn.includes("Client-supplied dates are not trusted") ||
    fn.includes("not trust") ||
    fn.includes("client-supplied") ||
    fn.includes("DB-authoritative"),
    "trigger must document that client-supplied dates are not used"
  );
});

// ── 21. billing_readiness_gate Wave 4 governed close requirements ─────────────
test("53. trg_billing_readiness_gate_canonical_lineage checks Wave 4 applicability_status = enrolled", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("'enrolled'"),
    "billing readiness trigger must verify applicability_status = enrolled for Wave 4 work orders"
  );
});

test("54. trg_billing_readiness_gate_canonical_lineage checks governance_link exists for enrolled Wave 4 work orders", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("work_order_governance_link"),
    "billing readiness trigger must check work_order_governance_link exists for enrolled Wave 4 work orders"
  );
});

test("55. trg_billing_readiness_gate_canonical_lineage checks evidence_requirement exists for enrolled Wave 4 work orders", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("work_order_evidence_requirement"),
    "billing readiness trigger must check work_order_evidence_requirement exists"
  );
});

test("56. trg_billing_readiness_gate_canonical_lineage checks mandatory completion_evidence with required_count", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("completion_evidence") && fn.includes("required_count") && fn.includes("is_mandatory"),
    "billing readiness trigger must check mandatory evidence requirement satisfaction with required_count"
  );
});

test("57. trg_billing_readiness_gate_canonical_lineage checks storage_system/storage_reference for external references", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  assert.ok(
    fn.includes("storage_system") && fn.includes("storage_reference") && fn.includes("requires_external_reference"),
    "billing readiness trigger must check storage_system/storage_reference when requires_external_reference=true"
  );
});

test("58. trg_billing_readiness_gate_canonical_lineage uses M009 corrective_action status contract (verified/cancelled)", () => {
  const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.trg_billing_readiness_gate_canonical_lineage\(\)[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$[\s\S]*?\$\$/);
  assert.ok(fnMatch, "trg_billing_readiness_gate_canonical_lineage function must exist");
  const fn = fnMatch[0];
  // The corrective_action NOT IN list in the billing readiness gate must use verified/cancelled (M009 contract).
  const caMatch = fn.match(/action_status NOT IN \([^)]+\)/);
  assert.ok(caMatch, "billing readiness trigger must have an action_status NOT IN check");
  assert.ok(
    caMatch[0].includes("'verified'") && caMatch[0].includes("'cancelled'"),
    "billing readiness corrective_action NOT IN must include verified and cancelled"
  );
  assert.ok(
    !caMatch[0].includes("'resolved'"),
    "billing readiness corrective_action NOT IN must not include 'resolved' — matches M009 close gate"
  );
});
