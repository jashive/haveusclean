import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase/migrations/20260907143000_os10_intelligence_advisory_and_completion_receipt.sql", "utf8");
const api = fs.readFileSync("api/notifications.js", "utf8");
const delivery = fs.readFileSync("src/server/customerCompletionDelivery.js", "utf8");
const ui = fs.readFileSync("src/features/intelligence/Os10IntelligenceDashboard.jsx", "utf8");
const workspace = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");
const operations = fs.readFileSync("src/features/wave3/ServiceOSOperationsWorkspace.jsx", "utf8");

test("completion receipt is consolidated, post-transition, and idempotent", () => {
  assert.match(api, /action === 'customer-completion'/);
  assert.match(operations, /worker_submit_completion_to_qa[\s\S]*postCustomerCompletionReceipt/);
  assert.match(sql, /work_order_status <> 'service_complete'/);
  assert.match(sql, /unique \(work_order_id\)/i);
  assert.match(delivery, /X-HUC-Idempotency-Key/);
});

test("completion receipt validates exact worker assignment and hides recipient from response", () => {
  assert.match(sql, /wa\.operational_job_id = v_job\.id/);
  assert.match(sql, /w\.app_user_id = public\.current_app_user_id\(\)/);
  assert.doesNotMatch(delivery, /recipient_email[^\n]*json\(/);
});

test("single territory-isolated intelligence RPC covers four advisory domains", () => {
  assert.match(sql, /get_os10_intelligence_dashboard/);
  assert.match(sql, /when 'HUC-ON' then 'CAD'/);
  assert.match(sql, /when 'HUC-AZ' then 'USD'/);
  for (const key of ["route_density","capacity","retention","margin_drift"]) assert.match(sql, new RegExp(`'${key}'`));
  assert.match(sql, /security invoker/i);
  assert.match(sql, /p_date_to-p_date_from > 92/);
});

test("capacity is explicit and intelligence cannot mutate operational records", () => {
  assert.match(sql, /worker_capacity_calendar/);
  const fn = sql.slice(sql.indexOf("create or replace function public.get_os10_intelligence_dashboard"));
  assert.doesNotMatch(fn, /update public\.(operational_job|schedule_window|work_order)/i);
});

test("Admin mounts four panels with governed empty states", () => {
  assert.match(workspace, /Os10IntelligenceDashboard/);
  for (const panel of ["RouteDensityPanel","CapacityForecastPanel","RetentionChurnPanel","MarginDriftPanel"]) assert.match(ui, new RegExp(panel));
  assert.match(ui, /No governed data/);
});

test("no additional Vercel function is introduced", () => {
  const functions = fs.readdirSync("api", { recursive: true }).filter(name => name.endsWith(".js"));
  assert.equal(functions.length, 12);
});
