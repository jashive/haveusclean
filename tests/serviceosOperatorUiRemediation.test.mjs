import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filterServiceOSNavigation, isCanonicalServiceOSMode, serviceOSNavigationForRole } from "../src/lib/serviceosUiPolicy.js";

const main = fs.readFileSync("src/main.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
const auth = fs.readFileSync("src/auth/ServiceOSAuthGate.jsx", "utf8");
const diagnostics = fs.readFileSync("src/features/pilot/ServiceOSDiagnosticsWorkspace.jsx", "utf8");
const authClient = fs.readFileSync("src/lib/serviceosAuthClient.js", "utf8");

test("OAT-UI-001 pilot panels are absent from the global application mount", () => {
  assert.doesNotMatch(main, /PilotPanelMount/);
  assert.doesNotMatch(main, /<ServiceOS(?:Operations|Wave4|Wave5Finance)?PilotPanel/);
  assert.match(main, /SERVICEOS_DIAGNOSTICS_PATH/);
  assert.match(diagnostics, /setSelected\(id\)/);
});

test("diagnostics mounts only the explicitly selected panel", () => {
  assert.match(diagnostics, /const SelectedPanel = selected \? panels\[selected\] : null/);
  assert.match(diagnostics, /canOpenServiceOSDiagnostics\(role\)/);
});

test("canonical roles receive distinct least-privilege navigation", () => {
  assert.deepEqual([...serviceOSNavigationForRole("worker")], ["schedule"]);
  assert.deepEqual([...serviceOSNavigationForRole("qa")], ["jobs", "schedule"]);
  assert.equal(serviceOSNavigationForRole("office_ops").has("admins"), false);
  assert.equal(serviceOSNavigationForRole("owner_admin").has("diagnostic"), true);
  assert.equal(serviceOSNavigationForRole("sales").size, 0);
});

test("role-filtered navigation removes empty groups and unauthorized tabs", () => {
  const groups = [{ id: "ops", tabs: [{ id: "jobs" }, { id: "schedule" }] }, { id: "settings", tabs: [{ id: "admins" }] }];
  assert.deepEqual(filterServiceOSNavigation(groups, "worker"), [{ id: "ops", tabs: [{ id: "schedule" }] }]);
});

test("acceptance mode is canonical even if auth is accidentally disabled", () => {
  assert.equal(isCanonicalServiceOSMode({ VITE_SERVICEOS_ENVIRONMENT: "acceptance" }), true);
  assert.match(auth, /Legacy PIN portals are disabled/);
  assert.match(app, /!CANONICAL_SERVICEOS_MODE && currentPath/);
  assert.match(app, /!CANONICAL_SERVICEOS_MODE && SHOW_PORTAL_HELPER_NOTE/);
});

test("mobile layout retains viewport and operator-safe overflow protections", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /width=device-width/);
  assert.match(html, /overflow-x: hidden/);
  assert.match(app, /paddingBottom: isMobile \? MOBILE_NAV_HEIGHT \+ 16/);
  assert.match(app, /overflowX:"auto"/);
});

test("disconnected writes cannot claim Saved", () => {
  assert.match(app, /Not saved — the ServiceOS backend is disconnected/);
  assert.match(app, /setDbStatus\(ok \? \(isCloudConnected \? "synced" : "local"\) : "error"\)/);
});

test("canonical auth resolves organization and business-unit scope through RLS instead of production codes", () => {
  assert.match(authClient, /expected exactly one visible organization/);
  assert.match(authClient, /business_unit\?select=id,organization_id,code,name,jurisdiction_id&organization_id=eq/);
  assert.doesNotMatch(authClient, /organization\?select=.*code=eq\.HUC/);
  assert.doesNotMatch(authClient, /code=in\.\(HUC-ON,HUC-AZ\)/);
});
