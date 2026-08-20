// tests/serviceosWave3OperationsClient.test.mjs
//
// Tests for serviceosOperationsClient.js.
// All network calls are mocked; no real DB calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Source text checks (no-network, no-@supabase) ─────────────────────────────

const clientSrc = readFileSync(
  resolve(__dirname, "../src/lib/serviceosOperationsClient.js"),
  "utf8"
);

test("serviceosOperationsClient does not import @supabase/supabase-js", () => {
  // Strip comment lines before checking
  const codeOnly = clientSrc.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.ok(
    !codeOnly.includes("@supabase/supabase-js"),
    "must not use @supabase/supabase-js"
  );
});

test("serviceosOperationsClient uses VITE_SERVICEOS_OPERATIONS_ENABLED flag", () => {
  assert.ok(
    clientSrc.includes("VITE_SERVICEOS_OPERATIONS_ENABLED"),
    "must reference the correct feature flag"
  );
});

test("serviceosOperationsClient does not default feature flag to true", () => {
  // Flag check must compare against the string "true", never default to true
  assert.ok(
    clientSrc.includes('=== "true"'),
    "feature flag check must use strict equality to string \"true\""
  );
  // Must not contain a literal `true` default that bypasses the flag
  assert.ok(
    !clientSrc.match(/isOperationsEnabled\s*\(\s*\)\s*\{[\s\S]{0,50}return true/),
    "isOperationsEnabled must not hard-return true"
  );
});

test("serviceosOperationsClient does not modify serviceosRevenueClient", () => {
  // Strip comment lines before checking
  const codeOnly = clientSrc.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.ok(
    !codeOnly.includes("serviceosRevenueClient"),
    "operations client must not reference revenueClient"
  );
});

test("serviceosOperationsClient does not reference upstream Wave 1/2 mutating tables", () => {
  // Must not INSERT/UPDATE into Wave 1/2 tables
  const forbidden = [
    "service_request",
    "opportunity",
    "estimate",
    "pricing_snapshot",
    "quote",
    "quote_version",
    "quote_response",
    "conversion_record",
    "job_handoff",
    "customer",
    "contact",
  ];
  for (const table of forbidden) {
    // insertOne/updateById calls with those table names
    const pattern = new RegExp(`insertOne\\s*\\(\\s*["'\`]${table}["'\`]`);
    assert.ok(
      !pattern.test(clientSrc),
      `operations client must not insert into Wave 1/2 table: ${table}`
    );
    const updatePattern = new RegExp(`updateById\\s*\\(\\s*["'\`]${table}["'\`]`);
    assert.ok(
      !updatePattern.test(clientSrc),
      `operations client must not update Wave 1/2 table: ${table}`
    );
  }
});

test("serviceosOperationsClient cleanup targets Wave 3 tables only", () => {
  // cleanup order must include Wave 3 tables
  const wave3Tables = [
    "operational_handoff",
    "qa_inspection",
    "service_checklist_result",
    "completion_evidence",
    "work_order_event",
    "work_order",
    "worker_assignment",
    "schedule_window",
    "operational_job",
  ];
  for (const table of wave3Tables) {
    assert.ok(
      clientSrc.includes(table),
      `cleanup must reference Wave 3 table: ${table}`
    );
  }
});

test("serviceosOperationsClient cleanup does not target upstream Wave 1/2 authority tables", () => {
  // cleanup function must not deleteById upstream tables
  const upstreamProtected = [
    "job_handoff",
    "conversion_record",
    "quote_version",
    "pricing_snapshot",
    "customer",
    "contact",
    "service_location",
    "worker",
  ];
  // Extract only the cleanupOperationsPilotSession function body
  const cleanupStart = clientSrc.indexOf("export async function cleanupOperationsPilotSession");
  const cleanupEnd = clientSrc.indexOf("\nexport ", cleanupStart + 1);
  const cleanupBody = cleanupStart >= 0
    ? clientSrc.slice(cleanupStart, cleanupEnd > 0 ? cleanupEnd : undefined)
    : "";

  for (const table of upstreamProtected) {
    // table must NOT appear as a deleteById target inside cleanup
    const deletePattern = new RegExp(`deleteById\\s*\\(\\s*["'\`]${table}["'\`]`);
    assert.ok(
      !deletePattern.test(cleanupBody),
      `cleanup must NOT deleteById upstream table: ${table}`
    );
  }
});

test("serviceosOperationsClient errors include table, operation, HTTP status", () => {
  assert.ok(
    clientSrc.includes("HTTP"),
    "error messages must include HTTP status label"
  );
  assert.ok(
    clientSrc.includes("table") || clientSrc.includes("on ${table}"),
    "error messages must include the table name"
  );
});

test("fetchEligibleJobHandoffs query requests ready canonical handoffs with capped reads", () => {
  const fnBody = getExportedFunctionSource("fetchEligibleJobHandoffs");
  assert.ok(fnBody.includes("job_handoff"), "must read job_handoff");
  assert.ok(fnBody.includes("handoff_status=eq.ready"), "must request ready handoffs only");
  assert.ok(fnBody.includes("limit=20"), "must cap preview handoff discovery");
  assert.ok(
    fnBody.includes("order=handed_off_at.desc.nullslast,created_at.desc.nullslast"),
    "must prefer newest handoffs first"
  );
});

test("fetchEligibleJobHandoffs excludes handoffs already used by operational_job via read check", () => {
  const fnBody = getExportedFunctionSource("fetchEligibleJobHandoffs");
  assert.ok(fnBody.includes('"operational_job"'), "must read operational_job for used handoff check");
  assert.ok(
    fnBody.includes("job_handoff_id=in."),
    "must query operational_job by discovered handoff IDs"
  );
  assert.ok(
    fnBody.includes("usedHandoffIds"),
    "must build used handoff set from read rows"
  );
  assert.ok(
    fnBody.includes("return handoffs.filter"),
    "must exclude already used handoffs from selector options"
  );
});

test("fetchActiveWorkers query requests active canonical workers only", () => {
  const fnBody = getExportedFunctionSource("fetchActiveWorkers");
  assert.ok(fnBody.includes('"worker"'), "must read worker table");
  assert.ok(fnBody.includes("status=eq.active"), "must request active workers only");
  assert.ok(
    fnBody.includes("select=id,organization_id,business_unit_id,worker_type,display_name,email,status,metadata"),
    "must include required worker selector fields"
  );
});

test("discovery methods are read-only GET paths and do not call create/update/delete helpers", () => {
  const handoffFn = getExportedFunctionSource("fetchEligibleJobHandoffs");
  const workerFn = getExportedFunctionSource("fetchActiveWorkers");
  const combined = `${handoffFn}\n${workerFn}`;
  assert.ok(combined.includes("fetchMany("), "discovery should use read helper fetchMany");
  assert.ok(!combined.includes("insertOne("), "discovery must not insert");
  assert.ok(!combined.includes("updateById("), "discovery must not update");
  assert.ok(!combined.includes("deleteById("), "discovery must not delete");
});

test("serviceosOperationsClient does not silently swallow errors", () => {
  // There must be no empty catch blocks
  const emptyCatch = /catch\s*\([^)]*\)\s*\{\s*\}/g;
  assert.ok(
    !emptyCatch.test(clientSrc),
    "must not silently swallow errors with empty catch"
  );
});

// ── Feature flag fail-closed behavior (runtime) ───────────────────────────────
//
// We exercise the flag guard by importing the client in a context where
// import.meta.env is not set (Node test runner — falls back to "").
// The assertEnabled() call must throw for every exported function.

import * as opsClient from "../src/lib/serviceosOperationsClient.js";

const WRITE_FNS = [
  "createOperationalJob",
  "createScheduleWindow",
  "createWorkerAssignment",
  "createWorkOrder",
  "createWorkOrderEvent",
  "createCompletionEvidence",
  "createChecklistResult",
  "createQaInspection",
  "createCorrectiveAction",
  "createOperationalHandoff",
];

const READ_FNS = [
  "fetchJobHandoffById",
  "fetchOperationalJobById",
  "fetchOperationalJobByHandoffId",
  "fetchScheduleWindowsForJob",
  "fetchAssignmentsForJob",
  "fetchWorkOrderForJob",
  "fetchEventsForWorkOrder",
  "fetchEvidenceForWorkOrder",
  "fetchChecklistForWorkOrder",
  "fetchQaInspectionsForJob",
  "fetchCorrectiveActionsForJob",
  "fetchOperationalHandoffForJob",
  "fetchEligibleJobHandoffs",
  "fetchActiveWorkers",
  "fetchConversionRecordById",
  "fetchServiceLocationById",
];

const LIFECYCLE_FNS = [
  "updateOperationalJobStatus",
  "updateScheduleWindowStatus",
  "updateWorkerAssignmentStatus",
  "updateWorkOrderStatus",
  "updateQaInspectionStatus",
  "updateCorrectiveActionStatus",
  "updateOperationalHandoffStatus",
];

const CLEANUP_FNS = ["cleanupOperationsPilotSession"];

const ALL_GUARDED = [...WRITE_FNS, ...READ_FNS, ...LIFECYCLE_FNS, ...CLEANUP_FNS];

for (const fnName of ALL_GUARDED) {
  test(`feature flag fail-closed: ${fnName} throws when flag is off`, async () => {
    const fn = opsClient[fnName];
    assert.ok(typeof fn === "function", `${fnName} must be exported`);
    await assert.rejects(
      () => fn("dummy", "dummy", "dummy"),
      /VITE_SERVICEOS_OPERATIONS_ENABLED is not true/,
      `${fnName} must throw when VITE_SERVICEOS_OPERATIONS_ENABLED is not true`
    );
  });
}

// ── Lifecycle update method validation ───────────────────────────────────────

function getExportedFunctionSource(functionName) {
  const fnStart = clientSrc.indexOf(`export async function ${functionName}`);
  const fnEnd = clientSrc.indexOf("\nexport ", fnStart + 1);
  return clientSrc.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
}

test("updateOperationalJobStatus source text only patches lifecycle fields", () => {
  const fnBody = getExportedFunctionSource("updateOperationalJobStatus");
  assert.ok(!fnBody.includes("pricing_snapshot"), "must not patch pricing_snapshot");
  assert.ok(!fnBody.includes("quote_version"), "must not patch quote_version");
  assert.ok(!fnBody.includes("price"), "must not patch price");
});

test("updateQaInspectionStatus does not patch nonexistent audit columns", () => {
  const fnBody = getExportedFunctionSource("updateQaInspectionStatus");
  assert.ok(
    !fnBody.includes("updated_by_app_user_id"),
    "qa_inspection updates must not include updated_by_app_user_id"
  );
});

test("updateQaInspectionStatus patch keeps allowed lifecycle fields", () => {
  const fnBody = getExportedFunctionSource("updateQaInspectionStatus");
  assert.ok(fnBody.includes("inspection_status"), "qa update must patch inspection_status");
  assert.ok(fnBody.includes("updated_at"), "qa update may patch updated_at");
  assert.ok(fnBody.includes("inspected_at"), "qa final status may patch inspected_at");
});

test("updateOperationalHandoffStatus sends only handoff_status", () => {
  const fnBody = getExportedFunctionSource("updateOperationalHandoffStatus");
  assert.ok(
    /const patch = \{\s*handoff_status: newStatus,\s*\};/s.test(fnBody),
    "operational_handoff patch must contain only handoff_status"
  );
  assert.ok(
    !fnBody.includes("updated_by_app_user_id"),
    "operational_handoff update must not patch updated_by_app_user_id"
  );
  assert.ok(
    !fnBody.includes("updated_at"),
    "operational_handoff update must not patch updated_at"
  );
});

test("lifecycle helpers do not patch pricing_snapshot_id or quote_version_id", () => {
  const lifecycleFnNames = [
    "updateOperationalJobStatus",
    "updateScheduleWindowStatus",
    "updateWorkerAssignmentStatus",
    "updateWorkOrderStatus",
    "updateQaInspectionStatus",
    "updateCorrectiveActionStatus",
    "updateOperationalHandoffStatus",
  ];
  for (const fnName of lifecycleFnNames) {
    const fnBody = getExportedFunctionSource(fnName);
    assert.ok(
      !fnBody.includes("pricing_snapshot_id"),
      `${fnName} must not patch pricing_snapshot_id`
    );
    assert.ok(
      !fnBody.includes("quote_version_id"),
      `${fnName} must not patch quote_version_id`
    );
  }
});

// ── createdRecords attachment ─────────────────────────────────────────────────

test("attachOperationsCreatedRecords attaches records to error", () => {
  const err = new Error("test error");
  const records = { operationalJob: { id: "oj-1" } };
  const attached = opsClient.attachOperationsCreatedRecords(err, records);
  assert.ok(attached instanceof Error);
  assert.deepEqual(attached.createdRecords, records);
});

test("getOperationsCreatedRecords returns createdRecords from error", () => {
  const err = new Error("fail");
  err.createdRecords = { scheduleWindow: { id: "sw-1" } };
  const result = opsClient.getOperationsCreatedRecords(err);
  assert.deepEqual(result, { scheduleWindow: { id: "sw-1" } });
});

test("getOperationsCreatedRecords returns null for non-attached error", () => {
  const err = new Error("bare error");
  const result = opsClient.getOperationsCreatedRecords(err);
  assert.equal(result, null);
});

test("isWorkerScopeCompatibleWithHandoff allows enterprise worker (null BU) in same organization", () => {
  const ok = opsClient.isWorkerScopeCompatibleWithHandoff(
    { organization_id: "org-1", business_unit_id: null },
    { organization_id: "org-1", business_unit_id: "bu-1" }
  );
  assert.equal(ok, true);
});

test("isWorkerScopeCompatibleWithHandoff rejects different business unit worker", () => {
  const ok = opsClient.isWorkerScopeCompatibleWithHandoff(
    { organization_id: "org-1", business_unit_id: "bu-2" },
    { organization_id: "org-1", business_unit_id: "bu-1" }
  );
  assert.equal(ok, false);
});

test("isWorkerScopeCompatibleWithHandoff rejects different organization worker", () => {
  const ok = opsClient.isWorkerScopeCompatibleWithHandoff(
    { organization_id: "org-2", business_unit_id: null },
    { organization_id: "org-1", business_unit_id: "bu-1" }
  );
  assert.equal(ok, false);
});

// ── Pilot panel starts from job_handoff, not creating revenue chain ───────────

test("ServiceOSOperationsPilotPanel does not import runRevenuePipeline", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    !panelSrc.includes("runRevenuePipeline"),
    "operations pilot must not create a new revenue chain"
  );
  assert.ok(
    !panelSrc.includes("serviceosRevenueClient"),
    "operations pilot must not import revenue client"
  );
  assert.ok(
    panelSrc.includes("fetchJobHandoffById"),
    "operations pilot must start from fetchJobHandoffById"
  );
  assert.ok(
    panelSrc.includes("fetchEligibleJobHandoffs"),
    "operations pilot must support eligible handoff discovery"
  );
  assert.ok(
    panelSrc.includes("fetchActiveWorkers"),
    "operations pilot must support active worker discovery"
  );
  assert.ok(
    panelSrc.includes("job_handoff_id"),
    "operations pilot must accept job_handoff_id input"
  );
});

test("ServiceOSOperationsPilotPanel requires both feature flags", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(panelSrc.includes("VITE_SERVICEOS_OPERATIONS_ENABLED"), "must check OPERATIONS_ENABLED");
  assert.ok(panelSrc.includes("VITE_SERVICEOS_OPERATIONS_PILOT_UI"), "must check OPERATIONS_PILOT_UI");
});

test("production flags not defaulted true in pilot panel", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  // Both flags must compare against "true"
  assert.ok(
    panelSrc.includes('=== "true"'),
    "flags must require strict string equality to \"true\""
  );
  // Must not default to literal true
  assert.ok(
    !panelSrc.match(/OPERATIONS_ENABLED\s*=\s*true[^"']/),
    "OPERATIONS_ENABLED must not default to true"
  );
});

test("pilot panel includes preview selector controls and empty-state messages", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc.includes("Load Eligible Handoffs"),
    "panel must expose eligible handoff loader"
  );
  assert.ok(
    panelSrc.includes("Load Active Workers"),
    "panel must expose active worker loader"
  );
  assert.ok(
    panelSrc.includes("No unused ready canonical job handoffs were found."),
    "panel must expose handoff empty-state text"
  );
  assert.ok(
    panelSrc.includes("No active compatible canonical workers were found."),
    "panel must expose worker empty-state text"
  );
});

test("pilot panel keeps manual UUID fallback inputs and requires both IDs to run", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc.includes("manual fallback"),
    "manual fallback labels must remain for debug input"
  );
  assert.ok(
    panelSrc.includes("const canRun = !!(accessToken && jobHandoffId.trim() && workerId.trim());"),
    "pilot run must require both handoff_id and worker_id"
  );
  assert.ok(
    panelSrc.includes("!workerId.trim()"),
    "run button hint should block until worker_id is provided"
  );
});

test("pilot discovery load handlers do not call create methods", async () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const handoffHandlerStart = panelSrc.indexOf("const handleLoadEligibleHandoffs");
  const handoffHandlerEnd = panelSrc.indexOf("const handleSelectEligibleHandoff", handoffHandlerStart);
  const handoffHandler = panelSrc.slice(handoffHandlerStart, handoffHandlerEnd > 0 ? handoffHandlerEnd : undefined);
  assert.ok(!handoffHandler.includes("createOperationalJob"), "handoff load must not call create methods");
  assert.ok(!handoffHandler.includes("createScheduleWindow"), "handoff load must stay read-only");
  assert.ok(handoffHandler.includes("fetchEligibleJobHandoffs"), "handoff load should use discovery read");

  const workerHandlerStart = panelSrc.indexOf("const handleLoadActiveWorkers");
  const workerHandlerEnd = panelSrc.indexOf("const handleRun", workerHandlerStart);
  const workerHandler = panelSrc.slice(workerHandlerStart, workerHandlerEnd > 0 ? workerHandlerEnd : undefined);
  assert.ok(!workerHandler.includes("createWorkerAssignment"), "worker load must not call create methods");
  assert.ok(!workerHandler.includes("createOperationalJob"), "worker load must stay read-only");
  assert.ok(workerHandler.includes("fetchActiveWorkers"), "worker load should use worker read discovery");
});

test("runOperationsPilot checks worker_id requirement before first create", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const runFnStart = panelSrc.indexOf("async function runOperationsPilot");
  const runFnEnd = panelSrc.indexOf("// ── Component", runFnStart);
  const runFnBody = panelSrc.slice(runFnStart, runFnEnd > 0 ? runFnEnd : undefined);
  const workerRequiredIdx = runFnBody.indexOf('new Error("worker_id is required for assignment step — provide a safe Preview worker ID")');
  const createJobIdx = runFnBody.indexOf("createOperationalJob");
  assert.ok(workerRequiredIdx >= 0, "run should enforce worker_id requirement");
  assert.ok(createJobIdx >= 0, "run should still create operational_job when valid");
  assert.ok(
    workerRequiredIdx < createJobIdx,
    "worker_id requirement must happen before any write calls begin"
  );
});

// ── JobsView canonical integration not enabled ────────────────────────────────

test("JobsView.jsx does not import Wave 3 operations modules", async () => {
  let jobsViewSrc = "";
  try {
    const { existsSync } = await import("fs");
    const jobsViewPath = resolve(__dirname, "../src/features/jobs/JobsView.jsx");
    if (existsSync(jobsViewPath)) {
      jobsViewSrc = readFileSync(jobsViewPath, "utf8");
    }
  } catch {
    // file may not exist — that's fine
  }
  if (jobsViewSrc) {
    assert.ok(
      !jobsViewSrc.includes("serviceosOperationsClient"),
      "JobsView must not import operations client"
    );
    assert.ok(
      !jobsViewSrc.includes("ServiceOSOperationsPilotPanel"),
      "JobsView must not directly mount the operations pilot panel"
    );
  }
});

// ── Cleanup reverse dependency order validation ───────────────────────────────

test("cleanup order: operational_handoff appears before operational_job in source", () => {
  const cleanupBody = getExportedFunctionSource("cleanupOperationsPilotSession");
  const handoffIdx = cleanupBody.indexOf('"operational_handoff"');
  const ojIdx = cleanupBody.indexOf('"operational_job"');
  assert.ok(
    handoffIdx < ojIdx,
    "operational_handoff must be cleaned up before operational_job"
  );
});

test("cleanup order: work_order appears before schedule_window in source", () => {
  const cleanupBody = getExportedFunctionSource("cleanupOperationsPilotSession");
  const woIdx = cleanupBody.indexOf('"work_order"');
  const swIdx = cleanupBody.indexOf('"schedule_window"');
  assert.ok(
    woIdx < swIdx,
    "work_order must be cleaned up before schedule_window"
  );
});

// ── verifyPilotSessionState: TABLE_MAP and safety ─────────────────────────────

test("verifyPilotSessionState TABLE_MAP maps checklistResult to service_checklist_result", () => {
  // The TABLE_MAP must contain the canonical pilot key 'checklistResult'
  assert.ok(
    clientSrc.includes('"checklistResult"') && clientSrc.includes('"service_checklist_result"'),
    "checklistResult key must be present and mapped to service_checklist_result"
  );
  // Confirm the mapping is on the same line or adjacent
  const tableMapStart = clientSrc.indexOf("const TABLE_MAP");
  const tableMapEnd = clientSrc.indexOf("};", tableMapStart);
  const tableMapBlock = clientSrc.slice(tableMapStart, tableMapEnd + 2);
  assert.ok(
    tableMapBlock.includes("checklistResult") && tableMapBlock.includes("service_checklist_result"),
    "checklistResult must map to service_checklist_result inside TABLE_MAP"
  );
});

test("verifyPilotSessionState does not use label as table name fallback", () => {
  // The unsafe '?? label' fallback must be absent from the verifier function
  const verifyFnStart = clientSrc.indexOf("export async function verifyPilotSessionState");
  const verifyFnEnd = clientSrc.indexOf("\nexport", verifyFnStart + 1);
  const verifyFn = clientSrc.slice(verifyFnStart, verifyFnEnd > 0 ? verifyFnEnd : undefined);
  assert.ok(
    !verifyFn.includes("?? label"),
    "verifyPilotSessionState must not fall back to using label as a table name"
  );
});

test("verifyPilotSessionState rejects unknown labels as unsupported (never arbitrary table)", () => {
  const verifyFnStart = clientSrc.indexOf("export async function verifyPilotSessionState");
  const verifyFnEnd = clientSrc.indexOf("\nexport", verifyFnStart + 1);
  const verifyFn = clientSrc.slice(verifyFnStart, verifyFnEnd > 0 ? verifyFnEnd : undefined);
  assert.ok(
    verifyFn.includes('"unsupported"'),
    "unknown labels must be marked unsupported, not used as table names"
  );
  assert.ok(
    !verifyFn.includes("?? label"),
    "unsafe label fallback must not be present"
  );
});

test("verifyPilotSessionState uses only fetchOneById (no fetchMany, no writes)", () => {
  const verifyFnStart = clientSrc.indexOf("export async function verifyPilotSessionState");
  const verifyFnEnd = clientSrc.indexOf("\nexport", verifyFnStart + 1);
  const verifyFn = clientSrc.slice(verifyFnStart, verifyFnEnd > 0 ? verifyFnEnd : undefined);
  assert.ok(verifyFn.includes("fetchOneById"), "verifier must use fetchOneById");
  assert.ok(!verifyFn.includes("fetchMany"), "verifier must not use fetchMany");
  assert.ok(!verifyFn.includes("insertOne"), "verifier must not use insertOne");
  assert.ok(!verifyFn.includes("updateById"), "verifier must not use updateById");
  assert.ok(!verifyFn.includes("deleteById"), "verifier must not use deleteById");
});

// ── Panel: verification UI is present and Preview-gated ───────────────────────

test("panel includes Verify Current Pilot Records button", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc.includes("Verify Current Pilot Records"),
    "panel must have a Verify Current Pilot Records control"
  );
});

test("panel verification UI is gated behind OPERATIONS_PILOT_UI_ENABLED", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const verifyBtnIdx = panelSrc.indexOf("Verify Current Pilot Records");
  const pilotUiCheckIdx = panelSrc.lastIndexOf("OPERATIONS_PILOT_UI_ENABLED", verifyBtnIdx);
  assert.ok(
    pilotUiCheckIdx >= 0,
    "Verify Current Pilot Records must appear inside an OPERATIONS_PILOT_UI_ENABLED guard"
  );
});

test("panel exposes manual recovery JSON textarea labeled correctly", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc.includes("Pilot verification IDs (read-only verification only)"),
    "panel must have the exact recovery textarea label"
  );
});

test("panel handleVerify does not call runOperationsPilot or cleanupOperationsPilotSession", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const verifyHandlerStart = panelSrc.indexOf("const handleVerify");
  const verifyHandlerEnd = panelSrc.indexOf("\n  const ", verifyHandlerStart + 1);
  const verifyHandler = panelSrc.slice(verifyHandlerStart, verifyHandlerEnd > 0 ? verifyHandlerEnd : undefined);
  assert.ok(
    !verifyHandler.includes("runOperationsPilot"),
    "handleVerify must not call runOperationsPilot"
  );
  assert.ok(
    !verifyHandler.includes("cleanupOperationsPilotSession"),
    "handleVerify must not call cleanupOperationsPilotSession"
  );
  assert.ok(
    verifyHandler.includes("verifyPilotSessionState"),
    "handleVerify must call verifyPilotSessionState"
  );
});

test("panel handleVerify uses verifyPilotSessionState not any write calls", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const verifyHandlerStart = panelSrc.indexOf("const handleVerify");
  const verifyHandlerEnd = panelSrc.indexOf("\n  const ", verifyHandlerStart + 1);
  const verifyHandler = panelSrc.slice(verifyHandlerStart, verifyHandlerEnd > 0 ? verifyHandlerEnd : undefined);
  assert.ok(!verifyHandler.includes("insertOne"), "handleVerify must not call insertOne");
  assert.ok(!verifyHandler.includes("updateById"), "handleVerify must not call updateById");
  assert.ok(!verifyHandler.includes("deleteById"), "handleVerify must not call deleteById");
  assert.ok(!verifyHandler.includes("createOperationalJob"), "handleVerify must not call createOperationalJob");
});

test("panel malformed JSON guard prevents network requests", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  // The handler must parse JSON before calling verifyPilotSessionState
  const verifyHandlerStart = panelSrc.indexOf("const handleVerify");
  const verifyHandlerEnd = panelSrc.indexOf("\n  const ", verifyHandlerStart + 1);
  const verifyHandler = panelSrc.slice(verifyHandlerStart, verifyHandlerEnd > 0 ? verifyHandlerEnd : undefined);
  const parseIdx = verifyHandler.indexOf("JSON.parse");
  const verifyCallIdx = verifyHandler.indexOf("verifyPilotSessionState");
  assert.ok(parseIdx >= 0, "handler must call JSON.parse on manual input");
  assert.ok(
    parseIdx < verifyCallIdx,
    "JSON.parse must occur before verifyPilotSessionState to gate network calls"
  );
  // On parse error it must return early (setting an error state) not proceed
  assert.ok(
    verifyHandler.includes("Malformed JSON"),
    "malformed JSON must produce a clear validation error message"
  );
});

test("panel verification can use current createdIds (no manual JSON required)", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const verifyHandlerStart = panelSrc.indexOf("const handleVerify");
  const verifyHandlerEnd = panelSrc.indexOf("\n  const ", verifyHandlerStart + 1);
  const verifyHandler = panelSrc.slice(verifyHandlerStart, verifyHandlerEnd > 0 ? verifyHandlerEnd : undefined);
  assert.ok(
    verifyHandler.includes("createdIds") && verifyHandler.includes("verifyJson"),
    "handleVerify must support both createdIds (runtime) and manual verifyJson (recovery) paths"
  );
});

test("panel verification requires explicit button click — not automatic on paste", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  // onChange for the textarea must only update state, not call handleVerify
  const textareaOnChangeStart = panelSrc.indexOf("setVerifyJson(e.target.value)");
  assert.ok(textareaOnChangeStart >= 0, "textarea onChange must update verifyJson state");
  // The verify call must be on button onClick, not in onChange
  const onChangeSnippet = panelSrc.slice(
    panelSrc.lastIndexOf("onChange", textareaOnChangeStart),
    textareaOnChangeStart + 40
  );
  assert.ok(
    !onChangeSnippet.includes("handleVerify"),
    "textarea onChange must not automatically trigger handleVerify"
  );
});

// ── recoverOperationalHandoff tests ──────────────────────────────────────────

test("recoverOperationalHandoff is exported from serviceosOperationsClient", () => {
  assert.ok(
    clientSrc.includes("export async function recoverOperationalHandoff"),
    "recoverOperationalHandoff must be exported"
  );
});

test("recoverOperationalHandoff reads only exact operational_job and work_order by ID", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  // Must use fetchOneById for operational_job and work_order
  assert.ok(
    fnSrc.includes('fetchOneById("operational_job"'),
    "must fetch operational_job by exact ID"
  );
  assert.ok(
    fnSrc.includes('fetchOneById("work_order"'),
    "must fetch work_order by exact ID"
  );
});

test("recoverOperationalHandoff uses exact operational_job_id filter for duplicate check — no broad scan", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  // Duplicate check uses fetchMany with operational_job_id=eq. filter and limit=1
  assert.ok(
    fnSrc.includes("operational_job_id=eq."),
    "duplicate check must use exact operational_job_id filter"
  );
  assert.ok(
    fnSrc.includes("limit=1"),
    "duplicate check must use limit=1 to avoid broad scan"
  );
});

test("recoverOperationalHandoff does not perform DELETE or UPDATE", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    !fnSrc.includes("deleteById"),
    "recoverOperationalHandoff must not call deleteById"
  );
  assert.ok(
    !fnSrc.includes("updateById"),
    "recoverOperationalHandoff must not call updateById"
  );
  assert.ok(
    !fnSrc.includes('method: "DELETE"'),
    "recoverOperationalHandoff must not issue DELETE requests"
  );
  assert.ok(
    !fnSrc.includes('method: "PATCH"'),
    "recoverOperationalHandoff must not issue PATCH requests"
  );
});

test("recoverOperationalHandoff inserts only into operational_handoff — not checklist or qa_inspection", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  // Must insert into operational_handoff
  assert.ok(
    fnSrc.includes('insertOne("operational_handoff"'),
    "must insert into operational_handoff"
  );
  // Must NOT insert into service_checklist_result or qa_inspection
  assert.ok(
    !fnSrc.includes('insertOne("service_checklist_result"'),
    "must not insert into service_checklist_result"
  );
  assert.ok(
    !fnSrc.includes('insertOne("qa_inspection"'),
    "must not insert into qa_inspection"
  );
});

test("recoverOperationalHandoff payload does not include qa_inspection_id", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  // The payload object must not set qa_inspection_id to a non-null value
  // It must be explicitly omitted (→ NULL in DB)
  const payloadStart = fnSrc.indexOf("const payload =");
  const payloadEnd = fnSrc.indexOf("};", payloadStart) + 2;
  const payloadSrc = fnSrc.slice(payloadStart, payloadEnd);

  assert.ok(
    !payloadSrc.includes("qa_inspection_id:") ||
      payloadSrc.includes("// qa_inspection_id"),
    "payload must not set qa_inspection_id to a value (must be omitted → NULL)"
  );
});

test("recoverOperationalHandoff derives pricing_snapshot_id and quote_version_id from operational_job", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    fnSrc.includes("job.pricing_snapshot_id"),
    "pricing_snapshot_id must come from the fetched operational_job row"
  );
  assert.ok(
    fnSrc.includes("job.quote_version_id"),
    "quote_version_id must come from the fetched operational_job row"
  );
});

test("recoverOperationalHandoff metadata includes all required recovery fields", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    fnSrc.includes('"wave3_failed_cleanup_boundary_restore"'),
    "metadata must include recovery_type"
  );
  assert.ok(
    fnSrc.includes('"02dd1ede-4b8e-4d49-994f-e9a0a1357aa3"'),
    "metadata must include original_operational_handoff_id"
  );
  assert.ok(
    fnSrc.includes('"dcb8468c-1a22-4b44-aba5-7d5dce2fc43d"'),
    "metadata must include original_qa_inspection_id"
  );
  assert.ok(
    fnSrc.includes('"a677ba08-a961-484c-a501-5529b826f5e5"'),
    "metadata must include original_checklist_result_id"
  );
  assert.ok(
    fnSrc.includes('"PASS"'),
    "metadata must include original_e2e_result: PASS"
  );
  assert.ok(
    fnSrc.includes("recovered_boundary_only: true"),
    "metadata must include recovered_boundary_only: true"
  );
});

test("recoverOperationalHandoff returns already_present when duplicate handoff exists", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    fnSrc.includes('"already_present"'),
    "must return mode: already_present when a handoff already exists"
  );
  assert.ok(
    fnSrc.includes("return { mode: \"already_present\""),
    "must return without inserting when duplicate is found"
  );
});

test("recoverOperationalHandoff fails closed when job status is unsupported", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  // Must include valid job status check
  assert.ok(
    fnSrc.includes("qa_passed") && fnSrc.includes("closed"),
    "must check operational_job.operational_status against qa_passed/closed"
  );
  assert.ok(
    fnSrc.includes("VALID_RECOVERY_JOB_STATUSES") || fnSrc.includes("validJobStatuses"),
    "must use a named list for valid job statuses"
  );
});

test("recoverOperationalHandoff fails closed when work_order status is unsupported", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    fnSrc.includes("service_complete") && fnSrc.includes("qa_complete"),
    "must check work_order.work_order_status against service_complete/qa_complete/closed"
  );
});

test("recoverOperationalHandoff does not call runOperationsPilot", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    !fnSrc.includes("runOperationsPilot"),
    "recoverOperationalHandoff must not call runOperationsPilot"
  );
});

test("recoverOperationalHandoff does not call cleanupOperationsPilotSession", () => {
  const start = clientSrc.indexOf("export async function recoverOperationalHandoff");
  const end = clientSrc.indexOf("\nexport ", start + 1);
  const fnSrc = clientSrc.slice(start, end > 0 ? end : undefined);

  assert.ok(
    !fnSrc.includes("cleanupOperationsPilotSession"),
    "recoverOperationalHandoff must not call cleanupOperationsPilotSession"
  );
});

test("panel handleRecoverHandoff requires explicit confirm click — not immediate execution", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const handlerStart = panelSrc.indexOf("const handleRecoverHandoff");
  const handlerEnd = panelSrc.indexOf("\n  const ", handlerStart + 1);
  const handlerSrc = panelSrc.slice(handlerStart, handlerEnd > 0 ? handlerEnd : undefined);

  // Must check for "confirming" stage before executing
  assert.ok(
    handlerSrc.includes('"confirming"'),
    "handler must use a confirming stage before executing recovery"
  );
  // Must set recoveryStage to confirming on first click
  assert.ok(
    handlerSrc.includes('setRecoveryStage("confirming")'),
    "handler must set stage to confirming on first click"
  );
  // Must only call recoverOperationalHandoff after confirmation
  const confirmingIdx = handlerSrc.indexOf('"confirming"');
  const recoverCallIdx = handlerSrc.indexOf("recoverOperationalHandoff(");
  assert.ok(
    confirmingIdx < recoverCallIdx,
    "recoverOperationalHandoff call must appear after the confirming guard"
  );
});

test("panel recovery section only renders when OPERATIONS_PILOT_UI_ENABLED", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  // The recovery UI section must be guarded by OPERATIONS_PILOT_UI_ENABLED
  const recoverySectionIdx = panelSrc.indexOf("Restore Wave 3 Handoff Boundary");
  assert.ok(recoverySectionIdx >= 0, "panel must contain recovery section heading");

  // Find the nearest OPERATIONS_PILOT_UI_ENABLED guard before the section
  const guardIdx = panelSrc.lastIndexOf("OPERATIONS_PILOT_UI_ENABLED", recoverySectionIdx);
  assert.ok(
    guardIdx >= 0 && guardIdx < recoverySectionIdx,
    "recovery section must be guarded by OPERATIONS_PILOT_UI_ENABLED"
  );
});

test("panel recovery UI displays qa_inspection_id as null in result", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  // The result display must show qa_inspection_id: null
  assert.ok(
    panelSrc.includes("qa_inspection_id") && panelSrc.includes(">null<"),
    "recovery result UI must display qa_inspection_id as null"
  );
});

test("panel recovery UI displays original deleted handoff ID", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc.includes("WAVE3_RECOVERY_ORIGINAL_HANDOFF_ID"),
    "recovery result UI must reference the original deleted handoff ID constant"
  );
  assert.ok(
    panelSrc.includes("02dd1ede-4b8e-4d49-994f-e9a0a1357aa3"),
    "original deleted handoff ID constant must contain the correct UUID"
  );
});

test("panel recovery does not call runOperationsPilot", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const handlerStart = panelSrc.indexOf("const handleRecoverHandoff");
  const handlerEnd = panelSrc.indexOf("\n  const ", handlerStart + 1);
  const handlerSrc = panelSrc.slice(handlerStart, handlerEnd > 0 ? handlerEnd : undefined);
  assert.ok(
    !handlerSrc.includes("runOperationsPilot"),
    "handleRecoverHandoff must not call runOperationsPilot"
  );
});

test("panel recovery does not call cleanupOperationsPilotSession", () => {
  const panelSrc = readFileSync(
    resolve(__dirname, "../src/features/pilot/ServiceOSOperationsPilotPanel.jsx"),
    "utf8"
  );
  const handlerStart = panelSrc.indexOf("const handleRecoverHandoff");
  const handlerEnd = panelSrc.indexOf("\n  const ", handlerStart + 1);
  const handlerSrc = panelSrc.slice(handlerStart, handlerEnd > 0 ? handlerEnd : undefined);
  assert.ok(
    !handlerSrc.includes("cleanupOperationsPilotSession"),
    "handleRecoverHandoff must not call cleanupOperationsPilotSession"
  );
});

test("existing verifyPilotSessionState behavior is unchanged", () => {
  // Verify that verifyPilotSessionState is still exported and unchanged
  assert.ok(
    clientSrc.includes("export async function verifyPilotSessionState"),
    "verifyPilotSessionState must remain exported"
  );
  // TABLE_MAP keys must still be present
  assert.ok(
    clientSrc.includes('"operationalHandoff": "operational_handoff"') ||
      clientSrc.includes("operationalHandoff: \"operational_handoff\""),
    "TABLE_MAP must still map operationalHandoff"
  );
  assert.ok(
    clientSrc.includes('"checklistResult": "service_checklist_result"') ||
      clientSrc.includes("checklistResult: \"service_checklist_result\""),
    "TABLE_MAP must still map checklistResult"
  );
});
