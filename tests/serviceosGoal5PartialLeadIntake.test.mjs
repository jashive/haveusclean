import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260825001500_goal5_partial_lead_intake.sql", "utf8");
const client = fs.readFileSync("src/lib/serviceosLeadIntakeClient.js", "utf8");
const panel = fs.readFileSync("src/features/wave1/ServiceOSLeadIntakePanel.jsx", "utf8");
const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");

test("partial intake creates only intake service request and open opportunity", () => {
  assert.match(migration, /'intake'/);
  assert.match(migration, /'open'/);
  assert.doesNotMatch(migration, /INSERT INTO public\.estimate/);
  assert.doesNotMatch(migration, /INSERT INTO public\.quote\b/);
  assert.doesNotMatch(migration, /INSERT INTO public\.quote_version/);
  assert.doesNotMatch(migration, /INSERT INTO public\.conversion_record/);
  assert.doesNotMatch(migration, /INSERT INTO public\.job_handoff/);
  assert.doesNotMatch(migration, /INSERT INTO public\.operational_job/);
});

test("external source identity is the first idempotent dedup path", () => {
  assert.match(migration, /uq_service_request_external_intake_source/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /'dedup_reason', 'external_source_id'/);
});

test("active phone or email match is review-only instead of silent duplicate creation", () => {
  assert.match(migration, /active_phone_or_email/);
  assert.match(migration, /'duplicate_review_required', true/);
  assert.match(migration, /Phone\/email matches multiple active service requests; manual duplicate review required/);
});

test("name and address match is review-only", () => {
  assert.match(migration, /active_name_address/);
  assert.match(migration, /Name\/address matches multiple active service requests; manual duplicate review required/);
});

test("partial intake remains role scoped and invoker security", () => {
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /has_bu_role\(p_organization_id, p_business_unit_id, ARRAY\['owner_admin','office_ops'\]\)/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test("saved lead is explicitly marked real partial intake and not quote ready", () => {
  assert.match(migration, /'synthetic', false/);
  assert.match(migration, /'partial_intake', true/);
  assert.match(migration, /'quote_ready', false/);
  assert.match(migration, /lead_intake_captured/);
});

test("browser client uses one authenticated transactional RPC", () => {
  assert.match(client, /rpc\/record_inbound_lead/);
  assert.match(client, /authenticatedRestFetch/);
  assert.doesNotMatch(client, /service_role/i);
});

test("office panel allows sparse lead capture and states the no-downstream boundary", () => {
  assert.match(panel, /Save Lead \/ Qualify Later/);
  assert.match(panel, /does not create a quote, acceptance, handoff, job, or accounting event/);
  assert.match(panel, /Possible duplicate — review existing lead/);
});

test("partial intake panel is available only inside authorized Revenue surface", () => {
  assert.match(shell, /const ServiceOSLeadIntakePanel = lazy/);
  assert.match(shell, /\{revenueAuthorized \? \([\s\S]*<ServiceOSLeadIntakePanel/);
});
