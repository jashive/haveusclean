import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase/migrations/20260907190000_qa_completion_pipeline_remediation.sql", "utf8");
const qa = fs.readFileSync("src/features/wave4/ServiceOSQaWorkspace.jsx", "utf8");
const worker = fs.readFileSync("src/features/wave3/ServiceOSOperationsWorkspace.jsx", "utf8");
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
