// =============================================================================
// STATIC FIXTURE TEST — Wave 4 Preview Acceptance Fixture 011
// Verifies structural correctness of supabase/acceptance/011_wave4_preview_acceptance_fixture.sql
// without executing it against any database.
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const fixturePath = resolve(ROOT, "supabase/acceptance/011_wave4_preview_acceptance_fixture.sql");
const fixture = readFileSync(fixturePath, "utf8");

// ── 1. Fixture does NOT INSERT work_order_wave4_applicability ─────────────────
test("1. fixture does not INSERT into work_order_wave4_applicability", () => {
  const insertMatches = [...fixture.matchAll(/INSERT\s+INTO\s+public\.work_order_wave4_applicability/gi)];
  assert.equal(insertMatches.length, 0,
    "Fixture must not INSERT into work_order_wave4_applicability — runtime creates this");
});

// ── 2. Fixture does NOT INSERT work_order_governance_link ─────────────────────
test("2. fixture does not INSERT into work_order_governance_link", () => {
  const insertMatches = [...fixture.matchAll(/INSERT\s+INTO\s+public\.work_order_governance_link/gi)];
  assert.equal(insertMatches.length, 0,
    "Fixture must not INSERT into work_order_governance_link — runtime creates this");
});

// ── 3. Fixture does NOT INSERT work_order_evidence_requirement ────────────────
test("3. fixture does not INSERT into work_order_evidence_requirement", () => {
  const insertMatches = [...fixture.matchAll(/INSERT\s+INTO\s+public\.work_order_evidence_requirement/gi)];
  assert.equal(insertMatches.length, 0,
    "Fixture must not INSERT into work_order_evidence_requirement — runtime creates this");
});

// ── 4. Fixture explicitly asserts zero work_order_wave4_applicability rows ────
test("4. fixture asserts zero work_order_wave4_applicability rows for fixture scope", () => {
  assert.ok(
    fixture.includes("work_order_wave4_applicability") &&
    /v_w4_applicability_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_w4_applicability_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 5. Fixture explicitly asserts zero work_order_governance_link rows ─────────
test("5. fixture asserts zero work_order_governance_link rows for fixture scope", () => {
  assert.ok(
    fixture.includes("work_order_governance_link") &&
    /v_w4_gov_link_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_w4_gov_link_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 6. Fixture explicitly asserts zero work_order_evidence_requirement rows ───
test("6. fixture asserts zero work_order_evidence_requirement rows for fixture scope", () => {
  assert.ok(
    fixture.includes("work_order_evidence_requirement") &&
    /v_w4_evidence_req_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_w4_evidence_req_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 7. Fixture asserts zero completion_evidence ───────────────────────────────
test("7. fixture asserts zero completion_evidence for fixture scope", () => {
  assert.ok(
    fixture.includes("completion_evidence") &&
    /v_completion_evidence_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_completion_evidence_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 8. Fixture asserts zero service_exception ─────────────────────────────────
test("8. fixture asserts zero service_exception for fixture scope", () => {
  assert.ok(
    fixture.includes("service_exception") &&
    /v_service_exception_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_service_exception_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 9. Fixture asserts zero corrective_action ─────────────────────────────────
test("9. fixture asserts zero corrective_action for fixture scope", () => {
  assert.ok(
    fixture.includes("corrective_action") &&
    /v_corrective_action_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_corrective_action_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 10. Fixture asserts zero customer_outcome ─────────────────────────────────
test("10. fixture asserts zero customer_outcome for fixture scope", () => {
  assert.ok(
    fixture.includes("customer_outcome") &&
    /v_customer_outcome_count\s*<>\s*0/.test(fixture),
    "Fixture must assert v_customer_outcome_count = 0 and RAISE EXCEPTION if not"
  );
});

// ── 11. Preview config lookup uses organization_id + configuration_type + version ──
test("11. preview config lookup uses organization_id + configuration_type + version", () => {
  // The uniqueness resolution must include organization_id, NOT rely only on version alone.
  // Extract the lookup block between the COUNT(*) query and the v_preview_cfg_id assignment.
  const match = fixture.match(/v_preview_cfg_count[\s\S]*?v_preview_cfg_id\s*:=/);
  assert.ok(match !== null, "Fixture must contain a preview config count + id resolution block");
  const lookupBlock = match[0];
  assert.ok(
    /organization_id\s*=\s*v_org_id/.test(lookupBlock),
    "Preview config lookup must filter by organization_id = v_org_id"
  );
  assert.ok(
    /configuration_type\s*=\s*'residential_pricing'/.test(lookupBlock),
    "Preview config lookup must filter by configuration_type = residential_pricing"
  );
  assert.ok(
    /version\s*=\s*'W4-PREVIEW-ACCEPT-2026-08-v1'/.test(lookupBlock),
    "Preview config lookup must filter by version = W4-PREVIEW-ACCEPT-2026-08-v1"
  );
});

// ── 12. No production UPDATE of ON-2026-08-v1.0 ──────────────────────────────
test("12. fixture does not UPDATE the production ON-2026-08-v1.0 config row", () => {
  // Any UPDATE touching configuration_version where version = ON-2026-08-v1.0 is forbidden
  const updateMatches = [...fixture.matchAll(/UPDATE\s+public\.configuration_version[\s\S]*?ON-2026-08-v1\.0/gi)];
  assert.equal(updateMatches.length, 0,
    "Fixture must never UPDATE the production configuration_version row");
});

// ── 13. Full production config snapshot comparison exists ─────────────────────
test("13. fixture captures and compares full production config snapshot", () => {
  assert.ok(
    fixture.includes("v_prod_cfg_snapshot") &&
    fixture.includes("to_jsonb(cv)") &&
    fixture.includes("v_prod_cfg_snapshot_after") &&
    /v_prod_cfg_snapshot\s*<>\s*v_prod_cfg_snapshot_after/.test(fixture),
    "Fixture must capture to_jsonb(cv) before writes and compare again before COMMIT"
  );
});

// ── 14. Required evidence test policy is exactly w4_preview_completion_photo / photo_after / 1 / mandatory / external ──
test("14. required evidence policy contract: w4_preview_completion_photo / photo_after / required_count=1 / mandatory / external_ref", () => {
  assert.ok(fixture.includes("'w4_preview_completion_photo'"), "requirement_key must be w4_preview_completion_photo");
  assert.ok(fixture.includes("'photo_after'"), "evidence_type must be photo_after");
  assert.ok(/required_count\s*=\s*1/.test(fixture), "required_count must be 1 in policy assertion");
  assert.ok(/is_mandatory\s*=\s*true/.test(fixture), "is_mandatory must be true in policy assertion");
  assert.ok(/requires_external_reference\s*=\s*true/.test(fixture), "requires_external_reference must be true in policy assertion");
});

// ── 15. Quote lifecycle contains draft → sent → accepted ─────────────────────
test("15. quote lifecycle: draft → sent → accepted via UPDATE steps", () => {
  // Must INSERT as draft
  assert.ok(
    /INSERT\s+INTO\s+public\.quote_version[\s\S]*?'draft'/.test(fixture),
    "quote_version must be INSERTed as draft"
  );
  // Must UPDATE to sent
  assert.ok(
    /UPDATE\s+public\.quote_version[\s\S]*?lifecycle_status\s*=\s*'sent'/.test(fixture),
    "quote_version must be UPDATEd to sent"
  );
  // Must UPDATE to accepted
  assert.ok(
    /UPDATE\s+public\.quote_version[\s\S]*?lifecycle_status\s*=\s*'accepted'/.test(fixture),
    "quote_version must be UPDATEd to accepted"
  );
});

// ── 16. Accepted quote_response exists ───────────────────────────────────────
test("16. accepted quote_response is inserted", () => {
  assert.ok(
    /INSERT\s+INTO\s+public\.quote_response[\s\S]*?'accepted'/.test(fixture),
    "fixture must INSERT a quote_response with response_type = accepted"
  );
});

// ── 17. Worker assignment contains proposed → assigned → acknowledged ──────────
test("17. worker_assignment lifecycle: proposed → assigned → acknowledged via UPDATE steps", () => {
  assert.ok(
    /INSERT\s+INTO\s+public\.worker_assignment[\s\S]*?'proposed'/.test(fixture),
    "worker_assignment must be INSERTed as proposed"
  );
  assert.ok(
    /UPDATE\s+public\.worker_assignment[\s\S]*?assignment_status\s*=\s*'assigned'/.test(fixture),
    "worker_assignment must be UPDATEd to assigned"
  );
  assert.ok(
    /UPDATE\s+public\.worker_assignment[\s\S]*?assignment_status\s*=\s*'acknowledged'/.test(fixture),
    "worker_assignment must be UPDATEd to acknowledged"
  );
});

// ── 18. Work order contains draft → published → in_progress → service_complete → qa_complete ──
test("18. work_order lifecycle: draft → published → in_progress → service_complete → qa_complete via UPDATE steps", () => {
  assert.ok(
    /INSERT\s+INTO\s+public\.work_order[\s\S]*?'draft'/.test(fixture),
    "work_order must be INSERTed as draft"
  );
  assert.ok(
    /UPDATE\s+public\.work_order[\s\S]*?work_order_status\s*=\s*'published'/.test(fixture),
    "work_order must be UPDATEd to published"
  );
  assert.ok(
    /UPDATE\s+public\.work_order[\s\S]*?work_order_status\s*=\s*'in_progress'/.test(fixture),
    "work_order must be UPDATEd to in_progress"
  );
  assert.ok(
    /UPDATE\s+public\.work_order[\s\S]*?work_order_status\s*=\s*'service_complete'/.test(fixture),
    "work_order must be UPDATEd to service_complete"
  );
  assert.ok(
    /UPDATE\s+public\.work_order[\s\S]*?work_order_status\s*=\s*'qa_complete'/.test(fixture),
    "work_order must be UPDATEd to qa_complete"
  );
});

// ── 19. Failed QA remains failed and no update changes it ─────────────────────
test("19. failed qa_inspection is INSERT-only and is never UPDATEd in fixture", () => {
  const qaUpdates = [...fixture.matchAll(/UPDATE\s+public\.qa_inspection/gi)];
  assert.equal(qaUpdates.length, 0,
    "Fixture must never UPDATE qa_inspection — failed baseline must remain immutable");
  assert.ok(
    /INSERT\s+INTO\s+public\.qa_inspection[\s\S]*?'failed'/.test(fixture),
    "fixture must INSERT qa_inspection with inspection_status = failed"
  );
});

// ── 20. Fixture contains no DELETE ───────────────────────────────────────────
test("20. fixture contains no DELETE statement", () => {
  const deleteMatches = [...fixture.matchAll(/^\s*DELETE\s+FROM/gim)];
  assert.equal(deleteMatches.length, 0,
    "Fixture must contain no DELETE statements — it is append-only");
});

// ── 21. Fixture contains no huc_* mutation ────────────────────────────────────
test("21. fixture contains no huc_* table mutation (INSERT/UPDATE/DELETE)", () => {
  const hucMutations = [
    ...fixture.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?huc_/gi)
  ];
  assert.equal(hucMutations.length, 0,
    "Fixture must not mutate any huc_* tables");
});

// ── 22. Fixture does not reference or invoke M007/M008/M009/M010/Wave3/cleanup ──
test("22. fixture does not reference or invoke M007, M008, M009, M010, Wave3 E2E, or cleanup", () => {
  const forbidden = [
    /007_wave3_operations/i,
    /008_wave3_operations_rehearsal/i,
    /009_wave4_delivery/i,
    /010_wave4_delivery/i,
    /wave3_e2e/i,
    /cleanup\.sql/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(fixture), `Fixture must not reference: ${pattern}`);
  }
});

// ── 23. No invented persisted W4E checklist/task references remain ─────────────
test("23. no invented W4E checklist or taskset references in fixture", () => {
  assert.ok(
    !fixture.includes("w4-preview-acceptance-checklist-v1"),
    "Fixture must not contain invented checklist reference w4-preview-acceptance-checklist-v1"
  );
  assert.ok(
    !fixture.includes("w4-preview-acceptance-taskset-v1"),
    "Fixture must not contain invented taskset reference w4-preview-acceptance-taskset-v1"
  );
});

// ── 24. Final output SELECT includes worker_assignment_id ─────────────────────
test("24. final SELECT output includes worker_assignment_id", () => {
  assert.ok(
    /worker_assignment_id/.test(fixture),
    "Final output row must include worker_assignment_id"
  );
});

// ── 25. Operational job lifecycle uses forward transitions, not direct qa_pending insert ──
test("25. operational_job is inserted as ready_to_schedule and transitioned via UPDATEs to qa_pending", () => {
  assert.ok(
    /INSERT\s+INTO\s+public\.operational_job[\s\S]*?'ready_to_schedule'/.test(fixture),
    "operational_job must be INSERTed as ready_to_schedule"
  );
  assert.ok(
    /UPDATE\s+public\.operational_job[\s\S]*?operational_status\s*=\s*'qa_pending'/.test(fixture),
    "operational_job must be UPDATEd to qa_pending via UPDATE, not direct INSERT"
  );
});
