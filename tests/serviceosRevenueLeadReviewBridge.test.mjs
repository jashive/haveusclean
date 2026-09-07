import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync(new URL("../src/features/wave1/ServiceOSLeadIntakePanel.jsx", import.meta.url), "utf8");
const drawer = fs.readFileSync(new URL("../src/features/wave1/ServiceOSLeadReviewDrawer.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/lib/serviceosLeadIntakeClient.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260906235900_revenue_lead_review_walkthrough_bridge.sql", import.meta.url), "utf8");

test("Revenue queue actions open the governed lead review drawer", () => {
  assert.match(panel, /ServiceOSLeadReviewDrawer/);
  assert.match(panel, /walkthroughRequested \? "Schedule walkthrough" : "Open lead"/);
});

test("drawer renders customer, scope, immutable booking estimate, and lifecycle actions", () => {
  for (const label of ["Customer and site", "Scope and pricing snapshot", "Send Formal Quote", "Record Customer Decision", "Assign Cleaner"]) assert.match(drawer, new RegExp(label));
  assert.match(client, /estimated_total/);
  assert.match(drawer, /Custom proposal after walkthrough/);
});

test("commercial walkthrough transition is scoped and cannot create downstream authority", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /has_bu_role\(v_request\.organization_id, v_request\.business_unit_id/);
  assert.match(migration, /array\['owner_admin','office_ops'\]/);
  assert.match(migration, /v_request\.service_category <> 'commercial'/);
  assert.match(migration, /v_request\.lifecycle_status <> 'walkthrough_requested'/);
  assert.match(migration, /stage = 'open'/);
  assert.match(migration, /lifecycle_status = 'qualified'/);
  assert.match(migration, /stage = 'qualified'/);
  for (const forbidden of ["insert into public.pricing_snapshot", "insert into public.quote_response", "insert into public.job_handoff", "insert into public.operational_job", "insert into public.worker_assignment"]) assert.doesNotMatch(migration.toLowerCase(), new RegExp(forbidden));
  assert.match(migration, /grant execute[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon/i);
});

test("drawer preserves customer acceptance and cleaner-controlled start boundaries", () => {
  assert.match(drawer, /explicit customer acceptance/i);
  assert.match(drawer, /“Start Job” remains cleaner-controlled/);
  assert.doesNotMatch(drawer, /lead.*→.*in_progress/i);
});

test("lead review does not add a serverless API route", () => {
  assert.match(client, /rpc\/schedule_commercial_walkthrough/);
  assert.doesNotMatch(client, /\/api\/.*walkthrough/);
});
