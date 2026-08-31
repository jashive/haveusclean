import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync("src/features/wave3/ServiceOSOperationsWorkspace.jsx", "utf8");
const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");

test("Wave 3 production workspace stops at qa_pending and does not perform QA", () => {
  assert.match(workspace, /updateOperationalJobStatus\(job\.id,"qa_pending"/);
  assert.match(workspace, /Wave 4 must perform QA/);
  assert.doesNotMatch(workspace, /createQaInspection/);
  assert.doesNotMatch(workspace, /updateQaInspectionStatus/);
  assert.doesNotMatch(workspace, /qa_passed/);
  assert.doesNotMatch(workspace, /qa_complete/);
});

test("Wave 3 production workspace is gated independently and later waves remain dark", () => {
  assert.match(shell, /VITE_SERVICEOS_OPERATIONS_ENABLED/);
  assert.match(shell, /Operations · active/);
  assert.match(shell, /QA · disabled/);
  assert.match(shell, /Finance · disabled/);
  assert.match(shell, /Intelligence · disabled/);
});

test("Wave 3 role boundary exposes operations only to owner_admin, office_ops, and worker", () => {
  assert.match(shell, /\["owner_admin", "office_ops", "worker"\]\.includes\(role\)/);
  assert.doesNotMatch(shell, /\["owner_admin", "office_ops", "worker", "qa"\]/);
});

test("Production workspace uses real Revenue handoffs and marks records non-synthetic", () => {
  assert.match(workspace, /fetchEligibleJobHandoffs/);
  assert.match(workspace, /source: "wave3_production_workspace", synthetic: false/);
  assert.doesNotMatch(workspace, /operations_pilot_ui/);
});

test("Wave 3 Revenue handoff dropdown renders human-readable customer, service, location, and ID context", () => {
  assert.match(workspace, /dispatch_label/);
  assert.match(workspace, /customer\?id=eq\./);
  assert.match(workspace, /quote_version\?id=eq\./);
  assert.match(workspace, /service_location\?id=eq\./);
  assert.match(workspace, /\$\{customerName\} — \$\{serviceTier\} — \$\{locationLabel\} \(\$\{handoffIdSnippet\(handoff\.id\)\}\)/);
  assert.match(workspace, /<option key=\{h\.id\} value=\{h\.id\}>\{h\.dispatch_label/);
});

test("Wave 3 dropdown label enrichment is presentation-only and preserves dispatch by canonical handoff UUID", () => {
  assert.match(workspace, /fetchJobHandoffById\(handoffId\)/);
  assert.match(workspace, /jobHandoffId: handoff\.id/);
  assert.match(workspace, /value=\{handoffId\}/);
  assert.doesNotMatch(workspace, /jobHandoffId: handoff\.dispatch_label/);
});
