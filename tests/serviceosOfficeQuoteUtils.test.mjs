import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGovernedResidentialAddons,
  getDefaultApprovedSelections,
  getManagementReviewReason,
  buildCustomerFacingQuoteText,
} from "../src/lib/serviceosOfficeQuoteUtils.js";

const configurationVersion = {
  configuration: {
    tax: { rate: 0.13 },
    condition_adjustments: {
      moderate: { minimum_markup: 0.1, maximum_markup: 0.15 },
      heavy: { minimum_markup: 0.2, maximum_markup: 0.35 },
    },
    recurring_service: {
      weekly_discount: { min: 0.1, max: 0.15 },
      biweekly_discount: { min: 0.05, max: 0.1 },
      monthly_discount: { min: 0, max: 0.05 },
    },
    square_footage_adjustments: {
      additional_250_500_sqft: { minimum: 25, maximum: 50 },
      additional_500_1000_sqft: { minimum: 50, maximum: 100 },
    },
    premium_addons: {
      inside_refrigerator: 40,
      inside_oven: 40,
      inside_kitchen_cabinets_minimum: 40,
      interior_windows_starting: 40,
      pet_hair_removal_starting: 40,
      heavy_baseboard_detailing_starting: 40,
      balcony_cleaning_starting: 40,
      garage_sweep_out_starting: 40,
    },
  },
};

test("office defaults use the published minimum approved values", () => {
  const selections = getDefaultApprovedSelections(configurationVersion, {
    condition: "moderate",
    frequency: "biweekly",
    sqftBand: "additional_250_500_sqft",
  });
  assert.equal(selections.conditionMarkupPct, 0.1);
  assert.equal(selections.recurringDiscountPct, 0.05);
  assert.equal(selections.sqftAdjustmentAmount, 25);
});

test("governed add-ons update subtotal and HST without mutating source quote", () => {
  const source = { preTaxTotal: 200, taxAmount: 26, total: 226, taxRate: 0.13, input: {} };
  const quote = applyGovernedResidentialAddons(source, configurationVersion, ["inside_refrigerator", "inside_oven"]);
  assert.equal(source.preTaxTotal, 200);
  assert.equal(quote.addonTotal, 80);
  assert.equal(quote.preTaxTotal, 280);
  assert.equal(quote.taxAmount, 36.4);
  assert.equal(quote.total, 316.4);
});

test("Complete Deep blocks duplicate included add-ons", () => {
  assert.match(
    getManagementReviewReason({ packageKey: "complete_deep", condition: "light", addons: ["inside_oven"], notes: "" }),
    /already includes/i
  );
});

test("hazard language routes the quote to management review", () => {
  assert.match(
    getManagementReviewReason({ packageKey: "essential_refresh", condition: "light", addons: [], notes: "Customer reports mold in basement" }),
    /hazardous or specialty/i
  );
});

test("customer-facing quote asks for the booking", () => {
  const text = buildCustomerFacingQuoteText({
    customerName: "Jean Example",
    serviceLabel: "Essential Refresh Clean",
    frequencyLabel: "Biweekly",
    quote: { preTaxTotal: 250, total: 282.5, addonLines: [] },
  });
  assert.match(text, /Hi Jean/);
  assert.match(text, /\$250\.00 \+ HST/);
  assert.match(text, /\$282\.50/);
  assert.match(text, /Would you like me to check availability and get that scheduled for you\?/);
});
