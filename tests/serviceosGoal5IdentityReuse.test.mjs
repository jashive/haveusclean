import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { serviceRequestHasCanonicalIdentity } from "../src/lib/serviceosCustomerResponseClient.js";

const migration = fs.readFileSync("supabase/migrations/20260824222500_goal5_identity_reuse_dedup.sql", "utf8");
const client = fs.readFileSync("src/lib/serviceosCustomerResponseClient.js", "utf8");
const panel = fs.readFileSync("src/features/wave1/ServiceOSCustomerResponsePanel.jsx", "utf8");

test("Goal 5.3 recognizes only a complete service-request canonical identity", () => {
  assert.equal(serviceRequestHasCanonicalIdentity({ customer_id: "c", contact_id: "p", service_location_id: "l" }), true);
  assert.equal(serviceRequestHasCanonicalIdentity({ customer_id: "c", contact_id: "p" }), false);
  assert.equal(serviceRequestHasCanonicalIdentity({}), false);
});

test("sent quote query exposes service-request identity IDs for acceptance decisions", () => {
  assert.match(client, /service_request:service_request_id\(id,title,requirements,customer_id,contact_id,service_location_id\)/);
});

test("accepted conversion resolves identity before accepting the quote", () => {
  const identityStart = migration.indexOf("5.3 Resolution 1");
  const acceptedUpdate = migration.indexOf("UPDATE public.quote_version", identityStart);
  assert.ok(identityStart > -1);
  assert.ok(acceptedUpdate > identityStart, "quote must not become accepted until identity resolution succeeds");
});

test("complete service-request identity is reused and validated as one customer lineage", () => {
  assert.match(migration, /v_sr_customer_id IS NOT NULL OR v_sr_contact_id IS NOT NULL OR v_sr_location_id IS NOT NULL/);
  assert.match(migration, /Service request has partial canonical identity; manual duplicate review required/);
  assert.match(migration, /WHERE id = v_sr_contact_id[\s\S]*customer_id = v_customer\.id/);
  assert.match(migration, /WHERE id = v_sr_location_id[\s\S]*customer_id = v_customer\.id/);
  assert.match(migration, /v_identity_resolution := 'existing_service_request'/);
});

test("conflicting acceptance details fail closed instead of silently replacing canonical identity", () => {
  assert.match(migration, /Acceptance email conflicts with canonical service-request contact; manual duplicate review required/);
  assert.match(migration, /Acceptance phone conflicts with canonical service-request contact; manual duplicate review required/);
  assert.match(migration, /Acceptance address conflicts with canonical service-request location; manual duplicate review required/);
});

test("fallback matching is scoped and ambiguity fails closed", () => {
  assert.match(migration, /cu\.organization_id = v_org_id/);
  assert.match(migration, /cu\.business_unit_id IS NULL OR cu\.business_unit_id = v_bu_id/);
  assert.match(migration, /Multiple canonical customers match name\/address; manual duplicate review required/);
  assert.match(migration, /Email\/phone matches multiple canonical customers; manual duplicate review required/);
  assert.match(migration, /Multiple contacts match the accepted identity; manual duplicate review required/);
  assert.match(migration, /Multiple service locations match the accepted address; manual duplicate review required/);
});

test("new customer creation is the final resolution path only", () => {
  const exactMatch = migration.indexOf("5.3 Resolution 2a");
  const createNew = migration.indexOf("5.3 Resolution 3");
  assert.ok(exactMatch > -1 && createNew > exactMatch);
  assert.match(migration, /v_identity_resolution := 'created_new'/);
  assert.match(migration, /'identity_resolution',v_identity_resolution/);
});

test("non-accepted outcomes still stop before all identity mutation", () => {
  const nonAccepted = migration.indexOf("IF p_response_type <> 'accepted' THEN");
  const identityResolution = migration.indexOf("5.3 Resolution 1");
  assert.ok(nonAccepted > -1 && identityResolution > nonAccepted);
  assert.match(migration, /'conversion_record', NULL,[\s\S]*'job_handoff', NULL/);
});

test("retry safety and existing role/security boundary remain intact", () => {
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /has_bu_role\(v_org_id, v_bu_id, ARRAY\['owner_admin','office_ops'\]\)/);
  assert.match(migration, /FOR UPDATE OF qv/);
  assert.match(migration, /'idempotent_replay', true/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test("office UI does not require a new customer name when canonical identity already exists", () => {
  assert.match(panel, /const hasCanonicalIdentity = serviceRequestHasCanonicalIdentity\(selectedServiceRequest\)/);
  assert.match(panel, /if \(converts && !hasCanonicalIdentity\)/);
  assert.match(panel, /ServiceOS will reuse it and will stop for review if supplied details conflict/);
  assert.match(panel, /Identity: \{result\.identity_resolution\}/);
});
