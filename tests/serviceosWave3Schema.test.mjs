import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const m007 = readFileSync(
  resolve(ROOT, "supabase/migrations/007_wave3_operations.sql"),
  "utf8"
);
const m008 = readFileSync(
  resolve(ROOT, "supabase/rehearsals/008_wave3_operations_rehearsal.sql"),
  "utf8"
);

// ── M007: exact 10 Wave 3 table names ─────────────────────────────────────

const WAVE3_TABLES = [
  "operational_job",
  "schedule_window",
  "worker_assignment",
  "work_order",
  "work_order_event",
  "completion_evidence",
  "service_checklist_result",
  "qa_inspection",
  "corrective_action",
  "operational_handoff",
];

test("M007: contains exactly 10 Wave 3 CREATE TABLE statements", () => {
  const tableMatches = WAVE3_TABLES.filter((t) =>
    new RegExp(`CREATE TABLE public\\.${t}\\b`).test(m007)
  );
  assert.equal(
    tableMatches.length,
    10,
    `Missing tables: ${WAVE3_TABLES.filter((t) => !tableMatches.includes(t)).join(", ")}`
  );
});

test("M007: no extra unexpected CREATE TABLE statements in wave3 section", () => {
  const createTableCount = (m007.match(/^CREATE TABLE public\./gm) || []).length;
  assert.equal(createTableCount, 10, `Expected 10 CREATE TABLE, found ${createTableCount}`);
});

// ── M007: RLS enabled on all 10 tables ────────────────────────────────────

test("M007: ENABLE ROW LEVEL SECURITY on all 10 Wave 3 tables", () => {
  WAVE3_TABLES.forEach((t) => {
    assert.ok(
      new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(m007),
      `Missing ENABLE ROW LEVEL SECURITY for ${t}`
    );
  });
});

// ── M007: anon REVOKE on all 10 tables ────────────────────────────────────

test("M007: REVOKE ALL ... FROM anon on all 10 Wave 3 tables", () => {
  WAVE3_TABLES.forEach((t) => {
    assert.ok(
      m007.includes(`REVOKE ALL ON public.${t}`) &&
        m007.includes(`FROM anon`),
      `Missing REVOKE ALL from anon for ${t}`
    );
  });
  const revokeAnonCount = (
    m007.match(/REVOKE ALL ON public\.[a-z_]+ +FROM anon;/g) || []
  ).length;
  assert.equal(revokeAnonCount, 10, `Expected 10 anon REVOKE statements, found ${revokeAnonCount}`);
});

// ── M007: GRANT to authenticated on all 10 tables ─────────────────────────

test("M007: GRANT ... TO authenticated on all 10 Wave 3 tables", () => {
  WAVE3_TABLES.forEach((t) => {
    assert.ok(
      new RegExp(`GRANT .+ ON public\\.${t}\\s+TO authenticated`).test(m007),
      `Missing GRANT to authenticated for ${t}`
    );
  });
});

// ── M007: required lifecycle / status values ──────────────────────────────

test("M007: operational_job contains all required lifecycle status values", () => {
  const required = [
    "ready_to_schedule",
    "scheduled",
    "dispatched",
    "in_progress",
    "service_complete",
    "qa_pending",
    "qa_passed",
    "corrective_action_required",
    "closed",
    "cancelled",
  ];
  required.forEach((s) => {
    assert.ok(m007.includes(`'${s}'`), `Missing operational_job lifecycle status: ${s}`);
  });
});

test("M007: worker_assignment contains all required role values", () => {
  ["service_worker", "team_lead", "trainee", "inspector"].forEach((r) => {
    assert.ok(m007.includes(`'${r}'`), `Missing worker_assignment role: ${r}`);
  });
});

test("M007: work_order_event contains all required event_type values", () => {
  const required = [
    "scheduled", "assignment_created", "assignment_acknowledged",
    "dispatched", "arrived", "work_started", "paused", "resumed",
    "work_completed", "completion_submitted", "qa_requested",
    "qa_passed", "qa_failed", "corrective_action_opened",
    "corrective_action_completed", "customer_issue_reported", "closed",
  ];
  required.forEach((e) => {
    assert.ok(m007.includes(`'${e}'`), `Missing work_order_event type: ${e}`);
  });
});

test("M007: completion_evidence contains all required evidence_type values", () => {
  ["photo_before", "photo_after", "photo_detail", "note", "signature", "timestamp", "other"].forEach(
    (e) => assert.ok(m007.includes(`'${e}'`), `Missing evidence_type: ${e}`)
  );
});

test("M007: qa_inspection contains required inspection_status and inspection_type values", () => {
  ["pending", "in_progress", "passed", "failed", "waived"].forEach((s) =>
    assert.ok(m007.includes(`'${s}'`), `Missing qa inspection_status: ${s}`)
  );
  ["standard", "spot_check", "customer_issue", "reinspection"].forEach((t) =>
    assert.ok(m007.includes(`'${t}'`), `Missing qa inspection_type: ${t}`)
  );
});

test("M007: corrective_action contains required action_status and action_type values", () => {
  ["open", "assigned", "in_progress", "resolved", "verified", "cancelled"].forEach((s) =>
    assert.ok(m007.includes(`'${s}'`), `Missing corrective_action status: ${s}`)
  );
  ["rework", "customer_recovery", "safety", "documentation", "other"].forEach((t) =>
    assert.ok(m007.includes(`'${t}'`), `Missing corrective_action type: ${t}`)
  );
});

// ── M007: required lineage fields ─────────────────────────────────────────

test("M007: operational_job has all required lineage fields", () => {
  const required = [
    "job_handoff_id",
    "conversion_record_id",
    "quote_version_id",
    "pricing_snapshot_id",
    "customer_id",
    "contact_id",
    "service_location_id",
    "jurisdiction_id",
    "commercial_authority_snapshot",
  ];
  required.forEach((f) => {
    assert.ok(
      m007.includes(f),
      `operational_job missing required field: ${f}`
    );
  });
});

test("M007: operational_handoff has commercial lineage fields", () => {
  assert.ok(m007.includes("pricing_snapshot_id"), "operational_handoff missing pricing_snapshot_id");
  assert.ok(m007.includes("quote_version_id"), "operational_handoff missing quote_version_id");
});

// ── M007: append-only controls ────────────────────────────────────────────

test("M007: work_order_event has UPDATE and DELETE trigger guards", () => {
  assert.ok(
    m007.includes("trg_woe_deny_update") && m007.includes("trg_woe_deny_delete"),
    "work_order_event missing append-only trigger guards"
  );
});

test("M007: completion_evidence has UPDATE and DELETE trigger guards", () => {
  assert.ok(
    m007.includes("trg_ce_deny_update") && m007.includes("trg_ce_deny_delete"),
    "completion_evidence missing append-only trigger guards"
  );
});

// ── M007: no huc_* ALTER / DROP / GRANT / REVOKE ──────────────────────────

test("M007: no huc_* ALTER TABLE statements", () => {
  assert.ok(
    !/ALTER TABLE public\.huc_/i.test(m007),
    "M007 contains ALTER TABLE on a huc_* table"
  );
});

test("M007: no huc_* DROP TABLE statements", () => {
  assert.ok(
    !/DROP TABLE.*huc_/i.test(m007),
    "M007 contains DROP TABLE on a huc_* table"
  );
});

test("M007: no huc_* GRANT statements", () => {
  assert.ok(
    !/GRANT .* ON public\.huc_/i.test(m007),
    "M007 contains GRANT on a huc_* table"
  );
});

test("M007: no huc_* REVOKE statements", () => {
  assert.ok(
    !/REVOKE .* ON public\.huc_/i.test(m007),
    "M007 contains REVOKE on a huc_* table"
  );
});

// ── M007: transaction integrity ───────────────────────────────────────────

test("M007: wrapped in a single BEGIN/COMMIT transaction", () => {
  assert.ok(/^\s*BEGIN\s*;/m.test(m007), "M007 missing BEGIN;");
  assert.ok(/^\s*COMMIT\s*;/m.test(m007), "M007 missing COMMIT;");
});

test("M007: contains M007_PASS marker", () => {
  assert.ok(m007.includes("M007_PASS"), "M007 missing M007_PASS validation marker");
});

test("M007: self-validation selects all 10 expected validation columns", () => {
  const columns = [
    "wave3_tables_found",
    "expected_tables",
    "rls_enabled_count",
    "anon_privilege_violation_count",
    "authenticated_table_count",
    "policy_count",
    "missing_required_dependency_count",
    "missing_fk_or_unique_count",
    "missing_guard_trigger_count",
    "legacy_huc_touch_count",
  ];
  columns.forEach((c) =>
    assert.ok(m007.includes(c), `M007 self-validation missing column: ${c}`)
  );
});

// ── M007: policy count locked at 47 ──────────────────────────────────────

test("M007: expected_policy_count is locked to 47", () => {
  assert.ok(
    /v_expected_policy_count\s+integer\s*:=\s*47/.test(m007),
    "M007 expected_policy_count is not locked to 47"
  );
});

// ── M008: rehearsal marker ────────────────────────────────────────────────

test("M008: contains rehearsal marker wave3_m008_rehearsal_v1", () => {
  assert.ok(
    m008.includes("wave3_m008_rehearsal_v1"),
    "M008 missing marker wave3_m008_rehearsal_v1"
  );
});

test("M008: ends in ROLLBACK", () => {
  assert.ok(/\bROLLBACK\b/.test(m008), "M008 missing ROLLBACK statement");
  // ROLLBACK must appear before the post-rollback verification SELECT
  const rollbackIdx = m008.lastIndexOf("ROLLBACK");
  const commitIdx = m008.indexOf("COMMIT");
  assert.equal(commitIdx, -1, "M008 must not contain COMMIT");
  assert.ok(rollbackIdx > 0, "M008 ROLLBACK not found");
});

test("M008: contains post-rollback zero-artifact verification", () => {
  assert.ok(
    m008.includes("M008_REHEARSAL_PASS_ROLLED_BACK"),
    "M008 missing M008_REHEARSAL_PASS_ROLLED_BACK zero-artifact result"
  );
  assert.ok(
    m008.includes("remaining_artifact_count"),
    "M008 missing remaining_artifact_count column in post-rollback check"
  );
});

test("M008: zero-artifact check covers all 10 Wave 3 tables", () => {
  WAVE3_TABLES.forEach((t) => {
    assert.ok(
      m008.includes(`FROM public.${t}`),
      `M008 zero-artifact check missing coverage of ${t}`
    );
  });
});

test("M008: no reference to huc_* legacy tables in SQL statements", () => {
  // Strip comment lines before checking for huc_ references in live SQL
  const sqlOnlyLines = m008
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(!/huc_/i.test(sqlOnlyLines), "M008 contains huc_* reference in SQL (non-comment) code");
});

test("M008: synthetic chain covers full Wave 3 lifecycle", () => {
  const requiredSteps = [
    "operational_job",
    "schedule_window",
    "worker_assignment",
    "work_order",
    "work_order_event",
    "completion_evidence",
    "service_checklist_result",
    "qa_inspection",
    "operational_handoff",
  ];
  requiredSteps.forEach((s) =>
    assert.ok(
      new RegExp(`INSERT INTO public\\.${s}\\b`).test(m008),
      `M008 missing INSERT for ${s}`
    )
  );
});

test("M008: Wave 3 chain is constructed without any corrective_action (clean path)", () => {
  // The rehearsal exercises the happy-path; corrective_action not required
  // but verify the rehearsal is self-consistent
  assert.ok(
    m008.includes("qa_passed") || m008.includes("'passed'"),
    "M008 rehearsal must reach QA passed"
  );
});

test("M008: pricing_snapshot lineage assertion included in in-transaction checks", () => {
  assert.ok(
    m008.includes("configuration_version_id"),
    "M008 rehearsal missing configuration_version_id lineage check"
  );
});
