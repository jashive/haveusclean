// tests/serviceosWave3WorkerBootstrap.test.mjs
//
// Tests for Wave 3 Preview-only legacy workforce bootstrap.
// Verifies:
//   - fetchLegacyWorkerCandidates is GET-only (no writes)
//   - promoteWorkerToCanonical guards, idempotency, payload rules
//   - No createOperationalJob or Wave 3 operational records during promotion
//   - job_handoff not modified during promotion
//   - huc_partners not modified or deleted
//   - Pilot panel UI exposes explicit bootstrap controls
//   - Existing selectors and cleanup safety remain intact

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const clientSrc = readFileSync(
  resolve(__dirname, "../src/lib/serviceosOperationsClient.js"),
  "utf8"
);

const panelSrc = readFileSync(
  resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
  "utf8"
);

// ── Helper: extract exported function source ──────────────────────────────────

function getExportedFunctionSource(src, functionName) {
  const fnStart = src.indexOf(`export async function ${functionName}`);
  if (fnStart < 0) return "";
  const fnEnd = src.indexOf("\nexport ", fnStart + 1);
  return src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
}

// ── Source structure checks ───────────────────────────────────────────────────

test("fetchLegacyWorkerCandidates is exported from serviceosOperationsClient", () => {
  assert.ok(
    clientSrc.includes("export async function fetchLegacyWorkerCandidates"),
    "fetchLegacyWorkerCandidates must be exported"
  );
});

test("promoteWorkerToCanonical is exported from serviceosOperationsClient", () => {
  assert.ok(
    clientSrc.includes("export async function promoteWorkerToCanonical"),
    "promoteWorkerToCanonical must be exported"
  );
});

// ── fetchLegacyWorkerCandidates: GET-only ─────────────────────────────────────

test("fetchLegacyWorkerCandidates reads from huc_partners via GET-only helpers", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "fetchLegacyWorkerCandidates");
  assert.ok(fnBody.includes("huc_partners"), "must read from huc_partners");
  assert.ok(fnBody.includes("fetchMany("), "must use read-only fetchMany");
  assert.ok(!fnBody.includes("insertOne("), "must not call insertOne on huc_partners");
  assert.ok(!fnBody.includes("updateById("), "must not call updateById on huc_partners");
  assert.ok(!fnBody.includes("deleteById("), "must not call deleteById on huc_partners");
});

test("fetchLegacyWorkerCandidates does not expose pin or other secret fields", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "fetchLegacyWorkerCandidates");
  assert.ok(
    !fnBody.includes("d.pin") && !fnBody.includes('"pin"') && !fnBody.includes("'pin'"),
    "candidate mapping must not return pin field"
  );
});

test("fetchLegacyWorkerCandidates returns safe identification fields only", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "fetchLegacyWorkerCandidates");
  assert.ok(fnBody.includes("source_id"), "must include source_id");
  assert.ok(fnBody.includes("d.name"), "must include name from data");
  assert.ok(fnBody.includes("d.email"), "must include email from data");
});

test("fetchLegacyWorkerCandidates excludes already-promoted candidates", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "fetchLegacyWorkerCandidates");
  assert.ok(fnBody.includes('"worker"'), "must read worker table to check for existing promotions");
  assert.ok(
    fnBody.includes("bootstrap_reason") || fnBody.includes("source_record_id"),
    "must filter by lineage markers to exclude already-promoted candidates"
  );
  assert.ok(fnBody.includes(".filter("), "must filter candidates");
});

// ── promoteWorkerToCanonical: guards ─────────────────────────────────────────

test("promoteWorkerToCanonical requires candidate.source_id", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("candidate.source_id") || fnBody.includes("candidate?.source_id"),
    "must validate candidate.source_id"
  );
  assert.ok(
    fnBody.includes("source_id is required"),
    "must throw descriptive error when source_id is missing"
  );
});

test("promoteWorkerToCanonical requires handoff.organization_id and handoff.business_unit_id", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("handoff.organization_id") || fnBody.includes("handoff?.organization_id"),
    "must validate handoff.organization_id"
  );
  assert.ok(
    fnBody.includes("handoff.business_unit_id") || fnBody.includes("handoff?.business_unit_id"),
    "must validate handoff.business_unit_id"
  );
});

test("promoteWorkerToCanonical requires accessToken", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(fnBody.includes("accessToken"), "must check accessToken");
  assert.ok(
    fnBody.includes("accessToken is required"),
    "must throw when accessToken is missing"
  );
});

// ── promoteWorkerToCanonical: organization + BU come from handoff ─────────────

test("promoteWorkerToCanonical uses organization_id from handoff, not from candidate", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("handoff.organization_id"),
    "organization_id must come from handoff"
  );
  assert.ok(
    !fnBody.includes("candidate.organization_id"),
    "organization_id must not be taken from candidate"
  );
});

test("promoteWorkerToCanonical uses business_unit_id from handoff, not from candidate", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("handoff.business_unit_id"),
    "business_unit_id must come from handoff"
  );
  assert.ok(
    !fnBody.includes("candidate.business_unit_id"),
    "business_unit_id must not be taken from candidate"
  );
});

// ── promoteWorkerToCanonical: canonical worker payload fields ─────────────────

test("promoteWorkerToCanonical sets status to active", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(fnBody.includes("status: \"active\""), "worker status must be active");
});

test("promoteWorkerToCanonical sets conservative worker_type (contractor default)", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("worker_type") && fnBody.includes("contractor"),
    "worker_type must default conservatively to contractor"
  );
});

test("promoteWorkerToCanonical includes source traceability metadata", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(fnBody.includes("source_system"), "metadata must include source_system");
  assert.ok(fnBody.includes('"huc_partners"'), "source_system must be huc_partners");
  assert.ok(fnBody.includes("source_record_id"), "metadata must include source_record_id");
  assert.ok(fnBody.includes("bootstrap_reason"), "metadata must include bootstrap_reason");
  assert.ok(fnBody.includes("wave3_preview_pilot"), "bootstrap_reason must be wave3_preview_pilot");
  assert.ok(fnBody.includes("migration_mode"), "metadata must include migration_mode");
  assert.ok(
    fnBody.includes("controlled_preview_bootstrap"),
    "migration_mode must be controlled_preview_bootstrap"
  );
});

test("promoteWorkerToCanonical uses display_name from candidate source, not fabricated", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("candidate.name"),
    "display_name must come from candidate.name (real source data)"
  );
  assert.ok(
    !fnBody.includes("Synthetic Worker"),
    "display_name must not use a synthetic/fabricated value"
  );
  assert.ok(
    !fnBody.includes('"Unknown"'),
    'display_name must not fall back to "Unknown" placeholder'
  );
});

// ── promoteWorkerToCanonical: null/empty/whitespace name blocks promotion ─────

test("promoteWorkerToCanonical blocks promotion when candidate.name is null", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("!candidate.name"),
    "must guard against null or falsy candidate.name before building payload"
  );
  assert.ok(
    fnBody.includes("canonical promotion blocked"),
    "error message must reference canonical promotion blocked"
  );
});

test("promoteWorkerToCanonical blocks promotion when candidate.name is empty string", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // empty string is falsy — same !candidate.name guard covers it
  assert.ok(
    fnBody.includes("!candidate.name"),
    "falsy guard must cover empty string"
  );
});

test("promoteWorkerToCanonical blocks promotion when candidate.name is whitespace-only", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes(".trim()"),
    "must trim and reject whitespace-only names"
  );
});

test("promoteWorkerToCanonical does not insert worker when name is invalid", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // The throw must appear BEFORE the insertOne call
  const throwIdx = fnBody.indexOf("canonical promotion blocked");
  const insertIdx = fnBody.indexOf("insertOne");
  assert.ok(throwIdx > -1, "error throw must exist");
  assert.ok(insertIdx > -1, "insertOne must exist");
  assert.ok(throwIdx < insertIdx, "name validation throw must come before insertOne");
});

// ── promoteWorkerToCanonical: real phone maps to canonical worker.phone ───────

test("promoteWorkerToCanonical maps candidate.phone to canonical worker.phone", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("workerPayload.phone = candidate.phone") ||
      fnBody.includes("phone: candidate.phone"),
    "real phone must map to canonical worker.phone field"
  );
});

test("promoteWorkerToCanonical does not generate fake phone numbers", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    !fnBody.includes("555-") && !fnBody.includes("fake") && !fnBody.includes("generated"),
    "must not contain fabricated phone patterns"
  );
});

test("promoteWorkerToCanonical omits phone when candidate.phone is missing (null-safe)", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("candidate.phone"),
    "phone assignment must be conditional on candidate.phone presence"
  );
  // phone must NOT be in the workerPayload object literal directly — it is set conditionally
  const payloadLiteralEnd = fnBody.indexOf("};", fnBody.indexOf("const workerPayload"));
  const phoneInLiteral = fnBody.slice(fnBody.indexOf("const workerPayload"), payloadLiteralEnd).includes("phone:");
  assert.ok(!phoneInLiteral, "phone must not be unconditionally set in workerPayload literal");
});

test("promoteWorkerToCanonical uses email from candidate source when present", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("candidate.email"),
    "email must come from candidate.email (real source data)"
  );
});

// ── promoteWorkerToCanonical: idempotency / duplicate prevention ──────────────

test("promoteWorkerToCanonical checks for existing canonical worker before insert", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("_findExistingCanonicalWorkerForSource") ||
      fnBody.includes("findExistingCanonicalWorkerForSource"),
    "must call duplicate-check helper before insert"
  );
  assert.ok(
    fnBody.includes("wasExisting: true"),
    "must return existing worker when already promoted (wasExisting: true)"
  );
});

test("_findExistingCanonicalWorkerForSource checks by source lineage metadata", () => {
  assert.ok(
    clientSrc.includes("metadata->>source_record_id=eq."),
    "duplicate check must query worker by source_record_id in metadata"
  );
});

test("_findExistingCanonicalWorkerForSource checks by email as additional dedup guard", () => {
  assert.ok(
    clientSrc.includes("email=eq."),
    "duplicate check must also query worker by email"
  );
});

// ── promoteWorkerToCanonical: scope safety for existing worker match ───────────

test("promoteWorkerToCanonical accepts existing worker: same org + same BU", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // Scope check must compare organization_id
  assert.ok(
    fnBody.includes("existing.organization_id === handoff.organization_id"),
    "must verify organization_id matches handoff"
  );
  // And must also check business_unit_id equality
  assert.ok(
    fnBody.includes("existing.business_unit_id === handoff.business_unit_id"),
    "must verify business_unit_id matches handoff"
  );
});

test("promoteWorkerToCanonical accepts existing worker: same org + null BU (enterprise/global)", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // null BU on existing worker is permitted
  assert.ok(
    fnBody.includes("existing.business_unit_id == null"),
    "null business_unit_id on existing worker must be allowed (enterprise scope)"
  );
});

test("promoteWorkerToCanonical rejects existing worker from different organization", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // The throw must contain the scope-blocked error
  assert.ok(
    fnBody.includes("outside the selected handoff organization/business-unit scope"),
    "must throw with scope-blocked message when org differs"
  );
  // And must happen inside the existing-worker branch (before insertOne)
  const scopeThrowIdx = fnBody.indexOf("outside the selected handoff organization/business-unit scope");
  const insertIdx = fnBody.indexOf("insertOne");
  assert.ok(scopeThrowIdx < insertIdx, "scope-rejection throw must appear before insertOne");
});

test("promoteWorkerToCanonical rejects existing worker: same org but different non-null BU", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // buMatch requires null OR exact equality — different non-null BU fails both conditions
  assert.ok(
    fnBody.includes("existing.business_unit_id == null") &&
      fnBody.includes("existing.business_unit_id === handoff.business_unit_id"),
    "BU check must require null OR exact match; different non-null BU must be rejected"
  );
});

test("promoteWorkerToCanonical: incompatible existing worker does not cause a second worker insert", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  // Scope throw is inside the `if (existing)` block, before any insertOne call
  const existingBlockStart = fnBody.indexOf("if (existing)");
  const scopeThrow = fnBody.indexOf("outside the selected handoff organization/business-unit scope");
  const insertIdx = fnBody.indexOf("insertOne");
  assert.ok(existingBlockStart > -1, "existing-worker branch must be present");
  assert.ok(scopeThrow > existingBlockStart, "scope throw must be inside existing-worker branch");
  assert.ok(scopeThrow < insertIdx, "scope throw must prevent reaching insertOne");
});

test("promoteWorkerToCanonical: incompatible existing worker does not populate worker_id", () => {
  // The function throws, so callers cannot receive a worker object.
  // Verify that the scope error throw is unconditional (not behind an inner return).
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    fnBody.includes("throw new Error") &&
      fnBody.includes("outside the selected handoff organization/business-unit scope"),
    "must throw (not return) when scope is incompatible — caller cannot set worker_id"
  );
});

test("promoteWorkerToCanonical: incompatible existing worker cannot arm Run Operations Pilot", () => {
  // Run Operations Pilot is armed only when canRun is true, which requires workerId.
  // workerId is set only on success inside handlePromoteWorker's try block.
  // The thrown scope error routes to catch, leaving workerId unchanged.
  const panelBody = panelSrc;
  assert.ok(
    panelBody.includes("setWorkerId(result.worker.id)"),
    "workerId must only be set inside the success (try) path"
  );
  // setWorkerId must NOT appear in the catch block
  const catchIdx = panelBody.indexOf("} catch (err)");
  const catchEnd = panelBody.indexOf("} finally", catchIdx);
  const catchBlock = panelBody.slice(catchIdx, catchEnd > catchIdx ? catchEnd : undefined);
  assert.ok(
    !catchBlock.includes("setWorkerId"),
    "setWorkerId must not be called in catch — incompatible worker cannot arm Run Operations Pilot"
  );
});

test("promoteWorkerToCanonical scope failure: no operational records created", () => {
  // The scope throw exits before any operational record builders are called.
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(!fnBody.includes("createOperationalJob"), "no operational_job on scope failure");
  assert.ok(!fnBody.includes("createScheduleWindow"), "no schedule_window on scope failure");
  assert.ok(!fnBody.includes("createWorkOrder"), "no work_order on scope failure");
  assert.ok(!fnBody.includes("createWorkerAssignment"), "no worker_assignment on scope failure");
});

// ── promoteWorkerToCanonical: does NOT create Wave 3 operational records ──────

test("promoteWorkerToCanonical does not call createOperationalJob", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    !fnBody.includes("createOperationalJob"),
    "worker promotion must not create an operational_job"
  );
});

test("promoteWorkerToCanonical does not call createScheduleWindow", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    !fnBody.includes("createScheduleWindow"),
    "worker promotion must not create a schedule_window"
  );
});

test("promoteWorkerToCanonical does not call createWorkOrder or createWorkerAssignment", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  assert.ok(
    !fnBody.includes("createWorkOrder") && !fnBody.includes("createWorkerAssignment"),
    "worker promotion must not create work_order or worker_assignment"
  );
});

// ── promoteWorkerToCanonical: does NOT modify job_handoff or huc_partners ─────

test("promoteWorkerToCanonical does not insert into or update job_handoff", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  const insertsJobHandoff = /insertOne\s*\(\s*["'`]job_handoff["'`]/.test(fnBody);
  assert.ok(!insertsJobHandoff, "promotion must not insertOne into job_handoff");
  const updateJobHandoff = /updateById\s*\(\s*["'`]job_handoff["'`]/.test(fnBody);
  assert.ok(!updateJobHandoff, "promotion must not updateById on job_handoff");
});

test("promoteWorkerToCanonical does not insert into or update huc_partners", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "promoteWorkerToCanonical");
  const insertPattern = /insertOne\s*\(\s*["'`]huc_partners["'`]/.test(fnBody);
  const updatePattern = /updateById\s*\(\s*["'`]huc_partners["'`]/.test(fnBody);
  const deletePattern = /deleteById\s*\(\s*["'`]huc_partners["'`]/.test(fnBody);
  assert.ok(!insertPattern, "promotion must not insert into huc_partners");
  assert.ok(!updatePattern, "promotion must not update huc_partners");
  assert.ok(!deletePattern, "promotion must not delete from huc_partners");
});

test("fetchLegacyWorkerCandidates does not deleteById huc_partners", () => {
  const fnBody = getExportedFunctionSource(clientSrc, "fetchLegacyWorkerCandidates");
  const deletePattern = /deleteById\s*\(\s*["'`]huc_partners["'`]/.test(fnBody);
  assert.ok(!deletePattern, "candidate loading must not delete from huc_partners");
});

// ── cleanupOperationsPilotSession does not delete worker or huc_partners ──────

test("cleanupOperationsPilotSession does not target worker table", () => {
  const cleanupStart = clientSrc.indexOf("export async function cleanupOperationsPilotSession");
  const cleanupEnd = clientSrc.indexOf("\nexport ", cleanupStart + 1);
  const cleanupBody = cleanupStart >= 0
    ? clientSrc.slice(cleanupStart, cleanupEnd > 0 ? cleanupEnd : undefined)
    : "";
  const deleteWorker = /deleteById\s*\(\s*["'`]worker["'`]/.test(cleanupBody);
  assert.ok(!deleteWorker, "cleanup must not deleteById from worker table");
});

test("cleanupOperationsPilotSession does not target huc_partners table", () => {
  const cleanupStart = clientSrc.indexOf("export async function cleanupOperationsPilotSession");
  const cleanupEnd = clientSrc.indexOf("\nexport ", cleanupStart + 1);
  const cleanupBody = cleanupStart >= 0
    ? clientSrc.slice(cleanupStart, cleanupEnd > 0 ? cleanupEnd : undefined)
    : "";
  const deletePartners = /deleteById\s*\(\s*["'`]huc_partners["'`]/.test(cleanupBody);
  assert.ok(!deletePartners, "cleanup must not deleteById from huc_partners table");
});

// ── cleanupOperationsPilotSession: append-only tables never deleted ───────────

function getCleanupBody() {
  const start = clientSrc.indexOf("export async function cleanupOperationsPilotSession");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  return start >= 0 ? clientSrc.slice(start, end > 0 ? end : undefined) : "";
}

test("cleanupOperationsPilotSession never DELETEs work_order_event", () => {
  const body = getCleanupBody();
  const deletesEvent = /deleteById\s*\(\s*["'`]work_order_event["'`]/.test(body);
  assert.ok(!deletesEvent, "cleanup must never call deleteById on work_order_event");
});

test("cleanupOperationsPilotSession never DELETEs completion_evidence", () => {
  const body = getCleanupBody();
  const deletesEvidence = /deleteById\s*\(\s*["'`]completion_evidence["'`]/.test(body);
  assert.ok(!deletesEvidence, "cleanup must never call deleteById on completion_evidence");
});

test("cleanupOperationsPilotSession returns retained_test_evidence when immutable records exist", () => {
  const body = getCleanupBody();
  assert.ok(
    body.includes('"retained_test_evidence"') || body.includes("retained_test_evidence"),
    "cleanup must include retained_test_evidence result mode"
  );
  assert.ok(
    body.includes("immutableRecordsRetained"),
    "result must include immutableRecordsRetained array"
  );
  assert.ok(
    body.includes("upstreamPreserved"),
    "result must confirm upstream preservation"
  );
});

test("cleanupOperationsPilotSession does not begin partial destructive cleanup when immutable records exist", () => {
  const body = getCleanupBody();
  // The immutable-records detection and return must come BEFORE any deleteById call
  const retainedIdx = body.indexOf("retained_test_evidence");
  const deleteIdx = body.indexOf("deleteById");
  assert.ok(retainedIdx > -1, "retained_test_evidence branch must be present");
  assert.ok(deleteIdx > -1, "deleteById must exist for the mutable-only path");
  assert.ok(
    retainedIdx < deleteIdx,
    "retained_test_evidence return must come before any deleteById — prevents partial destructive cleanup"
  );
});

test("cleanupOperationsPilotSession upstream job_handoff is never deleted", () => {
  const body = getCleanupBody();
  const deletesHandoff = /deleteById\s*\(\s*["'`]job_handoff["'`]/.test(body);
  assert.ok(!deletesHandoff, "cleanup must not deleteById from job_handoff");
});

test("cleanupOperationsPilotSession canonical worker is never deleted", () => {
  const body = getCleanupBody();
  const deletesWorker = /deleteById\s*\(\s*["'`]worker["'`]/.test(body);
  assert.ok(!deletesWorker, "cleanup must not deleteById from worker table");
});

// ── verifyPilotSessionState: GET-only exact-ID verifier ───────────────────────

function getVerifierBody() {
  const start = clientSrc.indexOf("export async function verifyPilotSessionState");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  return start >= 0 ? clientSrc.slice(start, end > 0 ? end : undefined) : "";
}

test("verifyPilotSessionState is exported from serviceosOperationsClient", () => {
  assert.ok(
    clientSrc.includes("export async function verifyPilotSessionState"),
    "verifyPilotSessionState must be exported"
  );
});

test("verifyPilotSessionState uses GET-only reads (fetchOneById, not deleteById or insertOne)", () => {
  const body = getVerifierBody();
  assert.ok(body.length > 0, "verifyPilotSessionState function must exist");
  assert.ok(
    body.includes("fetchOneById"),
    "verifier must use fetchOneById (read-only GET)"
  );
  assert.ok(
    !body.includes("deleteById"),
    "verifier must not call deleteById"
  );
  assert.ok(
    !body.includes("insertOne"),
    "verifier must not call insertOne"
  );
  assert.ok(
    !body.includes("updateById"),
    "verifier must not call updateById"
  );
});

test("verifyPilotSessionState does not broad-scan tables (uses exact id per fetch)", () => {
  const body = getVerifierBody();
  // Uses fetchOneById(table, id, ...) not fetchMany with broad filter
  assert.ok(
    !body.includes("fetchMany"),
    "verifier must not use fetchMany — only exact-ID single-row reads"
  );
});

test("verifyPilotSessionState reports present or absent for each record", () => {
  const body = getVerifierBody();
  assert.ok(
    body.includes('"present"'),
    "verifier must report status present when row found"
  );
  assert.ok(
    body.includes('"absent"'),
    "verifier must report status absent when row not found"
  );
});

test("verifyPilotSessionState covers all required Wave 3 entity types", () => {
  const body = getVerifierBody();
  const required = [
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
  for (const table of required) {
    assert.ok(body.includes(table), `verifier must cover table: ${table}`);
  }
});

test("cleanupOperationsPilotSession does not trigger an operational rerun", () => {
  const body = getCleanupBody();
  assert.ok(!body.includes("runOperationsPilot"), "cleanup must not call runOperationsPilot");
  assert.ok(!body.includes("createOperationalJob"), "cleanup must not create operational records");
  assert.ok(!body.includes("createWorkOrder"), "cleanup must not create work_order");
});

// ── Panel: retained-evidence display ─────────────────────────────────────────

test("pilot panel imports verifyPilotSessionState", () => {
  assert.ok(
    panelSrc.includes("verifyPilotSessionState"),
    "panel must import verifyPilotSessionState"
  );
});

test("pilot panel displays retained-evidence message when cleanup returns retained_test_evidence", () => {
  assert.ok(
    panelSrc.includes("retained_test_evidence"),
    "panel must handle retained_test_evidence result mode"
  );
  assert.ok(
    panelSrc.includes("Wave 3 test evidence retained under canonical append-only governance"),
    "panel must display governance retention message, not imply deletion"
  );
});

// ── Feature flag: new functions are guarded ───────────────────────────────────

import * as opsClient from "../src/lib/serviceosOperationsClient.js";

test("feature flag fail-closed: fetchLegacyWorkerCandidates throws when flag is off", async () => {
  assert.ok(typeof opsClient.fetchLegacyWorkerCandidates === "function", "must be exported");
  await assert.rejects(
    () => opsClient.fetchLegacyWorkerCandidates("dummy-token"),
    /VITE_SERVICEOS_OPERATIONS_ENABLED is not true/,
    "fetchLegacyWorkerCandidates must throw when feature flag is off"
  );
});

test("feature flag fail-closed: promoteWorkerToCanonical throws when flag is off", async () => {
  assert.ok(typeof opsClient.promoteWorkerToCanonical === "function", "must be exported");
  await assert.rejects(
    () => opsClient.promoteWorkerToCanonical({}, {}, "dummy"),
    /VITE_SERVICEOS_OPERATIONS_ENABLED is not true/,
    "promoteWorkerToCanonical must throw when feature flag is off"
  );
});

// ── Pilot panel UI checks ─────────────────────────────────────────────────────

test("pilot panel imports fetchLegacyWorkerCandidates", () => {
  assert.ok(
    panelSrc.includes("fetchLegacyWorkerCandidates"),
    "panel must import fetchLegacyWorkerCandidates"
  );
});

test("pilot panel imports promoteWorkerToCanonical", () => {
  assert.ok(
    panelSrc.includes("promoteWorkerToCanonical"),
    "panel must import promoteWorkerToCanonical"
  );
});

test("pilot panel exposes Load Legacy Worker Candidates button", () => {
  assert.ok(
    panelSrc.includes("Load Legacy Worker Candidates"),
    "panel must expose Load Legacy Worker Candidates button"
  );
});

test("pilot panel exposes Promote Selected Worker to Canonical button", () => {
  assert.ok(
    panelSrc.includes("Promote Selected Worker to Canonical"),
    "panel must expose Promote Selected Worker to Canonical button"
  );
});

test("pilot panel promotion handler is separate from Run Operations Pilot", () => {
  assert.ok(
    panelSrc.includes("handlePromoteWorker"),
    "promotion must have its own dedicated handler"
  );
  assert.ok(
    panelSrc.includes("handleRun"),
    "run operations must still have its own handler"
  );
  // The two must be separate: clicking promote must not call runOperationsPilot
  const promoteHandlerStart = panelSrc.indexOf("const handlePromoteWorker");
  const promoteHandlerEnd = panelSrc.indexOf("\n  const ", promoteHandlerStart + 1);
  const promoteHandlerBody = panelSrc.slice(
    promoteHandlerStart,
    promoteHandlerEnd > 0 ? promoteHandlerEnd : undefined
  );
  assert.ok(
    !promoteHandlerBody.includes("runOperationsPilot"),
    "handlePromoteWorker must not call runOperationsPilot"
  );
});

test("pilot panel promotion requires selected candidate and handoff before enabling button", () => {
  assert.ok(
    panelSrc.includes("selectedCandidateSourceId"),
    "promotion must require a selected candidate source ID"
  );
  assert.ok(
    panelSrc.includes("!selectedCandidateSourceId"),
    "promotion button must be disabled without a selected candidate"
  );
  assert.ok(
    panelSrc.includes("!selectedHandoff && !jobHandoffId.trim()"),
    "promotion must require a handoff to provide org/BU scope"
  );
});

test("pilot panel promotion auto-places canonical worker UUID into worker_id", () => {
  const promoteHandlerStart = panelSrc.indexOf("const handlePromoteWorker");
  const promoteHandlerEnd = panelSrc.indexOf("\n  const formatCandidateOptionLabel", promoteHandlerStart + 1);
  const promoteHandlerBody = panelSrc.slice(
    promoteHandlerStart,
    promoteHandlerEnd > 0 ? promoteHandlerEnd : undefined
  );
  assert.ok(
    promoteHandlerBody.includes("setWorkerId(result.worker.id)"),
    "promotion must auto-place canonical worker UUID into worker_id"
  );
});

test("pilot panel promotion refreshes active workers after successful promotion", () => {
  const promoteHandlerStart = panelSrc.indexOf("const handlePromoteWorker");
  const promoteHandlerEnd = panelSrc.indexOf("\n  const formatCandidateOptionLabel", promoteHandlerStart + 1);
  const promoteHandlerBody = panelSrc.slice(
    promoteHandlerStart,
    promoteHandlerEnd > 0 ? promoteHandlerEnd : undefined
  );
  assert.ok(
    promoteHandlerBody.includes("fetchActiveWorkers"),
    "promotion must refresh active workers list"
  );
  assert.ok(
    promoteHandlerBody.includes("setActiveWorkers"),
    "promotion must update active workers state after refresh"
  );
});

test("pilot panel Load Legacy Worker Candidates handler is read-only (no create calls)", () => {
  const handlerStart = panelSrc.indexOf("const handleLoadLegacyCandidates");
  const handlerEnd = panelSrc.indexOf("const handlePromoteWorker", handlerStart + 1);
  const handlerBody = panelSrc.slice(
    handlerStart,
    handlerEnd > 0 ? handlerEnd : undefined
  );
  assert.ok(
    handlerBody.includes("fetchLegacyWorkerCandidates"),
    "load handler must use fetchLegacyWorkerCandidates"
  );
  assert.ok(
    !handlerBody.includes("createOperationalJob"),
    "load handler must not call createOperationalJob"
  );
  assert.ok(
    !handlerBody.includes("promoteWorkerToCanonical"),
    "load handler must not call promoteWorkerToCanonical"
  );
  assert.ok(
    !handlerBody.includes("insertOne"),
    "load handler must not insert anything"
  );
});

test("pilot panel promotion does not call createOperationalJob in its handler", () => {
  const promoteHandlerStart = panelSrc.indexOf("const handlePromoteWorker");
  const promoteHandlerEnd = panelSrc.indexOf("\n  const formatCandidateOptionLabel", promoteHandlerStart + 1);
  const promoteHandlerBody = panelSrc.slice(
    promoteHandlerStart,
    promoteHandlerEnd > 0 ? promoteHandlerEnd : undefined
  );
  assert.ok(
    !promoteHandlerBody.includes("createOperationalJob"),
    "promotion handler must not invoke createOperationalJob"
  );
  assert.ok(
    !promoteHandlerBody.includes("createScheduleWindow"),
    "promotion handler must not invoke createScheduleWindow"
  );
});

test("Run Operations Pilot button remains a separate manual action after bootstrap addition", () => {
  assert.ok(
    panelSrc.includes("Run Operations Pilot"),
    "Run Operations Pilot button must still exist as separate action"
  );
  assert.ok(
    panelSrc.includes("handleRun"),
    "handleRun must still be wired to the run button"
  );
});

test("pilot panel does not invoke runOperationsPilot automatically during promotion", () => {
  // The promote button's onClick must use handlePromoteWorker, not handleRun.
  // Use a wider window to accommodate the verbose title attribute before the button text.
  const promoteButtonSection = panelSrc.indexOf("Promote Selected Worker to Canonical");
  const nearbyChunk = panelSrc.slice(Math.max(0, promoteButtonSection - 1200), promoteButtonSection + 50);
  assert.ok(
    nearbyChunk.includes("handlePromoteWorker"),
    "Promote button must use handlePromoteWorker"
  );
  assert.ok(
    !nearbyChunk.includes("handleRun"),
    "Promote button must not trigger handleRun"
  );
});
