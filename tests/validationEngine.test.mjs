import test from "node:test";
import assert from "node:assert/strict";
import {
  createValidationResult,
  validateBooking,
  validateCustomer,
  validateInvoice,
  validateLead,
  validateQuote,
  validateWorkOrder,
} from "../src/core/validation/validationEngine.js";

test("createValidationResult preserves warnings and blocking issues", () => {
  const result = createValidationResult({
    warnings: ["missing region"],
    blockingIssues: ["missing service type"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing service type");
  assert.equal(result.warnings[0].type, "warning");
  assert.equal(result.blockingIssues[0].type, "blocking");
});

test("validateLead reports invalid placeholder rows", () => {
  const result = validateLead({ company: "[company]", notes: "demo lead" });

  assert.equal(result.valid, false);
  assert.match(result.reason, /placeholder or test record/);
  assert.ok(Array.isArray(result.errors));
});

test("validateQuote requires a service and amount", () => {
  const result = validateQuote({ serviceType: "", total: 0 });

  assert.equal(result.valid, false);
  assert.match(result.reason, /missing service type|invalid quote total/);
});

test("workflow validators expose blocking results", () => {
  assert.equal(validateBooking({}).valid, false);
  assert.equal(validateInvoice({}).valid, false);
  assert.equal(validateCustomer({}).valid, false);
  assert.equal(validateWorkOrder({}).valid, false);
});
