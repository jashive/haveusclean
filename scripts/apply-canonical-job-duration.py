from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected patch anchor not found in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


replace(
    "src/lib/serviceosOfficeQuoteUtils.js",
    'const HAZARD_PATTERNS = [',
    'import { getJobHours, getTeamSize } from "../core/pricing/sharedPricing.js";\n\nconst HAZARD_PATTERNS = ['
)
replace(
    "src/lib/serviceosOfficeQuoteUtils.js",
    'export function getDefaultApprovedSelections(configurationVersion, { condition, frequency, sqftBand }) {',
    'export function getDefaultApprovedSelections(configurationVersion, { condition, frequency, sqftBand, sqft }) {'
)
replace(
    "src/lib/serviceosOfficeQuoteUtils.js",
    '  const approved = {};\n\n  if (normalizedCondition === "moderate")',
    '  const approved = {};\n  const exactSqft = Number(sqft);\n  if (Number.isFinite(exactSqft) && exactSqft > 0) {\n    approved.teamSize = getTeamSize(exactSqft);\n    approved.jobHours = getJobHours(exactSqft);\n    approved.laborSource = "pricing_calculator_exact_sqft";\n  }\n\n  if (normalizedCondition === "moderate")'
)

replace(
    "src/features/wave1/ServiceOSRevenueWorkspace.jsx",
    'const approvedSelections = getDefaultApprovedSelections(config, { condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand });',
    'const approvedSelections = getDefaultApprovedSelections(config, { condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand, sqft: form.sqft ? Number(form.sqft) : null });'
)

replace(
    "src/lib/governedResidentialPricing.js",
    '  const total = toMoney(subtotal + taxAmount);\n\n  return {',
    '  const total = toMoney(subtotal + taxAmount);\n  const selectedTeamSize = Number(approvedSelections.teamSize);\n  const selectedJobHours = Number(approvedSelections.jobHours);\n  const teamSize = Number.isInteger(selectedTeamSize) && selectedTeamSize > 0 ? selectedTeamSize : null;\n  const jobHours = Number.isFinite(selectedJobHours) && selectedJobHours > 0 ? selectedJobHours : null;\n\n  return {'
)
replace(
    "src/lib/governedResidentialPricing.js",
    '    teamSize: null,\n    jobHours: null,',
    '    teamSize,\n    jobHours,'
)
replace(
    "src/lib/governedResidentialPricing.js",
    '      configurationVersionId: configurationVersion.id ?? null,\n    },',
    '      configurationVersionId: configurationVersion.id ?? null,\n      laborSource: jobHours && teamSize ? (approvedSelections.laborSource || "pricing_calculator") : null,\n    },'
)

Path("tests/serviceosCanonicalJobDuration.test.mjs").write_text(r'''import test from "node:test";
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

test("Wave 3 dispatch consumes canonical pricing duration and computes END", () => {
  const source = fs.readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /pricingSnapshot\?\.labor_economics\?\.jobHours/);
  assert.match(source, /setEnd\(duration \? addHoursToLocalDateTime\(requested, duration\) : ""\)/);
  assert.match(source, /function addHoursToLocalDateTime\(localValue, hours\)/);
});
''')

pkg = Path("package.json")
pkg_text = pkg.read_text()
anchor = 'tests/serviceosWave3WorkerNotificationDelivery.test.mjs tests/serviceosWave4ProductionBoundary.test.mjs'
replacement = 'tests/serviceosWave3WorkerNotificationDelivery.test.mjs tests/serviceosCanonicalJobDuration.test.mjs tests/serviceosWave4ProductionBoundary.test.mjs'
if anchor not in pkg_text:
    raise SystemExit("package.json test anchor not found")
pkg.write_text(pkg_text.replace(anchor, replacement, 1))

Path(".github/workflows/canonical-job-duration-apply.yml").unlink(missing_ok=True)
Path("scripts/apply-canonical-job-duration.py").unlink(missing_ok=True)
