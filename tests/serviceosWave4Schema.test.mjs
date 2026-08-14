import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRequiredEvidencePolicyPayload,
  buildWorkOrderGovernanceLinkPayload,
  buildWorkOrderEvidenceRequirementPayload,
  buildServiceExceptionPayload,
  buildCustomerOutcomePayload,
  EVIDENCE_TYPES,
  SERVICE_EXCEPTION_STATUSES,
  CUSTOMER_OUTCOME_STATUSES,
} from "../src/lib/serviceosOperationsUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const m007 = readFileSync(
  resolve(ROOT, "supabase/migrations/007_wave3_operations.sql"),
  "utf8"
);
const m009 = readFileSync(
  resolve(ROOT, "supabase/migrations/009_wave4_delivery_quality_gaps.sql"),
  "utf8"
);
const m010 = readFileSync(
  resolve(ROOT, "supabase/rehearsals/010_wave4_delivery_quality_rehearsal.sql"),
  "utf8"
);
const pkg = readFileSync(resolve(ROOT, "package.json"), "utf8");
const clientSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosOperationsClient.js"),
  "utf8"
);
const utilsSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosOperationsUtils.js"),
  "utf8"
);

test("M009: wrapped in a single BEGIN/COMMIT transaction", () => {
  assert.ok(/^\s*BEGIN\s*;/m.test(m009), "M009 missing BEGIN;");
  assert.ok(/^\s*COMMIT\s*;/m.test(m009), "M009 missing COMMIT;");
});

test("M009: additive only and does not touch huc_*", () => {
  assert.ok(!/DROP\s+TABLE/i.test(m009), "M009 must not drop tables");
  assert.ok(!/ALTER TABLE public\.huc_/i.test(m009), "M009 must not alter huc_*");
  assert.ok(!/DROP\s+TRIGGER/i.test(m009), "M009 must not drop triggers");
  assert.ok(!/DROP\s+FUNCTION/i.test(m009), "M009 must not drop functions");
  assert.ok(!/REVOKE .* ON public\.huc_/i.test(m009), "M009 must not revoke legacy huc_* access");
});

test("M009: preserves existing append-only controls and validates them in self-check", () => {
  ["trg_woe_deny_update", "trg_woe_deny_delete", "trg_ce_deny_update", "trg_ce_deny_delete"].forEach(
    (name) => {
      assert.ok(m007.includes(name), `Wave 3 baseline missing ${name}`);
      assert.ok(m009.includes(name), `M009 self-validation must reference ${name}`);
    }
  );
  assert.ok(
    m009.includes("existing append-only guard triggers are missing"),
    "M009 must fail if append-only guards disappear"
  );
});

test("M009: defines required-evidence policy authority and frozen work-order requirements", () => {
  assert.ok(m009.includes("CREATE TABLE public.required_evidence_policy"));
  assert.ok(m009.includes("configuration_version_id"));
  assert.ok(m009.includes("CREATE TABLE public.work_order_evidence_requirement"));
  assert.ok(m009.includes("work_order_governance_link_id"));
  assert.ok(m009.includes("required_evidence_policy_id"));
  assert.ok(m009.includes("source_configuration_version_id"));
  assert.ok(m009.includes("UNIQUE (work_order_id, requirement_key)"));
});

test("M009: defines work-order governance linkage for config/checklist/task/SOP references", () => {
  assert.ok(m009.includes("CREATE TABLE public.work_order_governance_link"));
  [
    "configuration_version_id",
    "checklist_version_reference",
    "task_definition_reference",
    "sop_reference_snapshot",
    "governance_snapshot",
  ].forEach((field) => assert.ok(m009.includes(field), `governance link missing ${field}`));
});

test("M009: closure enforcement fails closed for missing required evidence", () => {
  const fnMatch = m009.match(
    /CREATE OR REPLACE FUNCTION public\.wave4_guard_wo_closure_requirements[\s\S]*?\$\$;/
  );
  assert.ok(fnMatch, "work_order closure guard function missing");
  const fn = fnMatch[0];
  assert.ok(fn.includes("frozen governance linkage is required before close"));
  assert.ok(fn.includes("frozen evidence requirements are required before close"));
  assert.ok(fn.includes("mandatory evidence requirement"), "missing required-evidence close gate");
  assert.ok(fn.includes("completion_evidence"), "close gate must inspect completion_evidence");
  assert.ok(fn.includes("qa_inspection"), "close gate must inspect qa_inspection");
  assert.ok(fn.includes("corrective_action"), "close gate must inspect corrective_action");
  assert.ok(m009.includes("CREATE TRIGGER trg_wo_wave4_close_gate"));
});

test("M009: existing QA and corrective-action gates remain present", () => {
  assert.ok(
    m007.includes("operational_handoff: % unresolved corrective action(s) block handoff"),
    "Wave 3 corrective gate must remain present"
  );
  assert.ok(
    m007.includes("operational_handoff: operational_job must be qa_passed or closed"),
    "Wave 3 QA gate must remain present"
  );
  assert.ok(
    m009.includes("QA pass/waiver required before close"),
    "Wave 4 close gate must continue to require QA"
  );
});

test("M009: service_exception lineage is scoped to the operational chain", () => {
  assert.ok(m009.includes("CREATE TABLE public.service_exception"));
  [
    "operational_job_id",
    "work_order_id",
    "qa_inspection_id",
    "corrective_action_id",
    "exception_category",
    "severity",
    "triage_status",
    "corrective_action_required",
    "quality_signal_payload",
  ].forEach((field) => assert.ok(m009.includes(field), `service_exception missing ${field}`));
  const fnMatch = m009.match(
    /CREATE OR REPLACE FUNCTION public\.wave4_validate_service_exception_scope[\s\S]*?\$\$;/
  );
  assert.ok(fnMatch, "service_exception scope validator missing");
  const fn = fnMatch[0];
  assert.ok(fn.includes("work_order does not belong to declared operational_job"));
  assert.ok(fn.includes("qa_inspection does not belong to declared operational chain"));
  assert.ok(fn.includes("corrective_action does not belong to declared operational chain"));
});

test("M009: customer_outcome lineage is canonical", () => {
  assert.ok(m009.includes("CREATE TABLE public.customer_outcome"));
  [
    "operational_job_id",
    "work_order_id",
    "customer_id",
    "contact_id",
    "service_location_id",
    "outcome_type",
    "outcome_status",
    "outcome_source",
    "quality_signal_payload",
  ].forEach((field) => assert.ok(m009.includes(field), `customer_outcome missing ${field}`));
  const fnMatch = m009.match(
    /CREATE OR REPLACE FUNCTION public\.wave4_validate_customer_outcome_scope[\s\S]*?\$\$;/
  );
  assert.ok(fnMatch, "customer_outcome scope validator missing");
  const fn = fnMatch[0];
  assert.ok(fn.includes("customer_id must match operational_job lineage"));
  assert.ok(fn.includes("contact_id must match operational_job lineage"));
  assert.ok(fn.includes("service_location_id must match operational_job lineage"));
});

test("M009: does not rewrite pricing_snapshot or quote_version economics", () => {
  assert.ok(
    !/(INSERT INTO|UPDATE|ALTER TABLE) public\.pricing_snapshot\b/i.test(m009),
    "M009 must not rewrite pricing_snapshot"
  );
  assert.ok(
    !/(INSERT INTO|UPDATE|ALTER TABLE) public\.quote_version\b/i.test(m009),
    "M009 must not rewrite quote_version"
  );
});

test("M009: anon receives no new canonical operational CRUD", () => {
  const revokes = m009.match(/REVOKE ALL ON public\.[a-z_]+ +FROM anon;/g) || [];
  assert.equal(revokes.length, 5, "expected anon revoke on all 5 Wave 4 tables");
  assert.ok(!/GRANT .* TO anon/i.test(m009), "M009 must not grant anon access");
});

test("M009: self-validation is locked to deterministic Wave 4 controls", () => {
  assert.ok(m009.includes("M009_PASS"), "M009 self-validation marker missing");
  assert.ok(
    /v_expected_policy_count\s+integer\s*:=\s*20/.test(m009),
    "M009 expected policy count must be locked to 20"
  );
  [
    "wave4_tables_found",
    "expected_tables",
    "rls_enabled_count",
    "anon_privilege_violation_count",
    "authenticated_table_count",
    "policy_count",
    "missing_required_dependency_count",
    "missing_guard_trigger_count",
    "legacy_huc_touch_count",
    "append_only_guards_present",
    "work_order_close_gate_present",
  ].forEach((field) => assert.ok(m009.includes(field), `M009 self-validation missing ${field}`));
});

test("M010: rollback-only rehearsal with zero-artifact verification", () => {
  assert.ok(/^\s*BEGIN\s*;/m.test(m010), "M010 missing BEGIN");
  assert.ok(/\bROLLBACK\b/.test(m010), "M010 missing ROLLBACK");
  assert.ok(!/^\s*COMMIT\s*;/m.test(m010), "M010 must not commit");
  assert.ok(m010.includes("M010_REHEARSAL_PASS_ROLLED_BACK"));
  assert.ok(m010.includes("remaining_artifact_count"));
});

test("M010: covers required-evidence rejection/success and exception lifecycle", () => {
  [
    "INSERT INTO public.required_evidence_policy",
    "INSERT INTO public.work_order_governance_link",
    "INSERT INTO public.work_order_evidence_requirement",
    "M010 expected missing evidence close failure did not occur",
    "INSERT INTO public.service_exception",
    "INSERT INTO public.corrective_action",
    "ready_for_reinspection",
    "INSERT INTO public.customer_outcome",
    "CREATE TEMP TABLE pg_temp.m010_scope",
  ].forEach((snippet) => assert.ok(m010.includes(snippet), `M010 missing ${snippet}`));
});

test("Wave 4 app scaffolding does not introduce @supabase/supabase-js", () => {
  const codeOnly = `${clientSrc}\n${utilsSrc}`
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.ok(!pkg.includes("@supabase/supabase-js"), "package.json must not add @supabase/supabase-js");
  assert.ok(!codeOnly.includes("@supabase/supabase-js"), "source must not add @supabase/supabase-js");
});

test("Wave 3 happy-path tests remain wired into npm test", () => {
  [
    "tests/serviceosWave3Schema.test.mjs",
    "tests/serviceosWave3OperationsUtils.test.mjs",
    "tests/serviceosWave3OperationsClient.test.mjs",
    "tests/serviceosWave3WorkerBootstrap.test.mjs",
  ].forEach((file) => assert.ok(pkg.includes(file), `npm test no longer includes ${file}`));
});

test("buildRequiredEvidencePolicyPayload produces exact M009 field names", () => {
  const payload = buildRequiredEvidencePolicyPayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    jurisdictionId: "jur-1",
    configurationVersionId: "cfg-1",
    serviceFamily: "residential",
    serviceTaskKey: "deep_clean",
    serviceModuleKey: "kitchen",
    requirementKey: "kitchen_after_photo",
    evidenceType: "photo_after",
  });
  assert.deepEqual(Object.keys(payload), [
    "organization_id",
    "business_unit_id",
    "jurisdiction_id",
    "configuration_version_id",
    "service_family",
    "service_task_key",
    "service_module_key",
    "requirement_key",
    "evidence_type",
    "required_count",
    "is_mandatory",
    "storage_rule_payload",
    "metadata",
  ]);
  assert.equal(payload.required_count, 1);
  assert.equal(payload.is_mandatory, true);
});

test("buildWorkOrderGovernanceLinkPayload preserves config/checklist/task/SOP references", () => {
  const payload = buildWorkOrderGovernanceLinkPayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    jurisdictionId: "jur-1",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    configurationVersionId: "cfg-1",
    checklistVersionReference: "chk-v1",
    taskDefinitionReference: "task-v1",
    sopReferenceSnapshot: [{ document_id: "sop-1", version: "2026-08-v1" }],
  });
  assert.equal(payload.configuration_version_id, "cfg-1");
  assert.equal(payload.checklist_version_reference, "chk-v1");
  assert.equal(payload.task_definition_reference, "task-v1");
  assert.deepEqual(payload.sop_reference_snapshot, [{ document_id: "sop-1", version: "2026-08-v1" }]);
});

test("buildWorkOrderEvidenceRequirementPayload freezes requirement linkage", () => {
  const payload = buildWorkOrderEvidenceRequirementPayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    workOrderGovernanceLinkId: "wogl-1",
    requiredEvidencePolicyId: "rep-1",
    sourceConfigurationVersionId: "cfg-1",
    requirementKey: "kitchen_after_photo",
    evidenceType: "photo_after",
  });
  assert.equal(payload.work_order_governance_link_id, "wogl-1");
  assert.equal(payload.required_evidence_policy_id, "rep-1");
  assert.equal(payload.source_configuration_version_id, "cfg-1");
  assert.equal(payload.required_count, 1);
  assert.equal(payload.is_mandatory, true);
});

test("buildServiceExceptionPayload defaults to reported and uses governed fields", () => {
  const payload = buildServiceExceptionPayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    sourceType: "qa",
    exceptionCategory: "service_quality",
    severity: "high",
    description: "Missed surface",
  });
  assert.equal(payload.triage_status, "reported");
  assert.equal(payload.corrective_action_required, false);
  assert.equal(payload.source_type, "qa");
});

test("buildCustomerOutcomePayload defaults to reported customer-sourced outcome", () => {
  const payload = buildCustomerOutcomePayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    operationalJobId: "oj-1",
    customerId: "cust-1",
    outcomeType: "complaint",
    description: "Customer reported residue",
  });
  assert.equal(payload.outcome_status, "reported");
  assert.equal(payload.outcome_source, "customer");
  assert.equal(payload.customer_id, "cust-1");
});

test("Wave 4 client exports narrow REST contract scaffolding only", () => {
  [
    "createRequiredEvidencePolicy",
    "createWorkOrderGovernanceLink",
    "createWorkOrderEvidenceRequirement",
    "createServiceException",
    "createCustomerOutcome",
    "fetchRequiredEvidencePoliciesByConfigurationVersion",
    "fetchGovernanceLinkForWorkOrder",
    "fetchEvidenceRequirementsForWorkOrder",
    "fetchServiceExceptionsForJob",
    "fetchCustomerOutcomesForJob",
    "updateServiceExceptionStatus",
    "updateCustomerOutcomeStatus",
  ].forEach((name) => assert.ok(clientSrc.includes(`export async function ${name}`), `client missing ${name}`));
  assert.ok(!clientSrc.includes("preview write"), "client must remain source-only scaffolding");
});

test("Wave 4 enums remain constrained to canonical values", () => {
  assert.ok(EVIDENCE_TYPES.includes("photo_after"));
  assert.ok(SERVICE_EXCEPTION_STATUSES.includes("ready_for_reinspection"));
  assert.ok(CUSTOMER_OUTCOME_STATUSES.includes("resolved"));
});
