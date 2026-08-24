import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GOVERNED_RESIDENTIAL_REQUIRED_VERSION,
  getGovernedResidentialRequiredVersion,
} from "../src/lib/governedResidentialConfig.js";
import { computeGovernedResidentialQuote } from "../src/lib/governedResidentialPricing.js";
import { capturePricingSnapshot } from "../src/lib/serviceosRevenueUtils.js";
import { buildCustomerFacingQuoteText, getDefaultApprovedSelections } from "../src/lib/serviceosOfficeQuoteUtils.js";

function azConfig() {
  return {
    id: "cfg-az",
    organization_id: "org",
    business_unit_id: "bu-az",
    jurisdiction_id: "jur-az",
    configuration_type: "residential_pricing",
    version: "AZ-2026-08-v1.0",
    status: "published",
    configuration: {
      business_unit_code: "HUC-AZ",
      jurisdiction_code: "US-AZ",
      currency_code: "USD",
      tax: { label: "SERVICE TAX", rate: 0, service_taxable: false },
      minimum_charge: { general_residential: 60 },
      dwelling_matrix: {
        semi_detached_detached: {
          "3bed_2bath": { essential_refresh: 250, signature_initial_reset: 330, complete_deep: 420, move_in_move_out: 350 },
        },
      },
      packages: { complete_deep_clean: { name: "Complete Deep Clean" } },
      premium_addons: { inside_refrigerator: 35 },
      recurring_service: {
        weekly_discount: { min: 0.15, max: 0.15 },
        biweekly_discount: { min: 0.1, max: 0.1 },
        monthly_discount: { min: 0.05, max: 0.05 },
      },
      condition_adjustments: {
        light: { minimum_markup: 0, maximum_markup: 0 },
        moderate: { minimum_markup: 0.1, maximum_markup: 0.15 },
        heavy: { minimum_markup: 0.2, maximum_markup: 0.35 },
      },
      square_footage_adjustments: {},
      urgency: {},
    },
  };
}

test("Goal 5.6A resolves governed versions by business unit and fails closed otherwise", () => {
  assert.equal(GOVERNED_RESIDENTIAL_REQUIRED_VERSION, "ON-2026-08-v1.0");
  assert.equal(getGovernedResidentialRequiredVersion("HUC-ON"), "ON-2026-08-v1.0");
  assert.equal(getGovernedResidentialRequiredVersion("HUC-AZ"), "AZ-2026-08-v1.0");
  assert.throws(() => getGovernedResidentialRequiredVersion("HUC-XX"), /unsupported business unit/);
});

test("Goal 5.6A Arizona detached 3/2 complete deep is USD 420 with zero service tax", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: azConfig(), dwellingType: "Detached House", beds: 3, baths: 2,
    packageKey: "complete_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 420);
  assert.equal(quote.taxAmount, 0);
  assert.equal(quote.total, 420);
  assert.equal(quote.taxName, "SERVICE TAX");
  assert.equal(quote.currency, "USD");
  assert.equal(quote.currencyCode, "USD");
});

test("Goal 5.6A Arizona weekly recurring pricing applies governed 15 percent discount", () => {
  const config = azConfig();
  const approvedSelections = getDefaultApprovedSelections(config, { condition: "light", frequency: "weekly", sqftBand: "" });
  const quote = computeGovernedResidentialQuote({
    configurationVersion: config, dwellingType: "Detached House", beds: 3, baths: 2,
    packageKey: "essential_refresh", condition: "light", frequency: "weekly", addons: [], approvedSelections,
  });
  assert.equal(quote.preTaxTotal, 212.5);
  assert.equal(quote.total, 212.5);
  assert.equal(quote.discPct, 0.15);
});

test("Goal 5.6A Arizona pricing snapshot freezes USD rather than CAD", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: azConfig(), dwellingType: "Detached House", beds: 3, baths: 2,
    packageKey: "complete_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  const snap = capturePricingSnapshot({
    quote, organizationId: "org", businessUnitId: "bu-az", configurationVersionId: "cfg-az",
    configurationSnapshot: { version: "AZ-2026-08-v1.0" }, governedResidential: true,
  });
  assert.equal(snap.currency_code, "USD");
  assert.equal(snap.tax_rate, 0);
  assert.equal(snap.tax_amount, 0);
});

test("Goal 5.6A Arizona customer message never claims HST", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: azConfig(), dwellingType: "Detached House", beds: 3, baths: 2,
    packageKey: "complete_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  const text = buildCustomerFacingQuoteText({ customerName: "Test Customer", serviceLabel: "Complete Deep Clean", quote, frequencyLabel: "One-Time" });
  assert.match(text, /\$420\.00 total/);
  assert.match(text, /no service tax applied/i);
  assert.doesNotMatch(text, /HST/);
});

test("Goal 5.6A owner shell carries active market context while non-owner remains limited by visible BU records", () => {
  const source = fs.readFileSync(new URL("../src/features/wave1/ServiceOSWave1Workspace.jsx", import.meta.url), "utf8");
  assert.match(source, /role === "owner_admin" && businessUnitRecords\.length > 1/);
  assert.match(source, /Ontario — HUC-ON/);
  assert.match(source, /Arizona — HUC-AZ/);
  assert.match(source, /primaryBusinessUnitId: activeBusinessUnit\.id/);
  assert.match(source, /primaryJurisdictionId: activeBusinessUnit\.jurisdictionId/);
});

test("Goal 5.6A migration contains published Arizona USD zero-tax configuration", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260824234500_goal5_owner_multimarket_revenue.sql", import.meta.url), "utf8");
  assert.match(sql, /AZ-2026-08-v1\.0/);
  assert.match(sql, /'currency_code','USD'/);
  assert.match(sql, /'rate',0/);
  assert.match(sql, /bu\.code = 'HUC-AZ'/);
});
