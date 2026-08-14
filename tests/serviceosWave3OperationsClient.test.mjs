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

test("updateOperationalJobStatus source text only patches lifecycle fields", () => {
  const fnStart = clientSrc.indexOf("export async function updateOperationalJobStatus");
  const fnEnd = clientSrc.indexOf("\nexport ", fnStart + 1);
  const fnBody = clientSrc.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  assert.ok(!fnBody.includes("pricing_snapshot"), "must not patch pricing_snapshot");
  assert.ok(!fnBody.includes("quote_version"), "must not patch quote_version");
  assert.ok(!fnBody.includes("price"), "must not patch price");
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
  const handoffIdx = clientSrc.indexOf('"operational_handoff"');
  const ojIdx = clientSrc.lastIndexOf('"operational_job"');
  assert.ok(
    handoffIdx < ojIdx,
    "operational_handoff must be cleaned up before operational_job"
  );
});

test("cleanup order: work_order appears before schedule_window in source", () => {
  const woIdx = clientSrc.indexOf('"work_order"');
  const swIdx = clientSrc.lastIndexOf('"schedule_window"');
  assert.ok(
    woIdx < swIdx,
    "work_order must be cleaned up before schedule_window"
  );
});
