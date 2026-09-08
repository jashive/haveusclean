import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFlightControlPipeline } from "../src/lib/serviceosFlightControlClassification.js";
import {
  SERVICEOS_WORKSPACE_INVALIDATED_EVENT,
  serviceOSInvalidationMatches,
} from "../src/lib/serviceosFinancialPerformance.js";

const [shell, cockpit, kpi, board, client, css] = await Promise.all([
  readFile(new URL("../src/features/wave1/ServiceOSWave1Workspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/AdminCockpitLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/ExecutiveKpiBar.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/ServiceOSFlightControlBoard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/serviceosFlightControl.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("workspace invalidation is shared and territory isolated", () => {
  assert.equal(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, "serviceos:workspace-invalidated");
  assert.equal(serviceOSInvalidationMatches({ detail: { businessUnitId: "az" } }, "az"), true);
  assert.equal(serviceOSInvalidationMatches({ detail: { businessUnitId: "on" } }, "az"), false);
  assert.equal(serviceOSInvalidationMatches({}, "az"), true);
});

test("flight-control pipeline states are mutually exclusive", () => {
  const rows = ["ready_to_schedule", "scheduled", "dispatched", "in_progress", "qa_pending", "closed"].map((operational_status, index) => ({ id: index, operational_status }));
  const result = classifyFlightControlPipeline(rows);
  assert.deepEqual(result.inbound.map((row) => row.operational_status), ["ready_to_schedule", "scheduled"]);
  assert.deepEqual(result.inFlight.map((row) => row.operational_status), ["dispatched", "in_progress"]);
  assert.equal(result.inbound.some((row) => result.inFlight.includes(row)), false);
});

test("executive KPI bar uses governed financial performance without a new API", () => {
  for (const label of ["Gross Booking Value", "Cleaner Labor Accrual %", "Net Realized Margin %", "Completed Jobs"]) assert.match(kpi, new RegExp(label));
  assert.match(kpi, /fetchFinancialPerformance/);
  assert.match(kpi, /SERVICEOS_WORKSPACE_INVALIDATED_EVENT/);
  assert.doesNotMatch(kpi, /\/api\//);
  assert.match(cockpit, /<ExecutiveKpiBar revenueContext=\{revenueContext\}/);
});

test("administrative cockpit composes four governed lanes and actions", () => {
  for (const label of ["Inbound & Dispatch", "In-Flight", "QA Review", "Settlement", "Pass QA", "Waive", "Approve payout"]) assert.match(board, new RegExp(label));
  for (const rpc of ["get_qa_review_queue", "get_cleaner_payables_dashboard", "staff_finalize_qa_inspection", "staff_approve_contractor_payables"]) assert.match(client, new RegExp(rpc));
  assert.match(shell, /<AdminCockpitLayout session=\{session\}/);
  assert.match(cockpit, /<ServiceOSFlightControlBoard session=\{session\}/);
  assert.doesNotMatch(board + client, /\/api\/flight|\/api\/cockpit/);
});

test("cockpit exposes persistent commercial workspaces without a secondary drawer", () => {
  for (const label of ["AdminWorkspaceNavigation", "PipelineDispatchWorkspace", "ServiceOSStaffAdminWorkspace", "CleanerPayablesPanel"]) assert.match(cockpit, new RegExp(label));
  for (const action of ["AssignmentQuickAction", "QaEvidenceDrawer", "SettlementQuickAction"]) assert.match(board, new RegExp(action));
  assert.match(cockpit, /data-admin-default-view="flight-control"/);
  assert.doesNotMatch(cockpit, /SecondaryWorkspaceDrawer/);
});

test("cockpit refreshes on events, focus, visibility, and bounded polling", () => {
  assert.match(board, /visibilitychange/);
  assert.match(board, /setInterval[\s\S]*30000/);
  assert.match(board, /serviceos:open-dispatch/);
  assert.match(css, /\.flight-control-grid/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.flight-control-grid\{grid-template-columns:1fr/);
});

test("generic service-definition direction is not preempted by trade-specific cockpit code", () => {
  assert.doesNotMatch(board + client + kpi, /landscap/i);
});
