import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql=fs.readFileSync("supabase/migrations/20260907213000_phase3_intelligence_kpi_remediation.sql","utf8");
const booking=fs.readFileSync("api/bookings/create.js","utf8");
const geocode=fs.readFileSync("server-internal/service-location-geocoding.js","utf8");
const dashboard=fs.readFileSync("src/features/intelligence/Os10IntelligenceDashboard.jsx","utf8");
const payables=fs.readFileSync("src/features/wave5/CleanerPayablesPanel.jsx","utf8");
const worker=fs.readFileSync("src/features/wave3/ServiceOSOperationsWorkspace.jsx","utf8");

test("QA finalization seals payables and realized profitability atomically",()=>{
  assert.match(sql,/staff_finalize_qa_inspection[\s\S]*for v_a in select \* from public\.worker_assignment/);
  assert.match(sql,/v_wo\.service_completed_at-v_wo\.started_at/);
  assert.match(sql,/compensation_method='hourly'/);
  assert.match(sql,/v_amount:=round\(v_c\.rate_value\*v_hours,2\)/);
  assert.match(sql,/insert into public\.contractor_payable/);
  assert.match(sql,/on conflict\(worker_assignment_id,contractor_compensation_version_id\) do nothing/);
  assert.match(sql,/insert into public\.job_profitability_snapshot/);
});
test("compensation and payables are territory and currency governed",()=>{
  assert.match(sql,/staff_set_worker_hourly_compensation/);
  assert.match(sql,/when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD'/);
  assert.match(payables,/Set governed rate/); assert.match(payables,/Export payroll CSV/);
  assert.match(worker,/data-worker-earned-payout="true"/);
});
test("booking geocoding uses the consolidated function and postal fallback",()=>{
  assert.match(booking,/persistLocationGeocode/); assert.match(booking,/service_role_set_location_geocode/);
  assert.match(geocode,/GOOGLE_MAPS_GEOCODING_API_KEY/); assert.match(geocode,/GEOCODING_POSTAL_CENTROIDS_JSON/);
  assert.match(geocode,/GOVERNED_POSTAL_CENTROIDS/);
  assert.match(geocode,/governed_postal_centroid_registry_v1/);
  assert.match(sql,/current_user not in \('service_role','postgres'\)/);
});
test("route, capacity, cadence and realized margin have live inputs",()=>{
  assert.match(sql,/lag\(latitude\) over\(partition by service_date/);
  assert.match(sql,/staff_set_worker_weekly_capacity/); assert.match(sql,/sync_booking_recurring_cadence/);
  assert.match(sql,/ensure_work_order_recurring_cadence/); assert.match(dashboard,/record_type === "realized"/);
});
test("Phase 3 adds no Vercel function",()=>{
  assert.equal(fs.readdirSync("api",{recursive:true}).filter(name=>String(name).endsWith(".js")).length,12);
});
