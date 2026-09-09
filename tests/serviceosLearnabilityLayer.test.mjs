import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { completeServiceOSTour, hasCompletedServiceOSTour, SERVICEOS_TOUR_STEPS, WORKSPACE_HELP } from "../src/lib/serviceosLearnability.js";

const layout = fs.readFileSync(new URL("../src/features/admin/AdminCockpitLayout.jsx", import.meta.url), "utf8");
const tour = fs.readFileSync(new URL("../src/features/admin/TourOverlay.jsx", import.meta.url), "utf8");
const help = fs.readFileSync(new URL("../src/features/admin/HelpPanel.jsx", import.meta.url), "utf8");
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

test("admin shell exposes replayable help and route-aware tour composition", () => {
  for (const contract of ["HelpPanel", "TourOverlay", "hasCompletedServiceOSTour", "completeServiceOSTour", "onWorkspaceChange"]) assert.match(layout + tour, new RegExp(contract));
  assert.match(layout, />Help<\/button>/); assert.doesNotMatch(layout + tour + help, /\/api\//);
});

test("help and tour implement keyboard and dialog accessibility", () => {
  assert.match(tour, /ArrowRight/); assert.match(tour, /ArrowLeft/); assert.match(tour + help, /Escape/); assert.match(help, /Shift\+Tab/); assert.match(tour + help, /aria-modal="true"/); assert.match(css, /prefers-reduced-motion/);
});

test("learnability layer adds no serverless function or database migration", () => {
  assert.equal(countApiFiles(new URL("../api/", import.meta.url)), 12);
  assert.doesNotMatch(layout + tour + help, /supabase\/migrations|staff_/);
});
