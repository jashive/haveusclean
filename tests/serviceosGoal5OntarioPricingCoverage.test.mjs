import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { computeGovernedResidentialQuote } from "../src/lib/governedResidentialPricing.js";
import {
  isAddonBundledForPackage,
  removeBundledAddonsForPackage,
} from "../src/lib/serviceosOfficeQuoteUtils.js";
import { getGovernedResidentialRequiredVersion } from "../src/lib/governedResidentialConfig.js";

function onV11Config() {
  return {
    id: "cfg-on-v11",
    organization_id: "org",
    business_unit_id: "bu-on",
    jurisdiction_id: "jur-on",
    configuration_type: "residential_pricing",
    version: "ON-2026-08-v1.1",
    status: "published",
    configuration: {
      business_unit_code: "HUC-ON",
      jurisdiction_code: "CA-ON",
      currency_code: "CAD",
      tax: { label: "HST", rate: 0.13 },
      minimum_charge: { general_residential: 200 },
      dwelling_matrix: {
        townhouses: {
          "3bed_2bath": {
            sqft_min: 1200,
            sqft_max: 1650,
            essential_refresh: 260,
            signature_initial_reset: 340,
            complete_deep: 460,
            move_in_move_out: 315,
          },
        },
      },
      kitchen_bath_packages: {
        kitchen_1bath: { essential_refresh: 180, complete_deep: 260 },
        kitchen_1_5bath: { essential_refresh: 200, complete_deep: 280 },
        kitchen_2bath: { essential_refresh: 225, complete_deep: 305 },
        kitchen_2_5bath: { essential_refresh: 250, complete_deep: 330 },
        kitchen_3bath: { essential_refresh: 275, complete_deep: 355 },
        kitchen_3_5bath: { essential_refresh: 300, complete_deep: 380 },
        kitchen_4bath: { essential_refresh: 325, complete_deep: 405 },
        complete_deep_includes: ["Inside refrigerator", "Inside oven"],
        inside_kitchen_cabinets_additional_minimum: 40,
      },
      packages: {
        complete_deep_clean: {
          name: "Complete Deep Clean",
          includes: ["Inside refrigerator", "Inside oven", "Inside empty kitchen cabinets and drawers"],
          do_not_double_charge: ["Inside refrigerator", "Inside oven", "Inside kitchen cabinets"],
        },
      },
      premium_addons: {
        inside_refrigerator: 40,
        inside_oven: 40,
        inside_kitchen_cabinets_minimum: 40,
        pet_hair_removal_starting: 40,
      },
      recurring_service: {},
      condition_adjustments: { light: { minimum_markup: 0, maximum_markup: 0 } },
      urgency: {},
      square_footage_adjustments: {},
    },
  };
}

function azConfig() {
  return {
    id: "cfg-az-v10",
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
      tax: { label: "Service tax", rate: 0 },
      minimum_charge: { general_residential: 0 },
      dwelling_matrix: {
        semi_detached_detached: {
          "3bed_2bath": { essential_refresh: 180, signature_initial_reset: 240, complete_deep: 320, move_in_move_out: 280 },
        },
      },
      packages: {},
      premium_addons: {},
      recurring_service: {},
      condition_adjustments: { light: { minimum_markup: 0, maximum_markup: 0 } },
      urgency: {},
      square_footage_adjustments: {},
    },
  };
}

test("Ontario live market resolves successor pricing version v1.1", () => {
  assert.equal(getGovernedResidentialRequiredVersion("HUC-ON"), "ON-2026-08-v1.1");
});

test("Ontario v1.1 townhouse 3 bed / 2 bath Complete Deep is CA$460 plus HST", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(),
    dwellingType: "Townhouse",
    beds: 3,
    baths: 2,
    packageKey: "complete_deep",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 460);
  assert.equal(quote.taxAmount, 59.8);
  assert.equal(quote.total, 519.8);
  assert.equal(quote.taxName, "HST");
  assert.equal(quote.governance.version, "ON-2026-08-v1.1");
});

test("Kitchen & Bath Refresh resolves 2.5 bathrooms at CA$250 with zero bedrooms", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(),
    dwellingType: "Detached House",
    beds: 0,
    baths: 2.5,
    packageKey: "kitchen_bath_refresh",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 250);
  assert.equal(quote.taxAmount, 32.5);
  assert.equal(quote.total, 282.5);
});

test("Kitchen & Bath Deep resolves 2.5 bathrooms at CA$330 and bundles only fridge and oven", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(),
    dwellingType: "Detached House",
    beds: 0,
    baths: 2.5,
    packageKey: "kitchen_bath_deep",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 330);
  assert.equal(quote.taxAmount, 42.9);
  assert.equal(quote.total, 372.9);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_refrigerator", businessUnitCode: "HUC-ON" }), true);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_oven", businessUnitCode: "HUC-ON" }), true);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_kitchen_cabinets", businessUnitCode: "HUC-ON" }), false);
  assert.deepEqual(
    removeBundledAddonsForPackage({ packageKey: "kitchen_bath_deep", businessUnitCode: "HUC-ON", addons: ["inside_refrigerator", "inside_oven", "inside_kitchen_cabinets"] }),
    ["inside_kitchen_cabinets"],
  );
});

test("unmapped residential matrix combination routes to explicit management review rather than throwing", () => {
  const result = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(),
    dwellingType: "Townhouse",
    beds: 8,
    baths: 7,
    packageKey: "complete_deep",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(result.requiresOfficeReview, true);
  assert.match(result.reason, /Requires Management Review \/ Custom Pricing/);
  assert.match(result.reason, /not mapped in the published residential pricing matrix/i);
});

test("Arizona normal residential resolver remains intact and Kitchen & Bath fails safe when unpublished", () => {
  const normal = computeGovernedResidentialQuote({
    configurationVersion: azConfig(),
    dwellingType: "Detached House",
    beds: 3,
    baths: 2,
    packageKey: "essential_refresh",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(normal.preTaxTotal, 180);
  assert.equal(normal.total, 180);

  const kitchenBath = computeGovernedResidentialQuote({
    configurationVersion: azConfig(),
    dwellingType: "Detached House",
    beds: 0,
    baths: 2.5,
    packageKey: "kitchen_bath_refresh",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: {},
  });
  assert.equal(kitchenBath.requiresOfficeReview, true);
  assert.match(kitchenBath.reason, /not mapped in the published regional pricing configuration/i);
});

test("Complete Deep disables Ontario fridge, oven, and kitchen cabinets but not pet hair", () => {
  for (const addonId of ["inside_refrigerator", "inside_oven", "inside_kitchen_cabinets"]) {
    assert.equal(isAddonBundledForPackage({ packageKey: "complete_deep", addonId, businessUnitCode: "HUC-ON" }), true);
  }
  assert.equal(isAddonBundledForPackage({ packageKey: "complete_deep", addonId: "pet_hair_removal", businessUnitCode: "HUC-ON" }), false);
  assert.deepEqual(
    removeBundledAddonsForPackage({
      packageKey: "complete_deep",
      businessUnitCode: "HUC-ON",
      addons: ["inside_refrigerator", "inside_oven", "inside_kitchen_cabinets", "pet_hair_removal"],
    }),
    ["pet_hair_removal"],
  );
});

test("Kitchen & Bath services are wired into New Quote, Saved Lead, and Quote Revision", () => {
  const nativeSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSRevenueWorkspace.jsx", import.meta.url), "utf8");
  const continuationSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", import.meta.url), "utf8");
  const revisionSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSQuoteRevisionPanel.jsx", import.meta.url), "utf8");
  for (const source of [nativeSource, continuationSource, revisionSource]) {
    assert.match(source, /kitchen_bath_refresh/);
    assert.match(source, /Kitchen & Bath Refresh Clean/);
    assert.match(source, /kitchen_bath_deep/);
    assert.match(source, /Kitchen & Bath Deep Clean/);
  }
  for (const source of [nativeSource, continuationSource]) {
    assert.match(source, /Bedrooms \(not used for Kitchen & Bath\)/);
    assert.match(source, /!kitchenBathPackage && !form\.beds/);
  }
});

test("Deep add-on protection is wired into native, saved-lead, and revision quote forms", () => {
  const nativeSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSRevenueWorkspace.jsx", import.meta.url), "utf8");
  const continuationSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", import.meta.url), "utf8");
  const revisionSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSQuoteRevisionPanel.jsx", import.meta.url), "utf8");
  for (const source of [nativeSource, continuationSource, revisionSource]) {
    assert.match(source, /isAddonBundledForPackage/);
    assert.match(source, /disabled=\{bundled\}/);
    assert.match(source, /— Included/);
  }
  for (const source of [nativeSource, continuationSource]) assert.match(source, /removeBundledAddonsForPackage/);
  assert.match(revisionSource, /removeBundledAddonsForPackage/);
});

test("Ontario v1.1 migration preserves v1.0 and publishes the derived 3/2 townhouse bridge row", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260828162500_goal5_ontario_pricing_coverage_v11.sql", import.meta.url), "utf8");
  assert.match(sql, /ON-2026-08-v1\.0/);
  assert.match(sql, /ON-2026-08-v1\.1/);
  assert.match(sql, /3bed_2bath/);
  assert.match(sql, /'complete_deep', 460/);
  assert.match(sql, /'essential_refresh', 260/);
  assert.match(sql, /owner_approved_midpoint_bridge_from_adjacent_3bed_townhouse_rows/);
  assert.match(sql, /not exists/);
});
