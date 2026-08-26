import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260825001500_goal5_partial_lead_intake.sql", "utf8");
const auditHotfix = fs.readFileSync("supabase/migrations/20260825043000_goal5_partial_lead_audit_event_rls_hotfix.sql", "utf8");
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

test("lead intake audit insert is RLS-authorized without bypassing RLS", () => {
  assert.match(auditHotfix, /create policy audit_lead_intake_insert/i);
  assert.match(auditHotfix, /for insert/i);
  assert.match(auditHotfix, /to authenticated/i);
  assert.match(auditHotfix, /actor_user_id = public\.current_app_user_id\(\)/i);
  assert.match(auditHotfix, /event_type = 'lead_intake_captured'/i);
  assert.match(auditHotfix, /entity_type = 'service_request'/i);
  assert.match(auditHotfix, /source_system = 'serviceos_revenue'/i);
  assert.match(auditHotfix, /has_bu_role[\s\S]*owner_admin[\s\S]*office_ops/i);
  assert.doesNotMatch(auditHotfix, /security definer/i);
});

test("browser client uses one authenticated transactional RPC", () => {
  assert.match(client, /rpc\/record_inbound_lead/);
  assert.match(client, /authenticatedRestFetch/);
  assert.doesNotMatch(client, /service_role/i);
});

test("recent saved leads are reloaded from canonical ServiceOS storage across devices", () => {
  assert.match(client, /export async function listRecentInboundLeads/);
  assert.match(client, /service_request\?/);
  assert.match(client, /opportunity\?/);
  assert.match(client, /organization_id=eq/);
  assert.match(client, /business_unit_id=eq/);
  assert.match(panel, /Recent Saved Leads/);
  assert.match(panel, /not device memory/);
  assert.match(panel, /Refresh Leads/);
});

test("proposal-stage leads remain visible but cannot create a duplicate quote", () => {
  assert.match(panel, /canContinueRecentLead/);
  assert.match(panel, /lifecycle_status === "intake"/);
  assert.match(panel, /stage === "open"/);
  assert.match(panel, /Already in quote workflow/);
  assert.match(panel, /Use Customer Response \/ Acceptance for sent quotes instead of creating another quote/);
});

test("office panel allows sparse lead capture and keeps Save Lead as intake-only boundary", () => {
  assert.match(panel, /Save Lead \/ Qualify Later/);
  assert.match(panel, /creates only the canonical intake request and open opportunity/i);
  assert.match(panel, /Continue This Lead to Quote/);
  assert.match(panel, /Possible duplicate — review existing lead/);
});

test("partial intake panel is available only inside authorized Revenue surface", () => {
  assert.match(shell, /const ServiceOSLeadIntakePanel = lazy/);
  assert.match(shell, /\{revenueAuthorized \? \([\s\S]*<ServiceOSLeadIntakePanel/);
});
