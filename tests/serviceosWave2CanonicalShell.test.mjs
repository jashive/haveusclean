import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");
const workspace = fs.readFileSync("src/features/wave1/ServiceOSRevenueWorkspace.jsx", "utf8");
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

test("canonical shell mounts native Revenue lazily behind Revenue flag, role authorization, and active market context", () => {
  assert.match(shell, /lazy\(\(\) => import\(["']\.\/ServiceOSRevenueWorkspace["']\)\)/);
  assert.match(shell, /VITE_SERVICEOS_REVENUE_ENABLED/);
  assert.doesNotMatch(shell, /VITE_SERVICEOS_REVENUE_PILOT_UI/);
  assert.match(shell, /canManageServiceOSRevenue\(role\)/);
  assert.match(shell, /revenueAuthorized \? \(/);
  assert.match(shell, /<ServiceOSRevenueWorkspace session=\{session\} revenueContext=\{activeRevenueContext\} \/>/);
  assert.match(shell, /primaryBusinessUnitId: activeBusinessUnit\.id/);
  assert.match(shell, /primaryJurisdictionId: activeBusinessUnit\.jurisdictionId/);
});

test("native Revenue workspace retains a second role boundary and stable selectors", () => {
  assert.match(workspace, /canManageServiceOSRevenue\(role\)/);
  assert.match(workspace, /if \(!authorized\) return null/);
  assert.match(workspace, /data-testid="serviceos-native-revenue-workspace"/);
  assert.match(workspace, /data-testid="serviceos-native-quote-result"/);
});

test("normal Revenue UX does not run synthetic acceptance or conversion pipeline", () => {
  assert.doesNotMatch(workspace, /runRevenuePipeline\(/);
  assert.doesNotMatch(workspace, /createQuoteResponse\(/);
  assert.doesNotMatch(workspace, /createConversionRecord\(/);
  assert.doesNotMatch(workspace, /createCustomer\(/);
  assert.doesNotMatch(workspace, /createJobHandoff\(/);
  assert.match(workspace, /updateQuoteVersionStatus\(saved\.quoteVersion\.id, "sent", accessToken\)/);
  assert.match(workspace, /It does not send email\/SMS and it does not mark the customer accepted/);
});

test("synthetic pilot harness remains isolated and is not mounted by the normal shell", () => {
  assert.match(pilot, /\[PILOT\] Synthetic Wave 2 service request/);
  assert.match(pilot, /runRevenuePipeline\(/);
  assert.match(pilot, /cleanupPilotSession\(createdIds, accessToken\)/);
  assert.doesNotMatch(shell, /ServiceOSPilotPanel/);
});

test("Wave 2 canonical UI contains no legacy HUC data endpoints or demo fixtures", () => {
  for (const source of [shell, workspace, revenueClient]) {
    assert.doesNotMatch(source, /huc_[a-z_]+/i);
    assert.doesNotMatch(source, /partner_progress/i);
    assert.doesNotMatch(source, /Sarah M\.|Thompson House|Priya S\.|King St Lofts/);
  }
});

test("Intelligence remains explicitly dark", () => {
  assert.match(shell, /Intelligence · disabled/);
});
