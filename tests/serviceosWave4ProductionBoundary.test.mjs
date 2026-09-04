import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("../src/features/wave1/ServiceOSWave1Workspace.jsx", import.meta.url), "utf8");
const qa = await readFile(new URL("../src/features/wave4/ServiceOSQaWorkspace.jsx", import.meta.url), "utf8");
const prodEnv = await readFile(new URL("../.env.production", import.meta.url), "utf8");

test("Wave 4 has an independent production QA gate", () => {
  assert.match(shell, /VITE_SERVICEOS_QA_ENABLED/);
  assert.match(shell, /QA_ENABLED && \["owner_admin", "qa"\]\.includes\(role\)/);
  assert.match(shell, /data-qa-authorized/);
  assert.match(prodEnv, /VITE_SERVICEOS_QA_ENABLED=true/);
});

test("Wave 4 QA workspace exposes QA only and preserves later-wave boundaries", () => {
  assert.match(qa, /data-serviceos-workspace="wave4-qa-production"/);
  assert.match(qa, /createQaInspection/);
  assert.match(qa, /updateQaInspectionStatus/);
  assert.match(qa, /updateOperationalJobStatus/);
  assert.match(qa, /updateWorkOrderStatus/);
  assert.match(qa, /qa_passed/);
  assert.match(qa, /corrective_action_required/);
  assert.doesNotMatch(qa, /invoice_request|payment_observation|contractor_payable|profitability_snapshot/);
  assert.doesNotMatch(qa, /VITE_SERVICEOS_FINANCE|VITE_SERVICEOS_INTELLIGENCE/);
  assert.match(shell, /Finance · disabled/);
  assert.match(shell, /Intelligence · disabled/);
});

test("Wave 4 QA does not expose Wave 3 dispatch controls", () => {
  assert.doesNotMatch(qa, /createOperationalJob|createScheduleWindow|createWorkerAssignment|Schedule & Dispatch/);
});
