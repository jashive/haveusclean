import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SERVICE_MEASUREMENT_TYPES, RESIDENTIAL_CHECKLIST_CONTRACT, RESIDENTIAL_EVIDENCE_CONTRACT,
  adaptLegacyResidentialScope, evaluateDeclarativeFormula, evaluateDispatchConstraints,
  evaluateDurationContract, evaluatePricingContract, flattenChecklistItems,
  normalizeEvidenceContract, resolveServiceDefinitionVersion,
  validateMeasurementContract, validateServiceDefinitionVersion,
} from "../src/core/serviceDefinitions/serviceDefinitionContract.js";
import { buildDispatchCascade } from "../src/lib/serviceosDispatchCascade.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260908210000_generic_service_definition_engine.sql", import.meta.url), "utf8");
const coverageMigration = fs.readFileSync(new URL("../supabase/migrations/20260908211500_phase5_residential_definition_coverage.sql", import.meta.url), "utf8");
const operations = fs.readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
const operationsClient = fs.readFileSync(new URL("../src/lib/serviceosOperationsClient.js", import.meta.url), "utf8");
const technician = fs.readFileSync(new URL("../src/features/wave3/TechnicianExecutionCard.jsx", import.meta.url), "utf8");
const evidence = fs.readFileSync(new URL("../src/lib/serviceosMobileEvidence.js", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function definition(overrides = {}) {
  return {
    id: "sdv-1", service_key: "landscape_maintenance", business_unit_id: "bu-1", jurisdiction_id: "jur-1",
    configuration_version: { status: "published", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
    measurement_contract: { contract_version: 1, primary_type: "area_sqft_acre", measurements: [{ key: "turf_area", type: "area_sqft_acre", label: "Turf area", required: true }] },
    pricing_contract: { mode: "formula", minimum_charge: 100, formula: { operator: "sum", inputs: [{ source: "measurements.turf_area", multiply: 0.1 }] } },
    duration_contract: { mode: "formula", minimum_minutes: 30, rounding_minutes: 15, formula: { operator: "sum", inputs: [{ source: "measurements.turf_area", multiply: 0.02 }] } },
    dispatch_contract: { minimum_crew_size: 1, maximum_crew_size: 2, required_capabilities: ["landscape_maintenance"], required_equipment: ["mower"] },
    checklist_contract: { version: 1, sections: [{ key: "grounds", label: "Grounds", items: [{ key: "cut_perimeter", label: "Cut perimeter", required: true }] }] },
    qa_evidence_contract: { version: 1, requirements: [{ requirement_key: "perimeter_complete", evidence_type: "photo_after", evidence_tag: "perimeter_cut", required_count: 2, mandatory: true }] },
    ...overrides,
  };
}

test("contract exposes exactly four universal measurement types", () => assert.deepEqual(SERVICE_MEASUREMENT_TYPES, ["unit_count", "area_sqft_acre", "linear_dimension", "flat_walkthrough"]));
for (const type of SERVICE_MEASUREMENT_TYPES) test(`${type} measurement validates deterministically`, () => assert.equal(validateMeasurementContract({ primary_type: type, measurements: [{ key: "scope_value", type, label: "Scope value", required: true }] }).primary_type, type));
test("unknown measurement types fail closed", () => assert.throws(() => validateMeasurementContract({ primary_type: "landscaping", measurements: [{ key: "yards", type: "landscaping", label: "Yards" }] }), /unsupported/i));
test("duplicate measurement keys fail closed", () => assert.throws(() => validateMeasurementContract({ primary_type: "unit_count", measurements: [{ key: "rooms", type: "unit_count", label: "Rooms" }, { key: "rooms", type: "unit_count", label: "Rooms again" }] }), /duplicate/i));
test("multi-trade definition validates checklist and evidence contracts", () => { const result = validateServiceDefinitionVersion(definition()); assert.equal(result.checklist_contract.sections[0].items[0].key, "cut_perimeter"); assert.equal(result.qa_evidence_contract.requirements[0].evidence_tag, "perimeter_cut"); });
test("checklist sections flatten into stable keyed tasks", () => assert.deepEqual(flattenChecklistItems(RESIDENTIAL_CHECKLIST_CONTRACT).map((item) => item.key), ["review_scope", "complete_service_scope", "final_quality_walkthrough", "upload_completion_evidence"]));
test("trade evidence tags remain separate from canonical evidence types", () => { const policy = normalizeEvidenceContract(definition().qa_evidence_contract).requirements[0]; assert.equal(policy.evidence_type, "photo_after"); assert.equal(policy.evidence_tag, "perimeter_cut"); });
test("declarative formula resolves only supported operators", () => { assert.equal(evaluateDeclarativeFormula({ operator: "sum", inputs: [10, { source: "units", multiply: 3 }] }, { units: 4 }), 22); assert.throws(() => evaluateDeclarativeFormula({ operator: "script", inputs: [] }), /unsupported/i); });
test("pricing formulas honor governed minimums", () => assert.deepEqual(evaluatePricingContract(definition().pricing_contract, { measurements: { turf_area: 500 } }), { mode: "formula", subtotal_amount: 100 }));
test("duration formulas round upward deterministically", () => assert.deepEqual(evaluateDurationContract(definition().duration_contract, { measurements: { turf_area: 2300 } }), { mode: "formula", estimated_minutes: 60 }));
test("dispatch constraints identify missing requirements", () => { const result = evaluateDispatchConstraints(definition().dispatch_contract, { capabilities: [], equipment: [] }, 1); assert.equal(result.eligible, false); assert.deepEqual(result.missing_capabilities, ["landscape_maintenance"]); assert.deepEqual(result.missing_equipment, ["mower"]); });
test("dispatch constraints approve a compatible field worker", () => assert.equal(evaluateDispatchConstraints(definition().dispatch_contract, { capabilities: ["landscape_maintenance"], equipment: ["mower"] }, 2).eligible, true));
test("resolver returns the sole effective published territory version", () => assert.equal(resolveServiceDefinitionVersion([definition()], { serviceKey: "landscape_maintenance", businessUnitId: "bu-1", jurisdictionId: "jur-1", at: "2026-09-08T00:00:00Z" }).id, "sdv-1"));
test("resolver rejects drafts and ambiguous published versions", () => { assert.throws(() => resolveServiceDefinitionVersion([definition({ configuration_version: { status: "draft" } })], { serviceKey: "landscape_maintenance", businessUnitId: "bu-1", jurisdictionId: "jur-1" }), /found 0/); assert.throws(() => resolveServiceDefinitionVersion([definition(), definition({ id: "sdv-2" })], { serviceKey: "landscape_maintenance", businessUnitId: "bu-1", jurisdictionId: "jur-1" }), /found 2/); });
test("legacy residential scope maps to unit-count measurements without dropping fields", () => { const result = adaptLegacyResidentialScope({ packageKey: "essential_refresh", beds: 3, baths: 2.5, sqft: 1600 }); assert.equal(result.packageKey, "essential_refresh"); assert.equal(result.measurement_contract_type, "unit_count"); assert.deepEqual(result.measurements, { bedrooms: 3, bathrooms: 2.5, service_area: { value: 1600, unit: "sqft" } }); });
test("dispatch cascade freezes residential definition and evidence compatibility", () => { const cascade = buildDispatchCascade({ requirements: { scope: { packageKey: "essential_refresh", beds: 2, bathrooms: 1, sqft: 900 } }, pricingSnapshot: { configuration_version_id: "cfg-1" } }); assert.equal(cascade.scope.service_definition_key, "residential_cleaning"); assert.equal(cascade.serviceDefinition.configuration_version_id, "cfg-1"); assert.equal(cascade.checklist.sections.length, 3); assert.deepEqual(cascade.evidenceRequirements, RESIDENTIAL_EVIDENCE_CONTRACT.requirements); });
test("migration is additive, RLS protected, immutable, and avoids financial ledgers", () => { assert.match(migration, /create table public\.service_definition\b/i); assert.match(migration, /create table public\.service_definition_version\b/i); assert.match(migration, /enable row level security/i); assert.match(migration, /Published service definition versions are immutable/i); assert.doesNotMatch(migration, /(insert into|update|alter table|delete from) public\.(contractor_payable|job_profitability_snapshot|payable_settlement_event)\b/i); });
test("Phase 5 covers every accepted published residential configuration without rewriting snapshots", () => { assert.match(coverageMigration, /join public\.pricing_snapshot ps on ps\.id=jh\.pricing_snapshot_id/i); assert.match(coverageMigration, /configuration_type='residential_pricing'/i); assert.match(coverageMigration, /on conflict \(configuration_version_id\) do nothing/i); assert.doesNotMatch(coverageMigration, /(update|delete from) public\.(pricing_snapshot|job_handoff|contractor_payable|job_profitability_snapshot)\b/i); });
test("dispatch materializes frozen governance before work-order publication", () => { assert.match(operations, /materializeWave4Governance/); assert.ok(operations.indexOf("materializeWave4Governance({") < operations.indexOf('updateWorkOrderStatus(workOrder.id, "published"')); assert.match(operations, /qa_evidence_contract: definition\.qa_evidence_contract/); });
test("dispatch resolves the parent service identity and evaluates its declarative constraints", () => { assert.match(operationsClient, /fetchOneById\("service_definition", rows\[0\]\.service_definition_id/); assert.match(operations, /evaluateDispatchConstraints\(\s*definition\.dispatch_contract/); assert.match(operations, /missing_capabilities/); assert.match(operations, /missing_equipment/); });
test("technician checklist and uploader bind configured keys and evidence tags", () => { assert.match(technician, /task\.key/); assert.match(technician, /data-evidence-tag/); assert.match(evidence, /requirement_key: entry\.requirement/); assert.match(evidence, /evidence_tag: entry\.requirement/); });
test("Phase 4 adds no serverless function and is registered", () => { const apiFiles = fs.readdirSync(new URL("../api", import.meta.url), { recursive: true }).filter((name) => name.endsWith(".js")); assert.equal(apiFiles.length, 12); assert.match(packageJson.scripts.test, /serviceosGenericServiceDefinition\.test\.mjs/); });
