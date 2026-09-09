import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { completeServiceOSTour, hasCompletedServiceOSTour, persistServiceOSTips, positionServiceOSTip, SERVICEOS_TOUR_STEPS, serviceOSTipsEnabled, WORKSPACE_HELP } from "../src/lib/serviceosLearnability.js";

const layout = fs.readFileSync(new URL("../src/features/admin/AdminCockpitLayout.jsx", import.meta.url), "utf8");
const tour = fs.readFileSync(new URL("../src/features/admin/TourOverlay.jsx", import.meta.url), "utf8");
const help = fs.readFileSync(new URL("../src/features/admin/HelpPanel.jsx", import.meta.url), "utf8");
const tips = fs.readFileSync(new URL("../src/features/admin/TipLayer.jsx", import.meta.url), "utf8");
const topbar = fs.readFileSync(new URL("../src/features/admin/AdminTopBar.jsx", import.meta.url), "utf8");
const toggle = fs.readFileSync(new URL("../src/features/admin/TipsToggle.jsx", import.meta.url), "utf8");
const dispatch = fs.readFileSync(new URL("../src/features/admin/DispatchCalendar.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/UnscheduledWorkQueue.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/DispatchJobBadge.jsx", import.meta.url), "utf8");
const team = fs.readFileSync(new URL("../src/features/admin/ApplicantPipelineBoard.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/ApplicantReviewModal.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/ActiveContractorDirectory.jsx", import.meta.url), "utf8");
const financials = fs.readFileSync(new URL("../src/features/admin/ExecutiveKpiBar.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/PayableSettlementBoard.jsx", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/features/admin/JobProfitabilityTable.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function countApiFiles(directory) { return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countApiFiles(new URL(`${entry.name}/`, directory)) : Number(entry.name.endsWith(".js"))), 0); }

test("tour follows the four-workspace operating lifecycle", () => {
  assert.deepEqual(SERVICEOS_TOUR_STEPS.map((step) => step.workspace), ["flight-control", "pipeline-dispatch", "team-hiring", "financial-ledgers"]);
  assert.equal(new Set(SERVICEOS_TOUR_STEPS.map((step) => step.selector)).size, 4);
});

test("every workspace has a concise operating procedure", () => {
  for (const step of SERVICEOS_TOUR_STEPS) assert.equal(WORKSPACE_HELP[step.workspace].steps.length, 3);
});

test("tour dismissal is versioned and persists without a backend write", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(hasCompletedServiceOSTour(storage), false); completeServiceOSTour(storage); assert.equal(hasCompletedServiceOSTour(storage), true);
});

test("hover-tip preference defaults on and persists an explicit dismissal", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(serviceOSTipsEnabled(storage), true); persistServiceOSTips(false, storage); assert.equal(serviceOSTipsEnabled(storage), false); persistServiceOSTips(true, storage); assert.equal(serviceOSTipsEnabled(storage), true);
  assert.equal(values.get("serviceos_tips_enabled"), "true");
});

test("hover tips cover dispatch, team, and financial workspaces", () => {
  for (const phrase of ["Click or drag to assign an operable contractor and schedule a slot.", "Scheduled operational commitments by territory.", "Commercial facility inquiry — requires square footage walkthrough inspection."]) assert.ok(dispatch.includes(phrase));
  for (const phrase of ["Applicant profile — review background checks and advance stage.", "Promote applicant to next onboarding milestone", "Switch contractor between active roster and operable dispatch queue.", "Assigned operating jurisdiction"]) assert.ok(team.includes(phrase));
  for (const phrase of ["Total gross contract value scheduled and realized across active territories.", "Contractor labor liability accrued against completed and active work orders.", "Operating margin retained after direct contractor payouts and supplies.", "Pending and approved contractor earnings awaiting disbursement batching.", "Governed disbursement trigger writing to immutable append-only ledger.", "Healthy ≥50%, Watch ≥30%, At Risk <30%"] ) assert.ok(financials.includes(phrase));
  assert.doesNotMatch(financials, /Real-time gross booking volume and realized margin/);
  assert.match(tips, /Don’t show tips again/);
});

test("tooltip collision logic stays inside the viewport and flips above", () => {
  assert.deepEqual(positionServiceOSTip({ left: 980, width: 40, top: 700, bottom: 740 }, { width: 300, height: 60 }, { width: 1024, height: 768 }), { left: 712, top: 630, width: 300 });
  assert.deepEqual(positionServiceOSTip({ left: 0, width: 20, top: 20, bottom: 40 }, { width: 300, height: 60 }, { width: 1024, height: 768 }), { left: 12, top: 50, width: 300 });
});

test("admin shell exposes replayable help and route-aware tour composition", () => {
  for (const contract of ["HelpPanel", "TourOverlay", "hasCompletedServiceOSTour", "completeServiceOSTour", "onWorkspaceChange"]) assert.match(layout + tour, new RegExp(contract));
  assert.match(topbar, />Help<\/button>/); assert.doesNotMatch(layout + tour + help, /\/api\//);
  assert.match(topbar, /TipsToggle/); assert.match(layout, /TipLayer/); assert.match(tips, /closest\?\.\("\[data-tip\]"\)/);
});

test("top bar always exposes a fixed-size lightbulb toggle immediately before Help", () => {
  assert.match(topbar, /<TipsToggle[\s\S]*<button className="admin-help-button"/);
  assert.match(toggle, /aria-label="Toggle Tips"/);
  assert.match(toggle, /width="20" height="20"/);
  assert.doesNotMatch(topbar + toggle, /className="[^"]*\bhidden\b|className="[^"]*\bmd:flex\b/);
  assert.match(css, /min-width:82px/);
});

test("global TipLayer is mounted once outside all workspace switches", () => {
  assert.equal((layout.match(/<TipLayer/g) || []).length, 1);
  assert.ok(layout.indexOf("<TipLayer") > layout.indexOf("FinancialLedgersWorkspace"));
});

test("help and tour implement keyboard and dialog accessibility", () => {
  assert.match(tour, /ArrowRight/); assert.match(tour, /ArrowLeft/); assert.match(tour + help, /Escape/); assert.match(help, /Shift\+Tab/); assert.match(tour + help, /aria-modal="true"/); assert.match(css, /prefers-reduced-motion/);
});

test("learnability layer adds no serverless function or database migration", () => {
  assert.equal(countApiFiles(new URL("../api/", import.meta.url)), 12);
  assert.doesNotMatch(layout + tour + help, /supabase\/migrations|staff_/);
});
