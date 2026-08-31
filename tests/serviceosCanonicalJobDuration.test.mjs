import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getDefaultApprovedSelections } from "../src/lib/serviceosOfficeQuoteUtils.js";
import { computeGovernedResidentialQuote } from "../src/lib/governedResidentialPricing.js";
import { capturePricingSnapshot } from "../src/lib/serviceosRevenueUtils.js";

const configurationVersion = {
  id: "cfg-duration-test",
  configuration_type: "residential_pricing",
  version: "TEST-1",
  business_unit_id: "bu-test",
  jurisdiction_id: "jur-test",
  configuration: {
    currency_code: "CAD",
    tax: { label: "HST", rate: 0.13 },
    minimum_charge: { general_residential: 200 },
    dwelling_matrix: {
      semi_detached_detached: {
        "4bed_3bath": { essential_refresh: 300 },
      },
    },
    recurring_service: {},
    condition_adjustments: { light: { minimum_markup: 0, maximum_markup: 0 } },
    urgency: {},
    square_footage_adjustments: {},
    premium_addons: {},
    packages: {},
  },
};

test("exact sqft produces canonical calculator crew size and duration", () => {
  const approvedSelections = getDefaultApprovedSelections(configurationVersion, {
    condition: "light",
    frequency: "one_time",
    sqftBand: "",
    sqft: 2800,
  });
  assert.equal(approvedSelections.teamSize, 2);
  assert.equal(approvedSelections.jobHours, 3);
  assert.equal(approvedSelections.laborSource, "pricing_calculator_exact_sqft");

  const quote = computeGovernedResidentialQuote({
    configurationVersion,
    dwellingType: "Detached House",
    beds: 4,
    baths: 3,
    packageKey: "essential_refresh",
    approvedSelections,
  });
  assert.equal(quote.teamSize, 2);
  assert.equal(quote.jobHours, 3);
  assert.equal(quote.governance.laborSource, "pricing_calculator_exact_sqft");

  const snapshot = capturePricingSnapshot({
    quote: { ...quote, input: { sqft: 2800 } },
    organizationId: "org-test",
    businessUnitId: "bu-test",
    configurationVersionId: configurationVersion.id,
    configurationSnapshot: configurationVersion.configuration,
    governedResidential: true,
  });
  assert.equal(snapshot.labor_economics.teamSize, 2);
  assert.equal(snapshot.labor_economics.jobHours, 3);
});

test("missing exact sqft does not invent duration or crew size", () => {
  const approvedSelections = getDefaultApprovedSelections(configurationVersion, {
    condition: "light",
    frequency: "one_time",
    sqftBand: "",
    sqft: null,
  });
  assert.equal(approvedSelections.teamSize, undefined);
  assert.equal(approvedSelections.jobHours, undefined);

  const quote = computeGovernedResidentialQuote({
    configurationVersion,
    dwellingType: "Detached House",
    beds: 4,
    baths: 3,
    packageKey: "essential_refresh",
    approvedSelections,
  });
  assert.equal(quote.teamSize, null);
  assert.equal(quote.jobHours, null);
});

test("all governed quote flows pass exact sqft into canonical labor calculation", () => {
  const partial = fs.readFileSync(new URL("../src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", import.meta.url), "utf8");
  const revision = fs.readFileSync(new URL("../src/features/wave1/ServiceOSQuoteRevisionPanel.jsx", import.meta.url), "utf8");
  assert.match(partial, /getDefaultApprovedSelections\(configurationVersion, \{[^}]*sqft: form\.sqft \? Number\(form\.sqft\) : null/);
  assert.match(revision, /getDefaultApprovedSelections\(configVersion, \{[^}]*sqft: sourceScope\.sqft \? Number\(sourceScope\.sqft\) : null/);
});

test("Wave 3 dispatch consumes canonical pricing duration and computes END", () => {
  const source = fs.readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /pricingSnapshot\?\.labor_economics\?\.jobHours/);
  assert.match(source, /setEnd\(duration \? addHoursToLocalDateTime\(requested, duration\) : ""\)/);
  assert.match(source, /function addHoursToLocalDateTime\(localValue, hours\)/);
});


test("operator UI surfaces canonical crew/duration without lifecycle clutter", () => {
  const operations = fs.readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
  const revenue = fs.readFileSync(new URL("../src/features/wave1/ServiceOSRevenueWorkspace.jsx", import.meta.url), "utf8");
  assert.match(operations, /Ready for Dispatch/);
  assert.match(operations, /return "Dispatched"/);
  assert.match(operations, /return "Completed"/);
  assert.match(operations, /return "Correction Required"/);
  assert.match(operations, /setEnd\(addHoursToLocalDateTime\(next,duration\)\)/);
  assert.match(operations, /crew_size: crewSize/);
  assert.match(operations, /data-wave3-dispatch-plan="true"/);
  assert.match(operations, /End auto-calculated/);
  assert.match(operations, /endAutoCalculated && end/);
  assert.match(operations, /setEndAutoCalculated\(false\)/);
  assert.match(revenue, /data-testid="serviceos-quote-labor-badges"/);
  assert.match(revenue, /Crew \{quote\.teamSize\}/);
});
