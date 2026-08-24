import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/main.jsx", "utf8");
const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");
const authClient = fs.readFileSync("src/lib/serviceosAuthClient.js", "utf8");

test("canonical ServiceOS mode does not eagerly mount or import the legacy App", () => {
  assert.doesNotMatch(main, /import App from ["']\.\/App["']/);
  assert.match(main, /const LegacyApp = lazy\(\(\) => import\(["']\.\/App["']\)\)/);
  assert.match(main, /if \(CANONICAL_SERVICEOS_MODE\)[\s\S]*<ServiceOSWave1Workspace \/>/);
});

test("Wave 1 canonical shell contains no legacy HUC storage endpoints or demo fixtures", () => {
  assert.doesNotMatch(shell, /huc_[a-z_]+/i);
  assert.doesNotMatch(shell, /partner_progress/i);
  assert.doesNotMatch(shell, /Sarah M\.|Thompson House|Priya S\.|King St Lofts/);
  assert.match(shell, /ServiceOS is the operational system of record/);
  assert.match(shell, /Quote preparation does not fabricate customer acceptance, conversion, job handoff, or accounting events/);
});

test("Wave 1 shell exposes authenticated identity, role, organization and visible logout", () => {
  assert.match(shell, /session\?\.user\?\.email/);
  assert.match(shell, /revenueContext\?\.roleCode/);
  assert.match(shell, /revenueContext\?\.orgId/);
  assert.match(shell, />Have Us Clean</);
  assert.match(shell, /aria-label="Log out of ServiceOS"/);
  assert.match(shell, /await signOut\(stored\?\.access_token\)/);
});

test("canonical REST authorization uses the authenticated access token, not the anon key", () => {
  const start = authClient.indexOf("export async function authenticatedRestFetch");
  const end = authClient.indexOf("// ── Token expiry helpers", start);
  const authenticatedFetch = authClient.slice(start, end);
  assert.match(authenticatedFetch, /apikey: anon/);
  assert.match(authenticatedFetch, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(authenticatedFetch, /Authorization: `Bearer \$\{anon\}`/);
});

test("later waves are explicit disabled states in the Wave 1 shell", () => {
  assert.match(shell, /Revenue · disabled/);
  assert.match(shell, /Operations · disabled/);
  assert.match(shell, /QA · disabled/);
  assert.match(shell, /Finance · disabled/);
});
