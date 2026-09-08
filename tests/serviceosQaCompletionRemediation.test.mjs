import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const governedQaUi=fs.readFileSync("src/features/wave4/ServiceOSQaWorkspace.jsx","utf8");
const governedQaSql=fs.readFileSync("supabase/migrations/20260908132856_governed_qa_review_queue.sql","utf8");

test("QA workspace uses a governed territory queue without manual UUID inputs",()=>{
  assert.match(governedQaUi,/get_qa_review_queue/);
  assert.match(governedQaUi,/primaryBusinessUnitId/);
  assert.doesNotMatch(governedQaUi,/Operational job ID/);
  assert.doesNotMatch(governedQaUi,/Work order ID/);
  assert.match(governedQaUi,/customer_name/);
  assert.match(governedQaUi,/cleaner_names/);
  assert.match(governedQaUi,/photo_count/);
});

test("QA queue RPC is authenticated and territory scoped",()=>{
  assert.match(governedQaSql,/auth\.uid\(\) is null/);
  assert.match(governedQaSql,/has_bu_role\(p_organization_id,p_business_unit_id,array\['owner_admin','office_ops','qa'\]/);
  assert.match(governedQaSql,/j\.organization_id=p_organization_id and j\.business_unit_id=p_business_unit_id/);
  assert.match(governedQaSql,/j\.operational_status='qa_pending'/);
});

test("QA queue actions retain atomic Phase 3 finalization",()=>{
  assert.match(governedQaUi,/rpc\/staff_finalize_qa_inspection/);
  assert.match(governedQaUi,/finalizeQa\("passed"\)/);
  assert.match(governedQaUi,/finalizeQa\("waived"\)/);
});
import "./serviceosPhase3IntelligenceKpiRemediation.test.mjs";

const sql = fs.readFileSync("supabase/migrations/20260907190000_qa_completion_pipeline_remediation.sql", "utf8");
const qa = fs.readFileSync("src/features/wave4/ServiceOSQaWorkspace.jsx", "utf8");
const worker = fs.readFileSync("src/features/wave3/ServiceOSOperationsWorkspace.jsx", "utf8")
  + fs.readFileSync("src/lib/serviceosMobileEvidence.js", "utf8");
const api = fs.readFileSync("api/notifications.js", "utf8");
const delivery = fs.readFileSync("src/server/customerCompletionDelivery.js", "utf8");

test("QA pass and waiver are atomic and territory-authorized", () => {
  assert.match(qa, /\["qa", "owner_admin", "office_ops"\]/);
  assert.match(qa, /staff_finalize_qa_inspection/);
  assert.match(qa, /Waive QA/);
  assert.match(sql, /array\['owner_admin','office_ops','qa'\]/);
  assert.match(sql, /p_outcome not in \('passed','waived'\)/);
  assert.match(sql, /work_order_status='qa_complete'/);
  assert.match(sql, /operational_status='qa_passed'/);
});

test("completion photos use a private scoped bucket and append-only evidence", () => {
  assert.match(sql, /serviceos-completion-evidence','serviceos-completion-evidence',false/);
  assert.match(sql, /worker_can_write_completion_object/);
  assert.match(sql, /can_read_completion_object/);
  assert.match(worker, /storage\/v1\/object\/serviceos-completion-evidence/);
  assert.match(worker, /createCompletionEvidence/);
  assert.match(worker, /evidenceType: "photo_after"/);
  assert.match(worker, /sha256/);
  assert.doesNotMatch(sql, /for (update|delete) to authenticated/i);
});

test("job submission creates and attempts an idempotent operations alert", () => {
  assert.match(api, /action === 'job-completion'/);
  assert.match(api, /worker_submit_completion_to_qa/);
  assert.match(api, /deliverOperationsCompletionAlert/);
  assert.match(delivery, /M365_OPERATIONS_EMAIL \|\| senderEmail/);
  assert.match(sql, /enqueue_operations_completion_alert/);
  assert.match(sql, /operations-completion:'\|\|new\.id/);
  assert.match(sql, /unique\(work_order_id\)/);
});

test("the remediation adds no serverless function", () => {
  const functions = fs.readdirSync("api", { recursive: true }).filter((name) => String(name).endsWith(".js"));
  assert.equal(functions.length, 12);
});
