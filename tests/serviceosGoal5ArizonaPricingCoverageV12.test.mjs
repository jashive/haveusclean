import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { computeGovernedResidentialQuote } from "../src/lib/governedResidentialPricing.js";
import { getTeamSize, getJobHours } from "../src/core/pricing/sharedPricing.js";

const configSource = fs.readFileSync("src/lib/governedResidentialConfig.js", "utf8");
const migrationSource = fs.readFileSync("supabase/migrations/20260831175500_goal5_az_residential_coverage_v12.sql", "utf8");
const continuationSource = fs.readFileSync("src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", "utf8");

test("HUC-AZ live governed residential version is v1.2", () => {
  assert.match(configSource, /"HUC-AZ": "AZ-2026-08-v1\.2"/);
});

test("AZ v1.2 preserves Drive authority and expands standard half-bath coverage", () => {
  assert.match(migrationSource, /1txtaX9EMg12jAGovbkv4SUyGlZLSVvReq1u6wfxDsYw/);
  assert.match(migrationSource, /generate_series\(1\.0::numeric,4\.0::numeric,0\.5::numeric\)/);
  assert.match(migrationSource, /generate_series\(1\.0::numeric,4\.5::numeric,0\.5::numeric\)/);
  assert.match(migrationSource, /generate_series\(1\.0::numeric,5\.0::numeric,0\.5::numeric\)/);
  assert.match(migrationSource, /'half_bath_increment',15/);
});

test("Santress 3 bed 2.5 bath apartment Essential Refresh is a normal governed AZ quote", () => {
  const configurationVersion = {
    version: "AZ-2026-08-v1.2",
    configuration: {
      currency_code: "USD",
      dwelling_matrix: { apartments_condos: { "3bed_2_5bath": { essential_refresh: 235, signature_initial_reset: 295, complete_deep: 385, move_in_move_out: 315 } } },
      condition_adjustments: { light: { minimum_markup: 0, maximum_markup: 0 } },
      recurring_service: {},
      minimum_charge: { general_residential: 60 },
      premium_addons: {},
      tax: { rate: 0, label: "SERVICE TAX" }
    }
  };
  const quote = computeGovernedResidentialQuote({
    configurationVersion, dwellingType: "Apartment / Condo", beds: 3, baths: 2.5, packageKey: "essential_refresh",
    condition: "light", frequency: "one_time", addons: [],
    approvedSelections: { teamSize: getTeamSize(1352), jobHours: getJobHours(1352) }
  });
  assert.equal(quote.requiresOfficeReview, undefined);
  assert.equal(quote.currencyCode, "USD");
  assert.equal(quote.preTaxTotal, 235);
  assert.equal(quote.taxAmount, 0);
  assert.equal(quote.total, 235);
  assert.equal(quote.teamSize, 2);
  assert.equal(quote.jobHours, 1.5);
});

test("saved-lead review banner strips an already-present management-review prefix", () => {
  assert.ok(continuationSource.includes('review.replace(/^Requires Management Review'));
  assert.ok(continuationSource.includes('Custom Pricing:'));
});

test("saved-lead customer identity comes from lead requirements, not operator display text", () => {
  assert.match(continuationSource, /const customer = req\.customer \|\| \{\}/);
  assert.match(continuationSource, /customerName: text\(customer\.name\)/);
  assert.ok(continuationSource.includes('const appUserId = revenueContext?.appUserId || null;'));
  assert.doesNotMatch(continuationSource, /customerName:\s*(?:revenueContext|session|appUserId)/);
});
