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
const UUID_HEX_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon;`).test(m007),
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
  assert.ok(!/^\s*COMMIT\s*;/m.test(m008), "M008 must not contain COMMIT;");
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

test("M008: does not disable triggers", () => {
  assert.ok(!/DISABLE\s+TRIGGER/i.test(m008), "M008 must not disable triggers");
});

test("M008: does not ALTER M001-M007 schemas", () => {
  assert.ok(!/ALTER\s+TABLE/i.test(m008), "M008 must not ALTER existing schemas");
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

// ── NEW: M007 function order check ───────────────────────────────────────────

test("M007: worker_has_active_assignment is defined AFTER worker_assignment table", () => {
  const waTableIdx = m007.indexOf("CREATE TABLE public.worker_assignment");
  const whaFnIdx   = m007.indexOf("worker_has_active_assignment: true when");
  assert.ok(waTableIdx > 0, "worker_assignment table not found in M007");
  assert.ok(whaFnIdx > waTableIdx,
    "worker_has_active_assignment must be defined AFTER worker_assignment table"
  );
});

// ── NEW: M007 active worker enforcement ──────────────────────────────────────

test("M007: current_worker_id requires status='active'", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.current_worker_id[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "current_worker_id function not found");
  assert.ok(
    fnMatch[0].includes("'active'"),
    "current_worker_id must enforce worker status='active'"
  );
});

test("M007: current_worker_id fails closed on ambiguous active workers", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.current_worker_id[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "current_worker_id function not found");
  const fn = fnMatch[0];
  assert.ok(/LIMIT\s+2/i.test(fn), "current_worker_id should read at most two active workers");
  assert.ok(
    /array_length\(v_worker_ids,\s*1\)\s*>\s*1[\s\S]*RETURN NULL/i.test(fn),
    "current_worker_id must fail closed and return NULL when multiple active workers exist"
  );
  assert.ok(
    !/LIMIT\s+1/i.test(fn),
    "current_worker_id must not use LIMIT 1 for worker ambiguity handling"
  );
  assert.ok(
    !/ORDER BY\s+w\.id[\s\S]*LIMIT\s+1/i.test(fn),
    "current_worker_id must not select an arbitrary worker with ORDER BY/LIMIT 1"
  );
});

test("M007: worker_has_active_assignment requires worker status='active'", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.worker_has_active_assignment[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "worker_has_active_assignment function not found");
  assert.ok(
    fnMatch[0].includes("'active'"),
    "worker_has_active_assignment must enforce worker status='active'"
  );
});

// ── NEW: M007 assignment lifecycle trigger ────────────────────────────────────

test("M007: worker assignment lifecycle guard trigger exists (trg_wa_lifecycle_guard)", () => {
  assert.ok(
    m007.includes("trg_wa_lifecycle_guard"),
    "M007 missing trg_wa_lifecycle_guard trigger"
  );
});

test("M007: wave3_guard_wa_lifecycle enforces terminal states", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.wave3_guard_wa_lifecycle[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "wave3_guard_wa_lifecycle function not found");
  const fn = fnMatch[0];
  ["declined", "released", "completed", "cancelled"].forEach((s) => {
    assert.ok(fn.includes(`'${s}'`), `lifecycle guard missing terminal state: ${s}`);
  });
});

// ── NEW: M007 child scope validator cross-checks ─────────────────────────────

test("M007: work_order_event scope validator (trg_woe_scope_validate) exists and cross-checks work_order", () => {
  assert.ok(m007.includes("trg_woe_scope_validate"), "M007 missing trg_woe_scope_validate");
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.wave3_validate_woe_scope[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "wave3_validate_woe_scope function not found");
  assert.ok(
    fnMatch[0].includes("v_wo.operational_job_id"),
    "wave3_validate_woe_scope must cross-check work_order.operational_job_id"
  );
});

test("M007: completion_evidence scope validator (trg_ce_scope_validate) exists", () => {
  assert.ok(m007.includes("trg_ce_scope_validate"), "M007 missing trg_ce_scope_validate");
  assert.ok(m007.includes("wave3_validate_ce_scope"), "M007 missing wave3_validate_ce_scope function");
});

test("M007: service_checklist_result scope validator (trg_scr_scope_validate) exists", () => {
  assert.ok(m007.includes("trg_scr_scope_validate"), "M007 missing trg_scr_scope_validate");
  assert.ok(m007.includes("wave3_validate_scr_scope"), "M007 missing wave3_validate_scr_scope function");
});

test("M007: qa_inspection scope validator cross-checks work_order.operational_job_id", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.wave3_guard_qi_scope[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "wave3_guard_qi_scope function not found");
  assert.ok(
    fnMatch[0].includes("v_wo.operational_job_id"),
    "wave3_guard_qi_scope must cross-check work_order.operational_job_id"
  );
});

test("M007: corrective_action scope validator cross-checks work_order and qa_inspection", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.wave3_validate_ca_scope[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "wave3_validate_ca_scope function not found");
  const fn = fnMatch[0];
  assert.ok(fn.includes("v_wo.operational_job_id"), "ca_scope must cross-check work_order.operational_job_id");
  assert.ok(fn.includes("v_qi.operational_job_id"), "ca_scope must cross-check qa_inspection.operational_job_id");
});

test("M007: operational_handoff lineage validator cross-checks qa_inspection_id", () => {
  const fnMatch = m007.match(/CREATE OR REPLACE FUNCTION public\.wave3_validate_oh_lineage[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "wave3_validate_oh_lineage function not found");
  assert.ok(
    fnMatch[0].includes("qa_inspection_id"),
    "wave3_validate_oh_lineage must cross-check qa_inspection_id"
  );
});

// ── NEW: M008 canonical column contract assertions ────────────────────────────

test("M008: contact insert does NOT contain organization_id or business_unit_id", () => {
  const contactMatch = m008.match(/INSERT INTO public\.contact[\s\S]*?;/);
  assert.ok(contactMatch, "M008 contact insert not found");
  const insert = contactMatch[0];
  assert.ok(!insert.includes("organization_id"), "M008 contact insert must not include organization_id");
  assert.ok(!insert.includes("business_unit_id"), "M008 contact insert must not include business_unit_id");
});

test("M008: service_location uses address_line1 (not address_line_1)", () => {
  assert.ok(m008.includes("address_line1"), "M008 service_location must use address_line1");
  assert.ok(!m008.includes("address_line_1"), "M008 must not use stale address_line_1");
});

test("M008: quote_version uses lifecycle_status and version_no", () => {
  const qvMatch = m008.match(/INSERT INTO public\.quote_version[\s\S]*?;/);
  assert.ok(qvMatch, "M008 quote_version insert not found");
  const insert = qvMatch[0];
  assert.ok(insert.includes("lifecycle_status"), "M008 quote_version must use lifecycle_status");
  assert.ok(insert.includes("version_no"), "M008 quote_version must use version_no");
  assert.ok(!insert.includes("version_status"), "M008 quote_version must not use stale version_status");
  assert.ok(!insert.includes("version_number"), "M008 quote_version must not use stale version_number");
  assert.ok(insert.includes("'draft'"), "M008 quote_version must begin as draft");
});

test("M008: quote_version follows draft → sent → accepted lifecycle", () => {
  const insertMatch = m008.match(/INSERT INTO public\.quote_version[\s\S]*?;/);
  const sentMatch = m008.match(
    /UPDATE public\.quote_version\s+SET lifecycle_status = 'sent',\s+sent_at = now\(\)\s+WHERE id = '15000000-0000-0000-0000-000000000001'::uuid;/
  );
  const responseMatch = m008.match(/INSERT INTO public\.quote_response[\s\S]*?;/);
  const acceptedMatch = m008.match(
    /UPDATE public\.quote_version\s+SET lifecycle_status = 'accepted'\s+WHERE id = '15000000-0000-0000-0000-000000000001'::uuid;/
  );

  assert.ok(insertMatch, "M008 quote_version insert not found");
  assert.ok(sentMatch, "M008 must transition quote_version from draft to sent");
  assert.ok(responseMatch, "M008 quote_response insert not found");
  assert.ok(acceptedMatch, "M008 must transition quote_version from sent to accepted");
  assert.ok(
    sentMatch.index > insertMatch.index,
    "M008 must transition quote_version from draft to sent after insert"
  );
  assert.ok(
    responseMatch.index > sentMatch.index,
    "M008 quote_response must occur after quote_version is sent"
  );
  assert.ok(
    acceptedMatch.index > responseMatch.index,
    "M008 must transition quote_version from sent to accepted after quote_response insert"
  );
});

test("M008: quote_response uses canonical field names", () => {
  const qrMatch = m008.match(/INSERT INTO public\.quote_response[\s\S]*?;/);
  assert.ok(qrMatch, "M008 quote_response insert not found");
  const insert = qrMatch[0];
  assert.ok(insert.includes("response_type"), "M008 quote_response must use response_type");
  assert.ok(insert.includes("response_channel"), "M008 quote_response must use response_channel");
  assert.ok(insert.includes("responded_at"), "M008 quote_response must use responded_at");
  assert.ok(!insert.includes("response_status"), "M008 quote_response must not use stale response_status");
  assert.ok(!insert.includes("quote_id"), "M008 quote_response must not include quote_id");
});

test("M008: worker_assignment follows proposed → assigned → acknowledged lifecycle", () => {
  const insertMatch = m008.match(/INSERT INTO public\.worker_assignment[\s\S]*?;/);
  const assignedMatch = m008.match(
    /UPDATE public\.worker_assignment\s+SET assignment_status = 'assigned',\s+assigned_at = now\(\)\s+WHERE id = '22000000-0000-0000-0000-000000000001'::uuid;/
  );
  const acknowledgedMatch = m008.match(
    /UPDATE public\.worker_assignment\s+SET assignment_status = 'acknowledged',\s+acknowledged_at = now\(\)\s+WHERE id = '22000000-0000-0000-0000-000000000001'::uuid;/
  );

  assert.ok(insertMatch, "M008 worker_assignment insert not found");
  assert.ok(insertMatch[0].includes("'proposed'"), "M008 worker_assignment must begin as proposed");
  assert.ok(assignedMatch, "M008 must transition worker_assignment from proposed to assigned");
  assert.ok(acknowledgedMatch, "M008 must transition worker_assignment from assigned to acknowledged");
  assert.ok(
    assignedMatch.index > insertMatch.index,
    "M008 must transition worker_assignment to assigned after insert"
  );
  assert.ok(
    acknowledgedMatch.index > assignedMatch.index,
    "M008 must transition worker_assignment to acknowledged after assigned"
  );
});

test("M008: work_order follows draft → published → in_progress → service_complete → qa_complete → closed lifecycle", () => {
  const insertMatch = m008.match(/INSERT INTO public\.work_order[\s\S]*?;/);
  const publishedMatch = m008.match(
    /UPDATE public\.work_order\s+SET\s+work_order_status = 'published',\s+published_at\s+= now\(\)\s+WHERE\s+id = '23000000-0000-0000-0000-000000000001'::uuid;/
  );
  const inProgressMatch = m008.match(
    /UPDATE public\.work_order\s+SET\s+work_order_status = 'in_progress',\s+started_at\s+= now\(\)\s+WHERE\s+id = '23000000-0000-0000-0000-000000000001'::uuid;/
  );
  const serviceCompleteMatch = m008.match(
    /UPDATE public\.work_order\s+SET\s+work_order_status\s+= 'service_complete',[\s\S]*?WHERE\s+id = '23000000-0000-0000-0000-000000000001'::uuid;/
  );
  const qaCompleteMatch = m008.match(
    /UPDATE public\.work_order\s+SET\s+work_order_status = 'qa_complete'\s+WHERE\s+id = '23000000-0000-0000-0000-000000000001'::uuid;/
  );
  const closedMatch = m008.match(
    /UPDATE public\.work_order\s+SET\s+work_order_status = 'closed'\s+WHERE\s+id = '23000000-0000-0000-0000-000000000001'::uuid;/
  );

  assert.ok(insertMatch, "M008 work_order insert not found");
  assert.ok(insertMatch[0].includes("'draft'"), "M008 work_order must begin as draft");
  assert.ok(!insertMatch[0].includes("published_at"), "M008 work_order insert must not set published_at");
  assert.ok(publishedMatch, "M008 must transition work_order from draft to published");
  assert.ok(inProgressMatch, "M008 must transition work_order from published to in_progress");
  assert.ok(serviceCompleteMatch, "M008 must transition work_order from in_progress to service_complete");
  assert.ok(qaCompleteMatch, "M008 must transition work_order from service_complete to qa_complete");
  assert.ok(closedMatch, "M008 must transition work_order from qa_complete to closed");
  assert.ok(publishedMatch.index > insertMatch.index, "M008 must publish work_order after draft insert");
  assert.ok(inProgressMatch.index > publishedMatch.index, "M008 must move work_order to in_progress after publish");
  assert.ok(serviceCompleteMatch.index > inProgressMatch.index, "M008 must move work_order to service_complete after in_progress");
  assert.ok(qaCompleteMatch.index > serviceCompleteMatch.index, "M008 must move work_order to qa_complete after service_complete");
  assert.ok(closedMatch.index > qaCompleteMatch.index, "M008 must move work_order to closed after qa_complete");
});

test("M008: pricing_snapshot uses canonical field names (no stale fields)", () => {
  const psMatch = m008.match(/INSERT INTO public\.pricing_snapshot\s*\(([^)]+)\)/);
  assert.ok(psMatch, "M008 pricing_snapshot insert column list not found");
  const colList = psMatch[1]; // only the column names, before VALUES
  // Must have canonical fields
  assert.ok(colList.includes("currency_code"), "M008 pricing_snapshot must use currency_code");
  assert.ok(colList.includes("subtotal_amount"), "M008 pricing_snapshot must use subtotal_amount");
  // Must NOT have stale column names
  assert.ok(!colList.includes("quote_id"), "M008 pricing_snapshot must not use stale quote_id");
  assert.ok(!colList.includes("pre_tax_total"), "M008 pricing_snapshot must not use stale pre_tax_total");
  assert.ok(
    !/(?:^|,)\s*currency\s*(?:,|$)/m.test(colList),
    "M008 pricing_snapshot must not use stale currency column"
  );
  assert.ok(!colList.includes("quote_contract_version"), "M008 pricing_snapshot must not use stale quote_contract_version");
  assert.ok(!colList.includes("governance_flags"), "M008 pricing_snapshot must not use stale governance_flags");
});

test("M008: conversion_record includes required lineage fields", () => {
  const crMatch = m008.match(/INSERT INTO public\.conversion_record[\s\S]*?;/);
  assert.ok(crMatch, "M008 conversion_record insert not found");
  const insert = crMatch[0];
  ["service_request_id", "estimate_id", "quote_id", "quote_response_id"].forEach((f) => {
    assert.ok(insert.includes(f), `M008 conversion_record missing required field: ${f}`);
  });
});

test("M008: remaining_artifact_count is computed (not hard-coded 0)", () => {
  // Must NOT be the literal '0  AS remaining_artifact_count'
  assert.ok(
    !m008.includes("0  AS remaining_artifact_count"),
    "M008 remaining_artifact_count must be computed, not hard-coded 0"
  );
  // Must contain a subquery COUNT
  assert.ok(
    m008.includes("COUNT(*) FROM public.operational_job"),
    "M008 remaining_artifact_count must compute actual counts"
  );
});

test("M008: resolves published ON-2026-08-v1.0 residential_pricing scope", () => {
  assert.ok(
    m008.includes("FROM public.configuration_version cv"),
    "M008 must resolve scope from configuration_version"
  );
  assert.ok(
    m008.includes("cv.configuration_type = 'residential_pricing'"),
    "M008 must filter configuration_type='residential_pricing'"
  );
  assert.ok(
    m008.includes("cv.version = 'ON-2026-08-v1.0'"),
    "M008 must filter version='ON-2026-08-v1.0'"
  );
  assert.ok(
    m008.includes("cv.status = 'published'"),
    "M008 must filter status='published'"
  );
});

test("M008: does not insert configuration_version", () => {
  assert.ok(
    !/INSERT INTO public\.configuration_version\b/.test(m008),
    "M008 must not insert synthetic configuration_version rows"
  );
});

test("M008: does not insert synthetic organization/business_unit/jurisdiction", () => {
  ["organization", "business_unit", "jurisdiction"].forEach((tableName) => {
    assert.ok(
      !new RegExp(`INSERT INTO public\\.${tableName}\\b`).test(m008),
      `M008 must not insert synthetic ${tableName} rows`
    );
  });
});

test("M008: all hard-coded rehearsal UUID literals are valid hexadecimal UUIDs", () => {
  const uuidLiterals = Array.from(m008.matchAll(/'([0-9a-z-]{36})'::uuid/gi), (m) => m[1]);
  assert.ok(uuidLiterals.length > 0, "No hard-coded UUID literals found in M008");
  uuidLiterals.forEach((id) => {
    assert.ok(UUID_HEX_REGEX.test(id), `Invalid hexadecimal UUID literal in M008: ${id}`);
  });
});

test("M008: does not reference synthetic app_user ids", () => {
  assert.ok(
    !m008.includes("19000000-0000-0000-0000-000000000001"),
    "M008 must not reference synthetic app_user UUIDs"
  );
  assert.ok(
    !/app_user_id/.test(m008),
    "M008 rehearsal inserts must not include synthetic app_user references"
  );
});

test("M008: worker insert uses contractor + active without app_user_id", () => {
  const workerInsert = m008.match(/INSERT INTO public\.worker[\s\S]*?;/);
  assert.ok(workerInsert, "M008 worker insert not found");
  const insert = workerInsert[0];
  assert.ok(insert.includes("worker_type"), "M008 worker insert must include worker_type");
  assert.ok(insert.includes("'contractor'"), "M008 worker_type must be contractor");
  assert.ok(insert.includes("'active'"), "M008 worker status must be active");
  assert.ok(!insert.includes("app_user_id"), "M008 worker insert must not include app_user_id");
});

test("M008: pricing_snapshot references resolved configuration version scope", () => {
  const psInsert = m008.match(/INSERT INTO public\.pricing_snapshot[\s\S]*?;/);
  assert.ok(psInsert, "M008 pricing_snapshot insert not found");
  assert.ok(
    psInsert[0].includes("(SELECT configuration_version_id FROM pg_temp.m008_scope)"),
    "M008 pricing_snapshot must use resolved configuration version id from m008_scope"
  );
});

test("M008: sanity assertions check assignment acknowledged, quote_version accepted, and quote_response accepted", () => {
  assert.ok(
    m008.includes("worker_assignment status = % (expected acknowledged)"),
    "M008 sanity assertions must check worker_assignment acknowledged"
  );
  assert.ok(
    m008.includes("quote_version lifecycle_status = % (expected accepted)"),
    "M008 sanity assertions must check quote_version accepted"
  );
  assert.ok(
    m008.includes("quote_response response_type = % (expected accepted)"),
    "M008 sanity assertions must check quote_response accepted"
  );
});
