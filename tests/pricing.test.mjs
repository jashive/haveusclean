import test from "node:test";
import assert from "node:assert/strict";
import { getJobCompensationBreakdown } from "../src/core/pricing/sharedPricing.js";

test("getJobCompensationBreakdown preserves existing scheduled-job math", () => {
  const result = getJobCompensationBreakdown({ teamSize: 2, hours: 3 });

  assert.equal(result.teamSize, 2);
  assert.equal(result.hours, 3);
  assert.equal(result.clientPrice, 300);
  assert.equal(result.partnerPayTotal, 180);
  assert.equal(result.partnerPayEach, 90);
  assert.equal(result.profit, 120);
});

test("getJobCompensationBreakdown normalizes empty team sizes", () => {
  const result = getJobCompensationBreakdown({ teamSize: 0, hours: 2 });

  assert.equal(result.teamSize, 1);
  assert.equal(result.clientPrice, 100);
  assert.equal(result.partnerPayEach, 60);
});