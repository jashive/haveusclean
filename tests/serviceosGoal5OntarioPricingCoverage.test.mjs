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

test("Complete Deep add-on protection is wired into both native and saved-lead quote forms", () => {
  const nativeSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSRevenueWorkspace.jsx", import.meta.url), "utf8");
  const continuationSource = fs.readFileSync(new URL("../src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", import.meta.url), "utf8");
  for (const source of [nativeSource, continuationSource]) {
    assert.match(source, /isAddonBundledForPackage/);
    assert.match(source, /disabled=\{bundled\}/);
    assert.match(source, /— Included/);
    assert.match(source, /removeBundledAddonsForPackage/);
  }
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
