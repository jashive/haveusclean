import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");
const pilot = fs.readFileSync("src/features/pilot/ServiceOSPilotPanel.jsx", "utf8");
const policy = fs.readFileSync("src/lib/serviceosUiPolicy.js", "utf8");
const revenueClient = fs.readFileSync("src/lib/serviceosRevenueClient.js", "utf8");

test("Wave 2 Revenue is limited to owner_admin and office_ops", () => {
  const allowlist = policy.match(/REVENUE_MANAGEMENT_ROLES\s*=\s*Object\.freeze\((\[[^\]]+\])\)/)?.[1] ?? "";
  assert.match(allowlist, /owner_admin/);
  assert.match(allowlist, /office_ops/);
  assert.doesNotMatch(allowlist, /worker/);
  assert.doesNotMatch(allowlist, /qa/);
  assert.match(policy, /canManageServiceOSRevenue\(role\)/);
});

test("canonical shell mounts Revenue lazily only behind both flags and role authorization", () => {
  assert.match(shell, /lazy\(\(\) => import\(["']\.\.\/pilot\/ServiceOSPilotPanel["']\)\)/);
  assert.match(shell, /VITE_SERVICEOS_REVENUE_ENABLED/);
  assert.match(shell, /VITE_SERVICEOS_REVENUE_PILOT_UI/);
  assert.match(shell, /canManageServiceOSRevenue\(role\)/);
  assert.match(shell, /revenueAuthorized \? \(/);
  assert.match(shell, /<ServiceOSPilotPanel session=\{session\} revenueContext=\{revenueContext\} \/>/);
});

test("Revenue panel has a second role boundary and stable automation selectors", () => {
  assert.match(pilot, /canManageServiceOSRevenue\(role\)/);
  assert.match(pilot, /if \(!PILOT_UI_ENABLED \|\| !roleAuthorized\) return null/);
  assert.match(pilot, /data-testid="wave2-revenue-pilot"/);
  assert.match(pilot, /data-testid="wave2-run-pilot"/);
  assert.match(pilot, /data-testid="wave2-cleanup-pilot"/);
  assert.match(pilot, /data-testid="wave2-created-summary"/);
});

test("Wave 2 synthetic lifecycle reaches job handoff and retains cleanup", () => {
  assert.match(pilot, /\[PILOT\] Synthetic Wave 2 service request/);
  assert.match(pilot, /runRevenuePipeline\(/);
  assert.match(pilot, /Pipeline complete — conversion_record created, Wave 3 job_handoff boundary set/);
  assert.match(pilot, /cleanupPilotSession\(createdIds, accessToken\)/);
  assert.match(pilot, /Pilot records cleaned up/);
});

test("Wave 2 canonical UI contains no legacy HUC data endpoints or demo fixtures", () => {
  for (const source of [shell, pilot, revenueClient]) {
    assert.doesNotMatch(source, /huc_[a-z_]+/i);
    assert.doesNotMatch(source, /partner_progress/i);
    assert.doesNotMatch(source, /Sarah M\.|Thompson House|Priya S\.|King St Lofts/);
  }
});

test("later rollout gates remain explicitly dark in Wave 2 shell", () => {
  assert.match(shell, /Operations · disabled/);
  assert.match(shell, /QA · disabled/);
  assert.match(shell, /Finance · disabled/);
});
