import test from "node:test";
import assert from "node:assert/strict";
import { HUC_ON_CLOSED_QUOTE_REGRESSION } from "./fixtures/hucOntarioClosedQuoteRegression.mjs";

const byId = (id) => HUC_ON_CLOSED_QUOTE_REGRESSION.find((entry) => entry.id === id);
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

test("closed-quote registry separates engine regressions, management custom scopes, and evidence-review cases", () => {
  const statuses = new Set(HUC_ON_CLOSED_QUOTE_REGRESSION.map((entry) => entry.status));
  assert.deepEqual(statuses, new Set(["engine_regression", "management_custom", "evidence_review"]));
});

test("all priced Ontario regression records preserve 13% HST arithmetic", () => {
  for (const entry of HUC_ON_CLOSED_QUOTE_REGRESSION.filter((item) => Number.isFinite(item.subtotal))) {
    assert.equal(entry.market, "HUC-ON");
    assert.equal(entry.currency, "CAD");
    assert.equal(entry.taxRate, 0.13);
    assert.equal(money(entry.subtotal * entry.taxRate), entry.tax, entry.id);
    assert.equal(money(entry.subtotal + entry.tax), entry.total, entry.id);
  }
});

test("Bunni calibrated matrix rate and preferred biweekly rate are locked", () => {
  assert.deepEqual(
    { subtotal: byId("bunni-refresh-4x3_5-2000").subtotal, total: byId("bunni-refresh-4x3_5-2000").total },
    { subtotal: 350, total: 395.5 },
  );
  const recurring = byId("bunni-refresh-4x3_5-2000-biweekly");
  assert.equal(recurring.recurringDiscountPct, 0.1);
  assert.equal(recurring.subtotal, 315);
  assert.equal(recurring.total, 355.95);
});

test("partial-home and mixed/custom scopes cannot masquerade as matrix calibration evidence", () => {
  for (const id of ["salma-partial-refresh-1x1", "denise-move-in-custom-3x3_5", "hailey-mixed-move-in-700", "tina-specialty-windows-baths-oven", "martin-appliance-move-behind-under"]) {
    assert.equal(byId(id).status, "management_custom", id);
    assert.notEqual(byId(id).scopeClass, "matrix_rate", id);
  }
});

test("specialty carpet extraction remains separately identified", () => {
  const bobby = byId("bobby-move-out-carpet-review");
  assert.equal(bobby.status, "evidence_review");
  assert.equal(bobby.knownSpecialtySubtotal, 250);
  assert.match(bobby.notes, /separate carpet shampoo\/extraction/i);
});

test("unverified discrepancy cases are fail-closed against automatic calibration", () => {
  for (const id of ["bobby-move-out-carpet-review", "nashta-initial-vs-recurring-review", "jamal-scope-review", "albert-janet-scope-review"]) {
    const entry = byId(id);
    assert.equal(entry.status, "evidence_review", id);
    assert.equal(entry.subtotal, undefined, `${id} must not carry a guessed governed subtotal`);
  }
});
