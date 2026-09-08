import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterWorkOrderHistory, normalizeDispatchJob } from "../src/lib/serviceosPipelineDispatch.js";

const [workspace, navigation, calendar, queue, history, client] = await Promise.all([
  readFile(new URL("../src/features/admin/PipelineDispatchWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/AdminWorkspaceNavigation.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/DispatchCalendar.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/UnscheduledWorkQueue.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin/WorkOrderHistoryTable.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/serviceosPipelineDispatch.js", import.meta.url), "utf8"),
]);

test("admin navigation presents four commercial workspaces with stable URLs", () => {
  for (const label of ["Flight Control", "Pipeline & Dispatch", "Team & Hiring", "Financial Ledgers"]) assert.match(navigation, new RegExp(label));
  for (const path of ["/admin", "/admin/dispatch", "/admin/team", "/admin/financials"]) assert.match(navigation, new RegExp(path.replaceAll("/", "\\/")));
});

test("dispatch read model normalizes governed relational records", () => {
  const job = normalizeDispatchJob({ id: "job-1", job_handoff_id: "handoff-1", operational_status: "scheduled", service_family: "residential_cleaning", created_at: "2026-09-08T10:00:00Z", customer: { display_name: "Avery Client" }, service_location: { address_line1: "10 Main St", city: "Phoenix", subdivision: "AZ" }, pricing_snapshot: { total_amount: "192.50", currency_code: "USD" }, schedule_window: [{ scheduled_start: "2026-09-09T16:00:00Z", scheduled_end: "2026-09-09T18:00:00Z", status: "confirmed", created_at: "2026-09-08T10:00:00Z" }], work_order: [{ id: "wo-1", work_order_number: "WO-100", work_order_status: "published", created_at: "2026-09-08T10:01:00Z" }], worker_assignment: [{ assignment_status: "assigned", worker: { display_name: "Cynthia Douglass" } }] });
  assert.equal(job.customerName, "Avery Client"); assert.equal(job.handoffId, "handoff-1"); assert.equal(job.totalAmount, 192.5); assert.deepEqual(job.workerNames, ["Cynthia Douglass"]);
});

test("work-order search is deterministic across customer, address, cleaner, and status", () => {
  const rows = [{ customerName: "Avery Client", address: "Phoenix", workOrderNumber: "WO-100", serviceFamily: "cleaning", workerNames: ["Cynthia"], operationalStatus: "closed", workOrderStatus: "closed" }];
  assert.equal(filterWorkOrderHistory(rows, "cynthia", "all").length, 1); assert.equal(filterWorkOrderHistory(rows, "phoenix", "scheduled").length, 0);
});

test("workspace composes calendar, unscheduled queue, history, and existing assignment workflow", () => {
  for (const component of ["DispatchCalendar", "UnscheduledWorkQueue", "WorkOrderHistoryTable", "ServiceOSOperationsWorkspace"]) assert.match(workspace, new RegExp(component));
  assert.match(calendar, /Governed schedule/); assert.match(queue, /Unscheduled work/); assert.match(history, /type="search"/); assert.match(client, /authenticatedRestFetchWithRefresh/); assert.match(client, /fetchEligibleJobHandoffs/); assert.match(client, /enrichHandoffForDispatch/); assert.doesNotMatch(client + workspace, /\/api\//);
});

test("Pipeline & Dispatch adds no schema migration or serverless function", () => {
  assert.equal(fs.readdirSync(new URL("../api", import.meta.url), { recursive: true }).filter((name) => String(name).endsWith(".js")).length, 12);
  assert.equal(fs.readdirSync(new URL("../supabase/migrations", import.meta.url)).some((name) => name.includes("pipeline_dispatch_workspace")), false);
});
