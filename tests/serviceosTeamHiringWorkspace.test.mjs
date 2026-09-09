import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HIRING_STAGES, hiringStage, normalizeApplicant, normalizeContractor } from "../src/lib/serviceosTeamHiring.js";

function countApiFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countApiFiles(new URL(`${entry.name}/`, directory)) : Number(entry.name.endsWith(".js"))), 0);
}

test("commercial hiring stages collapse canonical compliance states deterministically", () => {
  assert.deepEqual(HIRING_STAGES, ["Applied", "Screening", "Interview", "Offer", "Operable / Hired"]);
  assert.equal(hiringStage("Documents Pending"), "Screening");
  assert.equal(hiringStage("ServiceOS Ready"), "Operable / Hired");
});

test("applicant cards retain canonical state, territory, age, and document progress", () => {
  const applicant = normalizeApplicant({ applicant_submission_id: "a1", display_name: "Ada", pipeline_stage: "Screening", submitted_at: "2026-09-06T00:00:00Z", documents_completed: 1 }, "HUC-AZ", new Date("2026-09-08T12:00:00Z").getTime());
  assert.deepEqual({ id: applicant.id, name: applicant.name, stage: applicant.stage, market: applicant.marketCode, age: applicant.ageDays, documents: applicant.documentCompleted }, { id: "a1", name: "Ada", stage: "Screening", market: "HUC-AZ", age: 2, documents: 1 });
  assert.equal(applicant.documentRequired, null);
});

test("contractor projection chooses active assignment and governed compensation", () => {
  const contractor = normalizeContractor({ id: "w1", status: "active" }, [{ worker_id: "w1", assignment_status: "assigned", operational_job: { service_family: "residential" } }], [{ worker_id: "w1", rate_value: 25, currency_code: "USD", compensation_method: "hourly" }]);
  assert.deepEqual({ ready: contractor.dispatchReady, assignment: contractor.currentAssignment, rate: contractor.rateValue, currency: contractor.currencyCode }, { ready: true, assignment: "residential", rate: 25, currency: "USD" });
});

test("team workspace is routed in the commercial admin shell without a new function", () => {
  const layout = fs.readFileSync(new URL("../src/features/admin/AdminCockpitLayout.jsx", import.meta.url), "utf8");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const apiFileCount = countApiFiles(new URL("../api/", import.meta.url));
  assert.match(layout, /TeamHiringWorkspace/);
  assert.equal(vercel.functions ? Object.keys(vercel.functions).length : 0, 0);
  assert.equal(vercel.rewrites.length, 5);
  assert.equal(apiFileCount, 12);
});

test("team mutations reuse governed workforce and worker boundaries", () => {
  const client = fs.readFileSync(new URL("../src/lib/serviceosTeamHiring.js", import.meta.url), "utf8");
  assert.match(client, /\/api\/workforce\/dashboard/);
  assert.match(client, /worker\?id=eq\./);
  assert.doesNotMatch(client, /applicant_submission.*PATCH/);
});
