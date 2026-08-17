// Wave 6 — UI contract tests. These are static source analyses: they assert the
// Wave 6 panels are feature-flagged, wired to real client calls, credential-free
// and free of placeholder controls. No rendering, no network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.join(here, "..", "src", "features", "intelligence");
const libDir = path.join(here, "..", "src", "lib");

const read = (file) => readFileSync(file, "utf8");

const PANELS = {
  "Wave6IntelligencePanel.jsx": read(path.join(featureDir, "Wave6IntelligencePanel.jsx")),
  "KpiReviewPanel.jsx": read(path.join(featureDir, "KpiReviewPanel.jsx")),
  "ChangeControlPanel.jsx": read(path.join(featureDir, "ChangeControlPanel.jsx")),
  "ContinuityPanel.jsx": read(path.join(featureDir, "ContinuityPanel.jsx")),
  "ModuleReadinessPanel.jsx": read(path.join(featureDir, "ModuleReadinessPanel.jsx")),
};

const formatters = read(path.join(featureDir, "wave6Formatters.js"));
const clientSource = read(path.join(libDir, "serviceosIntelligenceClient.js"));
const utilsSource = read(path.join(libDir, "serviceosIntelligenceUtils.js"));
const mainSource = read(path.join(here, "..", "src", "main.jsx"));
const packageJson = JSON.parse(read(path.join(here, "..", "package.json")));

const ALL_WAVE6_SOURCES = { ...PANELS, "wave6Formatters.js": formatters };

// ── Feature flag ─────────────────────────────────────────────────────────────

test("Wave 6 is feature-flagged by VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED", () => {
  assert.match(clientSource, /VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED/);
  assert.match(mainSource, /VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED/);
});

test("main.jsx mounts Wave6IntelligencePanel lazily behind the flag", () => {
  // Wave 6 follows the existing pilot-panel mounting pattern in main.jsx:
  // the lazy import itself is gated so the chunk is never requested when off.
  assert.match(
    mainSource,
    /const WAVE6_PILOT_UI =[\s\S]*?VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED === 'true'/
  );
  assert.match(
    mainSource,
    /const Wave6IntelligencePanel = WAVE6_PILOT_UI\s*\?\s*lazy\(\(\) => import\('\.\/features\/intelligence\/Wave6IntelligencePanel'\)\)\s*:\s*null/
  );
  assert.match(mainSource, /\{Wave6IntelligencePanel && \(/);
  assert.match(
    mainSource,
    /<Wave6IntelligencePanel\s+session=\{ctx\?\.session \?\? null\}\s+revenueContext=\{ctx\?\.revenueContext \?\? null\}/
  );
});

test("Wave 6 mounts inside PilotPanelMount alongside the other pilot panels", () => {
  const mountBody = mainSource.slice(
    mainSource.indexOf("function PilotPanelMount()"),
    mainSource.indexOf("ReactDOM.createRoot")
  );
  assert.ok(mountBody.includes("Wave6IntelligencePanel"), "Wave 6 is not in PilotPanelMount");
  assert.ok(mountBody.includes("ServiceOSWave5FinancePilotPanel"));
});

test("client fails closed when the Wave 6 flag is off", () => {
  assert.match(clientSource, /function assertEnabled\(\)/);
  assert.match(clientSource, /throw new Error\(\s*"ServiceOS Wave 6 intelligence is disabled/);
  const guarded = (clientSource.match(/assertEnabled\(\);/g) ?? []).length;
  assert.ok(guarded >= 15, `expected every exported call to be guarded, found ${guarded}`);
});

// ── No placeholders / dead controls ──────────────────────────────────────────

test("no Wave 6 UI contains placeholder or coming-soon copy", () => {
  for (const [name, source] of Object.entries(ALL_WAVE6_SOURCES)) {
    assert.doesNotMatch(source, /coming soon/i, `${name} contains coming-soon copy`);
    assert.doesNotMatch(source, /\bTODO\b/, `${name} contains a TODO`);
    assert.doesNotMatch(source, /\bFIXME\b/, `${name} contains a FIXME`);
    assert.doesNotMatch(source, /lorem ipsum/i, `${name} contains lorem ipsum`);
    assert.doesNotMatch(source, /not implemented/i, `${name} claims not implemented`);
  }
});

test("no Wave 6 UI contains a no-op or alert-only handler", () => {
  for (const [name, source] of Object.entries(ALL_WAVE6_SOURCES)) {
    assert.doesNotMatch(source, /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/, `${name} has a no-op onClick`);
    assert.doesNotMatch(source, /onClick=\{\s*\(\s*\)\s*=>\s*(?:null|undefined)\s*\}/, `${name} has a null onClick`);
    assert.doesNotMatch(source, /alert\(/, `${name} uses alert() as a handler`);
    assert.doesNotMatch(source, /href="#"/, `${name} has a dead anchor`);
  }
});

test("Wave 6 integration does not modify App.jsx", () => {
  const appSource = read(path.join(here, "..", "src", "App.jsx"));
  assert.doesNotMatch(appSource, /Wave6/, "Wave 6 must be mounted from main.jsx, not App.jsx");
  assert.doesNotMatch(appSource, /features\/intelligence/);
});

// ── Real client wiring ───────────────────────────────────────────────────────

test("Wave6IntelligencePanel loads real data through the intelligence client", () => {
  const source = PANELS["Wave6IntelligencePanel.jsx"];
  assert.match(source, /from "\.\.\/\.\.\/lib\/serviceosIntelligenceClient\.js"/);
  for (const fn of [
    "loadKpiDefinitions",
    "computePeriodKpis",
    "loadKpiSnapshots",
    "loadCanonicalEvents",
    "loadChangeControlRecords",
    "loadContinuitySessions",
    "loadServiceModuleProfiles",
    "loadReleaseGates",
  ]) {
    assert.match(source, new RegExp(`\\b${fn}\\(`), `panel does not call ${fn}`);
  }
});

test("Wave6IntelligencePanel exposes the governed period tabs", () => {
  const source = PANELS["Wave6IntelligencePanel.jsx"];
  for (const tab of ["TODAY", "MONTHLY", "QUARTERLY", "YEARLY"]) {
    assert.ok(source.includes(tab), `missing tab ${tab}`);
  }
  assert.match(source, /periodType: "DAILY"/);
  assert.match(source, /getPeriodBoundaries/);
});

test("Wave6IntelligencePanel handles loading and error states truthfully", () => {
  const source = PANELS["Wave6IntelligencePanel.jsx"];
  assert.match(source, /setLoading\(true\)/);
  assert.match(source, /setLoading\(false\)/);
  assert.match(source, /setError\(formatErrorMessage\(err\)\)/);
  assert.match(source, /setState\(EMPTY_STATE\)/);
});

test("ChangeControlPanel calls real create and update client functions", () => {
  const source = PANELS["ChangeControlPanel.jsx"];
  assert.match(source, /createChangeControlRecord\(session,/);
  assert.match(source, /updateChangeControlRecord\(session, record\.id,/);
  assert.match(source, /nextCcrStatuses\(/);
  assert.match(source, /canCloseChangeControlRecord\(/);
});

test("ChangeControlPanel only offers FSM-legal transitions", () => {
  const source = PANELS["ChangeControlPanel.jsx"];
  assert.match(source, /const transitions = nextCcrStatuses\(record\.change_status\)/);
  assert.doesNotMatch(source, /change_status: "closed"(?!.*canClose)/s);
});

test("ContinuityPanel calls real client functions for every action", () => {
  const source = PANELS["ContinuityPanel.jsx"];
  for (const fn of [
    "createContinuitySession",
    "updateContinuitySession",
    "recordContinuityTransaction",
    "reconcileContinuityTransaction",
    "loadContinuityTransactions",
  ]) {
    assert.match(source, new RegExp(`\\b${fn}\\(`), `ContinuityPanel does not call ${fn}`);
  }
  assert.match(source, /isValidOfflineCorrelationId\(/);
  assert.match(source, /canCloseContinuitySession\(/);
});

test("ModuleReadinessPanel is read-only and gate-sequencing aware", () => {
  const source = PANELS["ModuleReadinessPanel.jsx"];
  assert.match(source, /releaseGateBlockers\(/);
  assert.doesNotMatch(source, /serviceosIntelligenceClient/);
  assert.doesNotMatch(source, /<button/);
});

// ── Formatting discipline ────────────────────────────────────────────────────

test("KPI values are always rendered through the Wave 6 formatters", () => {
  const source = PANELS["KpiReviewPanel.jsx"];
  assert.match(source, /formatKpiValue\(/);
  assert.match(source, /from "\.\/wave6Formatters\.js"/);
  assert.doesNotMatch(source, /\{kpi\.value\}/, "raw KPI value rendered without a formatter");
  assert.doesNotMatch(source, /toFixed\(/, "panels must not format numbers inline");
});

test("formatters never emit NaN, Infinity or undefined", () => {
  assert.match(formatters, /Number\.isFinite/);
  assert.match(formatters, /NO_DATA/);
  assert.doesNotMatch(formatters, /return "NaN"/);
});

test("panels render a no-data marker instead of inventing values", () => {
  assert.match(PANELS["KpiReviewPanel.jsx"], /NO_DATA/);
  assert.match(formatters, /export const NO_DATA = "—"/);
});

test("no Wave 6 UI fabricates sample or demo data", () => {
  for (const [name, source] of Object.entries(ALL_WAVE6_SOURCES)) {
    assert.doesNotMatch(source, /Math\.random\(/, `${name} fabricates random data`);
    assert.doesNotMatch(source, /sampleData|mockData|fakeData|demoData/i, `${name} uses fake data`);
  }
});

// ── Credential hygiene ───────────────────────────────────────────────────────

test("no Wave 6 source references a service-role credential", () => {
  for (const [name, source] of Object.entries({
    ...ALL_WAVE6_SOURCES,
    "serviceosIntelligenceClient.js": clientSource,
    "serviceosIntelligenceUtils.js": utilsSource,
  })) {
    assert.doesNotMatch(source, /SERVICE_ROLE/i, `${name} references a service-role key`);
    assert.doesNotMatch(source, /serviceRoleKey/i, `${name} references a service-role key`);
  }
});

test("Wave 6 UI never performs raw authenticated fetches", () => {
  for (const [name, source] of Object.entries(PANELS)) {
    assert.doesNotMatch(source, /\bfetch\(/, `${name} performs a raw fetch`);
    assert.doesNotMatch(source, /Authorization/i, `${name} builds auth headers itself`);
    assert.doesNotMatch(source, /apikey/i, `${name} references an api key`);
  }
  assert.match(clientSource, /authenticatedRestFetchWithRefresh/);
});

test("Wave 6 sources never log tokens or session objects", () => {
  for (const [name, source] of Object.entries({
    ...ALL_WAVE6_SOURCES,
    "serviceosIntelligenceClient.js": clientSource,
  })) {
    assert.doesNotMatch(source, /console\.(log|info|debug)\(/, `${name} logs to the console`);
    assert.doesNotMatch(source, /access_token/, `${name} touches an access token`);
    assert.doesNotMatch(source, /refresh_token/, `${name} touches a refresh token`);
  }
});

// ── Test registration ────────────────────────────────────────────────────────

test("all five Wave 6 test files are registered in the npm test script", () => {
  const script = packageJson.scripts?.test ?? "";
  for (const file of [
    "tests/serviceosWave6Schema.test.mjs",
    "tests/serviceosWave6Intelligence.test.mjs",
    "tests/serviceosWave6Governance.test.mjs",
    "tests/serviceosWave6Continuity.test.mjs",
    "tests/serviceosWave6Ui.test.mjs",
  ]) {
    assert.ok(script.includes(file), `npm test script is missing ${file}`);
  }
});
