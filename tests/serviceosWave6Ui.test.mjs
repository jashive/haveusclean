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
const managementReviewEvidenceSource = read(
  path.join(featureDir, "managementReviewEvidence.js")
);
const clientSource = read(path.join(libDir, "serviceosIntelligenceClient.js"));
const utilsSource = read(path.join(libDir, "serviceosIntelligenceUtils.js"));
const mainSource = read(path.join(here, "..", "src", "main.jsx"));
const packageJson = JSON.parse(read(path.join(here, "..", "package.json")));
const {
  buildSnapshotSourceLineage,
  mergeSnapshotManifest,
  resolveDefinition,
} = await import("../src/features/intelligence/managementReviewEvidence.js");

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
  assert.match(
    source,
    /nextStatus === "closed" && !canCloseChangeControlRecord\(record\)/,
    "closed transitions must be guarded by canCloseChangeControlRecord"
  );
  assert.doesNotMatch(
    source,
    /change_status:\s*"closed"/,
    "ChangeControlPanel must not hard-code an unconditional closed status patch"
  );
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

// ── App.jsx dead control regression (Blocker 2) ──────────────────────────────

test("App.jsx does not contain the alert-only check-in Review button", () => {
  const appSource = read(path.join(here, "..", "src", "App.jsx"));
  assert.doesNotMatch(
    appSource,
    /onClick=\{.*alert\(`Alert reviewed for/,
    "App.jsx must not contain alert-only Review button"
  );
});

test("App.jsx does not contain the Upgrade to Pro alert-only button", () => {
  const appSource = read(path.join(here, "..", "src", "App.jsx"));
  assert.doesNotMatch(
    appSource,
    /Upgrading to Pro plan/,
    "App.jsx must not contain Upgrade to Pro placeholder"
  );
  assert.doesNotMatch(
    appSource,
    /Upgrade to Pro/,
    "App.jsx must not contain Upgrade to Pro control"
  );
});

test("App.jsx does not contain the Manage Billing alert-only button", () => {
  const appSource = read(path.join(here, "..", "src", "App.jsx"));
  assert.doesNotMatch(
    appSource,
    /Billing portal opening/,
    "App.jsx must not contain Billing portal alert"
  );
  assert.doesNotMatch(
    appSource,
    /Manage Billing/,
    "App.jsx must not contain Manage Billing placeholder"
  );
});

test("App.jsx does not contain Partner Logins Coming Soon placeholder", () => {
  const appSource = read(path.join(here, "..", "src", "App.jsx"));
  assert.doesNotMatch(
    appSource,
    /Partner Logins.*Coming Soon/is,
    "App.jsx must not contain Partner Logins Coming Soon"
  );
});

// ── ManagementReviewPanel exists and is wired (Blocker 5) ────────────────────

test("ManagementReviewPanel.jsx exists and exposes management review workflow", () => {
  const src = read(path.join(featureDir, "ManagementReviewPanel.jsx"));
  assert.match(src, /createManagementReview\(/, "must call createManagementReview");
  assert.match(src, /updateManagementReview\(/, "must call updateManagementReview");
  assert.match(src, /captureKpiSnapshot\(/, "must call captureKpiSnapshot");
  assert.match(src, /loadManagementReviews\(/, "must call loadManagementReviews");
  assert.match(src, /canCloseManagementReview\(/, "must check canCloseManagementReview");
  assert.match(src, /canTransitionManagementReview\(/, "must check canTransitionManagementReview");
  assert.match(src, /data-testid="management-review-panel"/, "must have testid");
  assert.match(src, /data-testid="capture-kpi-snapshot-btn"/, "must have snapshot capture button");
});

test("Wave6IntelligencePanel mounts ManagementReviewPanel in the management section", () => {
  const src = PANELS["Wave6IntelligencePanel.jsx"];
  assert.match(src, /ManagementReviewPanel/, "ManagementReviewPanel not imported/used");
  assert.match(src, /activeSection === "management"/, "no management section guard");
  assert.match(src, /loadManagementReviews\(/, "does not call loadManagementReviews");
  assert.match(src, /id: "management"/, "management tab missing from SECTIONS");
});

test("Wave6IntelligencePanel exposes KPI snapshot capture workflow", () => {
  const src = PANELS["Wave6IntelligencePanel.jsx"];
  assert.match(src, /loadKpiSnapshots\(/, "must load snapshots");
  // Snapshot capture is exposed via ManagementReviewPanel
  assert.match(src, /ManagementReviewPanel/, "ManagementReviewPanel provides snapshot capture");
});

// ── Correction area 3: KPI snapshot payload contract (G, H, I, J, K) ────────

const mrpSource = read(path.join(featureDir, "ManagementReviewPanel.jsx"));

test("KPI snapshot payload includes kpi_definition_id resolved from definitions", () => {
  // Criterion G: KPI snapshot payload contains kpi_definition_id
  assert.match(mrpSource, /kpi_definition_id/, "ManagementReviewPanel must send kpi_definition_id");
  assert.match(mrpSource, /resolveDefinition/, "ManagementReviewPanel must call resolveDefinition helper");
  assert.match(mrpSource, /definition\.id/, "kpi_definition_id must be sourced from loaded definition record");
});

test("KPI snapshot payload uses numeric_value not value", () => {
  // Criterion H: KPI snapshot uses numeric_value
  assert.match(
    mrpSource,
    /numeric_value:\s*kpi\.value/,
    "payload must use column name numeric_value"
  );
  assert.doesNotMatch(
    mrpSource,
    /^\s*value:\s*kpi\.value/m,
    "payload must not send a bare 'value' field — that is not a valid kpi_snapshot column"
  );
});

test("KPI snapshot payload uses source_lineage not source_tables", () => {
  // Criterion I: KPI snapshot uses source_lineage
  assert.match(mrpSource, /source_lineage:/, "payload must use source_lineage");
  assert.doesNotMatch(mrpSource, /source_tables:/, "payload must not send source_tables — invalid column");
});

test("KPI snapshot payload uses source_freshness_at not freshness_at", () => {
  // Criterion J: KPI snapshot uses source_freshness_at
  assert.match(mrpSource, /source_freshness_at:/, "payload must use source_freshness_at");
  assert.doesNotMatch(
    mrpSource,
    /(?<!source_)freshness_at:\s*kpi\.freshnessAt/,
    "payload must not send bare freshness_at — that is not a valid kpi_snapshot column"
  );
});

test("KPI snapshot payload does not contain invalid DB column names", () => {
  // Criterion K: no value / row_counts / source_tables / freshness_at invalid DB fields are sent
  // These are NOT columns on kpi_snapshot. The correct names are: numeric_value,
  // source_lineage, source_freshness_at.
  assert.doesNotMatch(mrpSource, /row_counts:/, "must not send row_counts — not a kpi_snapshot column");
  assert.doesNotMatch(mrpSource, /source_tables:/, "must not send source_tables — not a kpi_snapshot column");
  // 'value:' by itself (not as part of numeric_value or definition_version) is not a valid column
  assert.doesNotMatch(
    mrpSource,
    /value: kpi/,
    "must not send raw 'value' field — use numeric_value"
  );
});

test("KPI snapshot resolves kpi_definition_id from definitions — fail closed if missing", () => {
  // Criterion G: If an active definition cannot be resolved, fail closed
  assert.match(mrpSource, /skipped\.push\(/, "must skip KPIs with no definition — fail closed");
  assert.match(managementReviewEvidenceSource, /resolveGovernedKpiDefinition/);
  assert.doesNotMatch(
    mrpSource,
    /kpi_definition_id: null/,
    "must never send null kpi_definition_id"
  );
});

test("KPI snapshot payload links real snapshot ids into the management review manifest", () => {
  assert.match(mrpSource, /kpi_snapshot_manifest:/, "must patch kpi_snapshot_manifest");
  assert.match(mrpSource, /kpi_snapshot_id:/, "manifest must store real snapshot ids");
  assert.match(mrpSource, /snapshot\.id/, "manifest ids must come from DB-returned snapshot rows");
  assert.match(mrpSource, /mergeSnapshotManifest/, "manifest entries must be deduplicated");
});

test("KPI snapshot payload persists effective jurisdiction scope only when computation applied it", () => {
  assert.match(mrpSource, /jurisdiction_id:\s*kpi\.effectiveScope\?\.jurisdiction_id \?\? null/);
});

test("definition resolution fails closed on ambiguity instead of choosing the first row", () => {
  assert.match(managementReviewEvidenceSource, /resolveGovernedKpiDefinition/);
  const resolveDefinitionBody = managementReviewEvidenceSource.slice(
    managementReviewEvidenceSource.indexOf("export function resolveDefinition"),
    managementReviewEvidenceSource.indexOf("export function buildSnapshotSourceLineage")
  );
  assert.doesNotMatch(resolveDefinitionBody, /\.find\(/, "definition resolution must not use Array.find guessing");
});

test("definition resolution fails closed when multiple active versions remain applicable", () => {
  const resolved = resolveDefinition(
    [
      {
        id: "global-v1",
        code: "sales.leads_created",
        definition_version: "1",
        active: true,
        organization_id: null,
        period_support: ["MONTHLY"],
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
      },
      {
        id: "global-v2",
        code: "sales.leads_created",
        definition_version: "2",
        active: true,
        organization_id: null,
        period_support: ["MONTHLY"],
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
      },
    ],
    "sales.leads_created",
    {
      organizationId: "org-1",
      periodType: "MONTHLY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.999Z",
    }
  );
  assert.equal(resolved.definition, null);
  assert.match(resolved.error, /ambiguous governed definition/i);
});

test("definition resolution prefers one applicable organization-scoped row over global", () => {
  const resolved = resolveDefinition(
    [
      {
        id: "global-v1",
        code: "sales.leads_created",
        definition_version: "1",
        active: true,
        organization_id: null,
        period_support: ["MONTHLY"],
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
      },
      {
        id: "org-v1",
        code: "sales.leads_created",
        definition_version: "1",
        active: true,
        organization_id: "org-1",
        period_support: ["MONTHLY"],
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
      },
    ],
    "sales.leads_created",
    {
      organizationId: "org-1",
      periodType: "MONTHLY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.999Z",
    }
  );
  assert.equal(resolved.definition?.id, "org-v1");
});

test("buildSnapshotSourceLineage combines governed definition lineage and runtime lineage", () => {
  const lineage = buildSnapshotSourceLineage(
    {
      code: "sales.leads_created",
      definition_version: "1",
      source_lineage: { canonical_event_name: "sales.lead.created" },
    },
    {
      sourceLineage: {
        runtime: {
          kpi_code: "sales.leads_created",
          row_counts: { service_request: 2 },
        },
      },
    }
  );
  assert.deepEqual(lineage.definition_ref, {
    kpi_code: "sales.leads_created",
    definition_version: "1",
  });
  assert.deepEqual(lineage.definition, { canonical_event_name: "sales.lead.created" });
  assert.deepEqual(lineage.runtime.row_counts, { service_request: 2 });
});

test("mergeSnapshotManifest references real snapshot ids without duplicates", () => {
  const merged = mergeSnapshotManifest(
    [
      {
        kpi_snapshot_id: "snap-1",
        kpi_code: "sales.leads_created",
        definition_version: "1",
        captured_at: "2026-08-17T00:00:00.000Z",
      },
    ],
    [
      {
        kpi_snapshot_id: "snap-1",
        kpi_code: "sales.leads_created",
        definition_version: "1",
        captured_at: "2026-08-17T00:00:00.000Z",
      },
      {
        kpi_snapshot_id: "snap-2",
        kpi_code: "operations.jobs_created",
        definition_version: "1",
        captured_at: "2026-08-17T00:01:00.000Z",
      },
    ]
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((entry) => entry.kpi_snapshot_id).sort(),
    ["snap-1", "snap-2"]
  );
});

// ── Correction area 4: Management review operability (L) ─────────────────────

test("ManagementReviewPanel has actual mutation paths for exceptions", () => {
  // Criterion L: management review actions/exceptions/decisions/waiver have actual mutation paths
  assert.match(mrpSource, /handleAddException/, "must have exception mutation handler");
  assert.match(mrpSource, /Add Exception|\+ Exception/i, "must expose Add Exception control");
  assert.match(mrpSource, /exceptions: updated/, "must update exceptions array via updateManagementReview");
});

test("ManagementReviewPanel has actual mutation paths for decisions", () => {
  // Criterion L
  assert.match(mrpSource, /handleAddDecision/, "must have decision mutation handler");
  assert.match(mrpSource, /Add Decision|\+ Decision/i, "must expose Add Decision control");
  assert.match(mrpSource, /decisions: updated/, "must update decisions array via updateManagementReview");
});

test("ManagementReviewPanel has actual mutation paths for actions and resolve", () => {
  // Criterion L
  assert.match(mrpSource, /handleAddAction/, "must have action mutation handler");
  assert.match(mrpSource, /Add Action|\+ Action/i, "must expose Add Action control");
  assert.match(mrpSource, /handleResolveAction/, "must have action resolve handler");
  assert.match(mrpSource, /is_resolved: true/, "must mark action resolved");
  assert.match(mrpSource, /actions: updated/, "must update actions array via updateManagementReview");
});

test("ManagementReviewPanel has actual mutation path for waiver", () => {
  // Criterion L
  assert.match(mrpSource, /handleRecordWaiver/, "must have waiver mutation handler");
  assert.match(mrpSource, /waiver_recorded: true/, "must set waiver_recorded=true via updateManagementReview");
  assert.match(mrpSource, /data-testid="record-waiver-btn"/, "must have waiver button testid");
});

test("Wave6IntelligencePanel passes kpiDefinitions to ManagementReviewPanel", () => {
  // Criterion G: definitions must be forwarded so kpi_definition_id can be resolved
  const w6src = PANELS["Wave6IntelligencePanel.jsx"];
  assert.match(
    w6src,
    /kpiDefinitions=\{state\.definitions\}/,
    "Wave6IntelligencePanel must pass kpiDefinitions to ManagementReviewPanel"
  );
});
