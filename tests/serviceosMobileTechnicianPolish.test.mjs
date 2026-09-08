import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  isRetryableUploadFailure,
  MOBILE_EVIDENCE_STATES,
  MOBILE_UPLOAD_MAX_ATTEMPTS,
  mobileEvidenceEntry,
  uploadBackoffDelay,
} from "../src/lib/serviceosMobileEvidence.js";

const [workspace, components, uploader, css] = await Promise.all([
  readFile(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/wave3/TechnicianExecutionCard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/serviceosMobileEvidence.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("mobile evidence entries begin queued and expose the governed state progression", () => {
  const entry = mobileEvidenceEntry({ name: "kitchen.jpg", type: "image/jpeg", size: 123 }, 0);
  assert.equal(entry.state, "queued");
  assert.equal(entry.name, "kitchen.jpg");
  assert.equal(entry.storageUploaded, false);
  assert.deepEqual(MOBILE_EVIDENCE_STATES, ["queued", "uploading", "verifying", "linked", "error"]);
});

test("storage retry policy is bounded exponential backoff and only retries transient failures", () => {
  assert.equal(MOBILE_UPLOAD_MAX_ATTEMPTS, 4);
  assert.deepEqual([1, 2, 3, 4].map((attempt) => uploadBackoffDelay(attempt, 400)), [400, 800, 1600, 3200]);
  assert.equal(isRetryableUploadFailure({ status: 429 }), true);
  assert.equal(isRetryableUploadFailure({ status: 503 }), true);
  assert.equal(isRetryableUploadFailure({ status: 400 }), false);
});

test("resilient uploader uses a stable object reference and idempotent evidence preflight", () => {
  assert.match(uploader, /if \(!entry\.storageUploaded\) await uploadObject/);
  assert.match(uploader, /response\.ok \|\| response\.status === 409/);
  assert.match(uploader, /completion_evidence\?select=id&storage_reference=eq\./);
  assert.match(uploader, /if \(existing\?\.id\)/);
  assert.match(uploader, /for \(let attempt = 1; attempt <= MOBILE_UPLOAD_MAX_ATTEMPTS/);
});

test("technician card has full-row checklist controls and minimum 52px mobile targets", () => {
  assert.match(components, /function TechnicianExecutionCard/);
  assert.match(components, /className={`field-checklist-item/);
  assert.match(components, /function ResilientEvidenceUploader/);
  assert.match(components, /Retry photo/);
  assert.match(css, /\.field-checklist-item\{[^}]*min-height:58px/);
  assert.match(css, /\.field-photo-button\{[^}]*min-height:52px/);
  assert.match(css, /\.mobile-evidence-list li>button\{[^}]*min-height:52px/);
});

test("earned payout banner follows Pending QA to Approved to Paid and refreshes in place", () => {
  for (const label of ["Pending QA", "Approved", "Paid", "Earned payout"]) assert.match(components, new RegExp(label));
  assert.match(workspace, /<EarnedPayoutBanner payable=\{context\.earnedPayable\}/);
  assert.match(workspace, /SERVICEOS_WORKSPACE_INVALIDATED_EVENT/);
  assert.match(workspace, /visibilitychange/);
  assert.match(workspace, /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) load\(\); \}, 30000\)/);
});

test("mobile polish adds no Vercel function or financial schema surface", async () => {
  const apiFiles = await readdir(new URL("../api", import.meta.url), { recursive: true });
  assert.equal(apiFiles.filter((name) => String(name).endsWith(".js")).length, 12);
  assert.doesNotMatch(workspace + components + uploader, /create table|create policy|security definer/i);
});
