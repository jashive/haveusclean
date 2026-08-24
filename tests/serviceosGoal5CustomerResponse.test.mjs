import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CUSTOMER_RESPONSE_OPTIONS,
  responseCreatesConversion,
} from "../src/lib/serviceosCustomerResponseClient.js";

const migration = fs.readFileSync("supabase/migrations/20260824172000_goal5_customer_response_acceptance.sql", "utf8");
const client = fs.readFileSync("src/lib/serviceosCustomerResponseClient.js", "utf8");
const panel = fs.readFileSync("src/features/wave1/ServiceOSCustomerResponsePanel.jsx", "utf8");
const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");
const constraints = fs.readFileSync("supabase/introspection/control_plane_foundation_constraints_indexes.sql", "utf8");

test("Goal 5 exposes exactly the five requested office response choices", () => {
  assert.deepEqual(
    CUSTOMER_RESPONSE_OPTIONS.map(({ value, label }) => ({ value, label })),
    [
      { value: "accepted", label: "Accepted" },
      { value: "declined", label: "Declined" },
      { value: "requested_changes", label: "Needs Changes" },
      { value: "follow_up_required", label: "Follow-Up Required" },
      { value: "no_response", label: "No Response" },
    ]
  );
});

test("only Accepted is classified as a converting customer response", () => {
  assert.equal(responseCreatesConversion("accepted"), true);
  for (const type of ["declined", "requested_changes", "follow_up_required", "no_response", "viewed", "expired", ""]) {
    assert.equal(responseCreatesConversion(type), false, `${type || "empty"} must not convert`);
  }
});

test("customer response UI is mounted only inside the authorized Revenue surface and follows active market context", () => {
  assert.match(shell, /lazy\(\(\) => import\(["']\.\/ServiceOSCustomerResponsePanel["']\)\)/);
  assert.match(shell, /revenueAuthorized \? \(/);
  assert.match(shell, /<ServiceOSCustomerResponsePanel session=\{session\} revenueContext=\{activeRevenueContext\} \/>/);
  assert.match(shell, /primaryBusinessUnitId: activeBusinessUnit\.id/);
  assert.match(shell, /primaryJurisdictionId: activeBusinessUnit\.jurisdictionId/);
  assert.match(panel, /data-testid="serviceos-customer-response-panel"/);
  assert.match(panel, /Only <strong>Accepted<\/strong> can create the canonical conversion and ready Operations handoff/);
});

test("response client uses one authenticated atomic RPC instead of browser-side conversion inserts", () => {
  assert.match(client, /rpc\/record_quote_response_and_convert/);
  assert.doesNotMatch(client, /createConversionRecord\(/);
  assert.doesNotMatch(client, /createJobHandoff\(/);
  assert.doesNotMatch(client, /runRevenuePipeline\(/);
});

test("Goal 5 database transition is SECURITY INVOKER, role-scoped, and serializes retries", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_quote_response_and_convert/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /has_bu_role\(v_org_id, v_bu_id, ARRAY\['owner_admin','office_ops'\]\)/);
  assert.match(migration, /FOR UPDATE OF qv/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test("accepted retry returns the existing conversion and handoff instead of duplicating them", () => {
  assert.match(migration, /IF p_response_type = 'accepted' THEN[\s\S]*FROM public\.conversion_record[\s\S]*WHERE quote_version_id = p_quote_version_id/);
  assert.match(migration, /IF v_conversion\.id IS NOT NULL THEN[\s\S]*FROM public\.job_handoff[\s\S]*'idempotent_replay', true/);
  assert.match(constraints, /uq_conversion_quote_version UNIQUE \(quote_version_id\)/);
  assert.match(constraints, /uq_job_handoff_conversion UNIQUE \(conversion_record_id\)/);
});

test("non-accepted outcomes terminate before conversion and handoff", () => {
  assert.match(migration, /IF p_response_type <> 'accepted' THEN[\s\S]*'conversion_record', NULL,[\s\S]*'job_handoff', NULL[\s\S]*RETURN/);
  assert.match(panel, /This disposition records the customer state only\. It cannot create a conversion record or job handoff/);
});

test("Accepted creates the required canonical response -> conversion -> ready handoff chain", () => {
  assert.match(migration, /INSERT INTO public\.quote_response/);
  assert.match(migration, /UPDATE public\.quote_version[\s\S]*lifecycle_status = 'accepted'/);
  assert.match(migration, /INSERT INTO public\.conversion_record/);
  assert.match(migration, /INSERT INTO public\.job_handoff/);
  assert.match(migration, /v_pricing_snapshot_id, 'ready'/);
  assert.match(migration, /UPDATE public\.service_request[\s\S]*lifecycle_status = 'converted'/);
  assert.match(migration, /UPDATE public\.opportunity[\s\S]*stage = 'won'/);
});

test("Follow-Up Required and No Response are first-class auditable response types", () => {
  assert.match(migration, /'follow_up_required'::text/);
  assert.match(migration, /'no_response'::text/);
  assert.match(migration, /NEW\.response_type IN \([\s\S]*'follow_up_required','no_response'/);
});
