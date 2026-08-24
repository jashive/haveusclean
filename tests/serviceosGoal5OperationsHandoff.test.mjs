import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260824233000_goal5_operations_valid_accepted_handoff.sql",
  "utf8"
);
const opsClient = fs.readFileSync("src/lib/serviceosOperationsClient.js", "utf8");
const revenueMigration = fs.readFileSync(
  "supabase/migrations/20260824172000_goal5_customer_response_acceptance.sql",
  "utf8"
);

test("Operations queue requests only ready handoffs", () => {
  const start = opsClient.indexOf("export async function fetchEligibleJobHandoffs");
  const end = opsClient.indexOf("\nexport ", start + 1);
  const body = opsClient.slice(start, end > 0 ? end : undefined);
  assert.match(body, /handoff_status=eq\.ready/);
  assert.match(body, /operational_job/);
  assert.match(body, /usedHandoffIds/);
});

test("Revenue accepted transition creates handoff explicitly as ready", () => {
  assert.match(revenueMigration, /'ready'/);
  assert.match(revenueMigration, /response_type='accepted'|p_response_type='accepted'|p_response_type = 'accepted'/);
});

test("operational_job insert guard requires a ready handoff", () => {
  assert.match(migration, /v_jh\.handoff_status <> 'ready'/);
  assert.match(migration, /job_handoff must be ready/);
});

test("operational_job insert guard revalidates exact accepted quote response", () => {
  assert.match(migration, /FROM public\.quote_response/);
  assert.match(migration, /v_qr\.quote_version_id <> NEW\.quote_version_id/);
  assert.match(migration, /v_qr\.response_type <> 'accepted'/);
  assert.match(migration, /accepted quote_response for exact quote_version is required/);
});

test("operational_job insert guard revalidates accepted quote version and pricing snapshot", () => {
  assert.match(migration, /FROM public\.quote_version/);
  assert.match(migration, /v_qv\.lifecycle_status <> 'accepted'/);
  assert.match(migration, /v_qv\.pricing_snapshot_id <> NEW\.pricing_snapshot_id/);
});

test("Operations boundary requires exact conversion and handoff lineage", () => {
  assert.match(migration, /v_jh\.conversion_record_id <> NEW\.conversion_record_id/);
  assert.match(migration, /v_jh\.quote_version_id <> NEW\.quote_version_id/);
  assert.match(migration, /v_cr\.quote_version_id <> NEW\.quote_version_id/);
  assert.match(migration, /v_cr\.customer_id <> NEW\.customer_id/);
  assert.match(migration, /v_cr\.contact_id <> NEW\.contact_id/);
  assert.match(migration, /v_cr\.service_location_id <> NEW\.service_location_id/);
});

test("Operations boundary preserves customer/location jurisdiction lineage", () => {
  assert.match(migration, /v_sl\.customer_id <> NEW\.customer_id/);
  assert.match(migration, /v_sl\.jurisdiction_id <> NEW\.jurisdiction_id/);
});

test("Goal 5.4 guard remains invoker-security with pinned search path", () => {
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});
