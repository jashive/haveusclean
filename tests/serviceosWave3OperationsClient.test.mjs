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
