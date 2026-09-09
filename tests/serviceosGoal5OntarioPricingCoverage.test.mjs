import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { computeGovernedResidentialQuote } from "../src/lib/governedResidentialPricing.js";
import {
  getDefaultApprovedSelections,
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

function onV13CalibrationConfig() {
  return {
    id: "cfg-on-v13",
    organization_id: "org",
    business_unit_id: "bu-on",
    jurisdiction_id: "jur-on",
    configuration_type: "residential_pricing",
    version: "ON-2026-08-v1.3",
    status: "published",
    configuration: {
      business_unit_code: "HUC-ON",
      jurisdiction_code: "CA-ON",
      currency_code: "CAD",
      tax: { label: "HST", rate: 0.13 },
      minimum_charge: { general_residential: 200 },
      dwelling_matrix: {
        semi_detached_detached: {
          "4bed_3_5bath": { essential_refresh: 350, signature_initial_reset: 475, complete_deep: 595, move_in_move_out: 450 },
        },
      },
      packages: {},
      premium_addons: {},
      recurring_service: {
        biweekly_discount: { min: 0.05, max: 0.10, preferred: 0.10 },
      },
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

test("Ontario live market resolves owner-calibrated pricing version v1.3", () => {
  assert.equal(getGovernedResidentialRequiredVersion("HUC-ON"), "ON-2026-08-v1.3");
});

test("owner-calibrated compact 4 bed / 3.5 bath detached Refresh is CA$350 plus HST", () => {
  const config = onV13CalibrationConfig();
  const quote = computeGovernedResidentialQuote({
    configurationVersion: config,
    dwellingType: "Detached House",
    beds: 4,
    baths: 3.5,
    packageKey: "essential_refresh",
    condition: "light",
    frequency: "one_time",
    addons: [],
    approvedSelections: getDefaultApprovedSelections(config, { condition: "light", frequency: "one_time", sqft: 2000, sqftBand: "" }),
  });
  assert.equal(quote.preTaxTotal, 350);
  assert.equal(quote.taxAmount, 45.5);
  assert.equal(quote.total, 395.5);
});

test("Ontario preferred biweekly discount is 10 percent when published", () => {
  const config = onV13CalibrationConfig();
  const approvedSelections = getDefaultApprovedSelections(config, { condition: "light", frequency: "biweekly", sqft: 2000, sqftBand: "" });
  assert.equal(approvedSelections.recurringDiscountPct, 0.10);
  const quote = computeGovernedResidentialQuote({
    configurationVersion: config,
    dwellingType: "Detached House",
    beds: 4,
    baths: 3.5,
    packageKey: "essential_refresh",
    condition: "light",
    frequency: "biweekly",
    addons: [],
    approvedSelections,
  });
  assert.equal(quote.preTaxTotal, 315);
  assert.equal(quote.taxAmount, 40.95);
  assert.equal(quote.total, 355.95);
});

test("Ontario v1.1 townhouse 3 bed / 2 bath Complete Deep is CA$460 plus HST", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(), dwellingType: "Townhouse", beds: 3, baths: 2,
    packageKey: "complete_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 460);
  assert.equal(quote.taxAmount, 59.8);
  assert.equal(quote.total, 519.8);
  assert.equal(quote.taxName, "HST");
});

test("Kitchen & Bath Refresh resolves 2.5 bathrooms at CA$250 with zero bedrooms", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(), dwellingType: "Detached House", beds: 0, baths: 2.5,
    packageKey: "kitchen_bath_refresh", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 250);
  assert.equal(quote.taxAmount, 32.5);
  assert.equal(quote.total, 282.5);
});

test("Kitchen & Bath Deep resolves 2.5 bathrooms at CA$330 and bundles only fridge and oven", () => {
  const quote = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(), dwellingType: "Detached House", beds: 0, baths: 2.5,
    packageKey: "kitchen_bath_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(quote.preTaxTotal, 330);
  assert.equal(quote.total, 372.9);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_refrigerator", businessUnitCode: "HUC-ON" }), true);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_oven", businessUnitCode: "HUC-ON" }), true);
  assert.equal(isAddonBundledForPackage({ packageKey: "kitchen_bath_deep", addonId: "inside_kitchen_cabinets", businessUnitCode: "HUC-ON" }), false);
});

test("unmapped residential matrix combination routes to explicit management review rather than throwing", () => {
  const result = computeGovernedResidentialQuote({
    configurationVersion: onV11Config(), dwellingType: "Townhouse", beds: 8, baths: 7,
    packageKey: "complete_deep", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(result.requiresOfficeReview, true);
  assert.match(result.reason, /Requires Management Review \/ Custom Pricing/);
});

test("Arizona normal residential resolver remains intact and Kitchen & Bath fails safe when unpublished", () => {
  const normal = computeGovernedResidentialQuote({
    configurationVersion: azConfig(), dwellingType: "Detached House", beds: 3, baths: 2,
    packageKey: "essential_refresh", condition: "light", frequency: "one_time", addons: [], approvedSelections: {},
  });
  assert.equal(normal.preTaxTotal, 180);
  assert.equal(normal.total, 180);
});

test("Complete Deep disables Ontario fridge, oven, and kitchen cabinets but not pet hair", () => {
  for (const addonId of ["inside_refrigerator", "inside_oven", "inside_kitchen_cabinets"]) {
    assert.equal(isAddonBundledForPackage({ packageKey: "complete_deep", addonId, businessUnitCode: "HUC-ON" }), true);
  }
  assert.equal(isAddonBundledForPackage({ packageKey: "complete_deep", addonId: "pet_hair_removal", businessUnitCode: "HUC-ON" }), false);
  assert.deepEqual(removeBundledAddonsForPackage({ packageKey: "complete_deep", businessUnitCode: "HUC-ON", addons: ["inside_refrigerator", "inside_oven", "inside_kitchen_cabinets", "pet_hair_removal"] }), ["pet_hair_removal"]);
});

test("Ontario v1.3 migration preserves v1.2 and records closed-quote calibration rules", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260909233000_goal5_on_quote_calibration_v13.sql", import.meta.url), "utf8");
  assert.match(sql, /ON-2026-08-v1\.2/);
  assert.match(sql, /ON-2026-08-v1\.3/);
  assert.match(sql, /4bed_3_5bath,essential_refresh/);
  assert.match(sql, /to_jsonb\(350\)/);
  assert.match(sql, /'preferred', 0\.10/);
  assert.match(sql, /scope_drives_package_not_customer_label/);
  assert.match(sql, /specialty_carpet_shampooing_is_separate_from_normal_vacuuming/);
  assert.match(sql, /do_not_reduce_price_without_reducing_scope/);
});
