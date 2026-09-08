import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [ui, shell, leads, operations, workforce, css] = await Promise.all([
  readFile(new URL("../src/components/ui.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/wave1/ServiceOSWave1Workspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/wave1/ServiceOSLeadIntakePanel.jsx", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/wave3/TechnicianExecutionCard.jsx", import.meta.url), "utf8"),
  ]).then((sources) => sources.join("\n")),
  readFile(new URL("../src/features/workforce/WorkforceComplianceDashboard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("Phase C provides shared status, technical disclosure, and detail drawer primitives", () => {
  assert.match(ui, /export function DetailDrawer/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /export function TechnicalDetails/);
  assert.match(shell, /<TechnicalDetails><span>Organization ID:/);
});

test("Revenue lead queue is searchable, filterable, and uses plain-language semantic states", () => {
  assert.match(leads, /type="search"/);
  assert.match(leads, /Lead queue filters/);
  assert.match(leads, /NEW/);
  assert.match(leads, /CONTACTED/);
  assert.match(leads, /ESTIMATE SENT/);
  assert.match(leads, /WON/);
  assert.match(leads, /role="table"/);
  assert.match(leads, /Service request: \{row\.service_request\.id\}/);
});

test("Dispatch exposes active-territory, date, and human-readable search controls", () => {
  assert.match(operations, /aria-label="Dispatch filters"/);
  assert.match(operations, /Active dispatch territory/);
  assert.match(operations, /type="date"/);
  assert.match(operations, /Customer, service, or location/);
  assert.match(operations, /Operational job: \{job\.id\}/);
});

test("Workforce keeps the pipeline visible while candidate evidence opens in a drawer", () => {
  assert.match(workforce, /className="admin-stage-summary"/);
  assert.match(workforce, /Search candidates/);
  assert.match(workforce, /<DetailDrawer open=\{Boolean\(applicantInspector\)\}/);
  assert.match(workforce, /Open restricted document \(2 min\)/);
  assert.match(workforce, /completed_count \|\| 0/);
  assert.match(workforce, /Activate to ServiceOS/);
});

test("Worker execution uses minimum 52px controls, checklist states, and camera-first photo input", () => {
  assert.match(operations, /className="field-workspace"/);
  assert.match(operations, /field-checklist-item/);
  assert.match(operations, /accept="image\/\*"/);
  assert.match(operations, /capture="environment"/);
  assert.match(css, /\.field-primary-action\{min-height:52px/);
  assert.match(css, /\.field-checklist-item\{[^}]*min-height:58px/);
});

test("Phase C remains presentation-only and does not add a serverless function", () => {
  for (const source of [ui, shell, leads, operations, workforce, css]) {
    assert.doesNotMatch(source, /api\/phase-c|api\/admin-ui/);
  }
});

test("375px and 768px responsive guards prevent clipped booking, upload, and field controls", () => {
  assert.match(css, /\.booking-page\{[^}]*overflow-x:clip/);
  assert.match(css, /\.candidate-portal\{[^}]*overflow-x:clip/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.wizard-actions \.huc-button\{[^}]*max-width:100%/);
  assert.match(css, /\.document-zone__heading\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.huc-training-list button\{grid-template-columns:30px minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*\.field-workspace\{[^}]*overflow-x:hidden/);
  assert.match(css, /\.field-checklist-item\{grid-template-columns:22px minmax\(0,1fr\) 30px/);
});
