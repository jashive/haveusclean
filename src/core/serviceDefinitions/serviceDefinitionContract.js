export const SERVICE_MEASUREMENT_TYPES = Object.freeze([
  "unit_count",
  "area_sqft_acre",
  "linear_dimension",
  "flat_walkthrough",
]);

const EVIDENCE_TYPES = new Set([
  "photo_before",
  "photo_after",
  "photo_detail",
  "note",
  "signature",
  "timestamp",
  "other",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function key(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) throw new Error(`${label} must be a snake_case key`);
  return normalized;
}

function finite(value, label, { minimum = -Infinity } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum) throw new Error(`${label} must be a finite number >= ${minimum}`);
  return normalized;
}

export function validateMeasurementContract(contract) {
  const source = object(contract, "measurement_contract");
  if (!SERVICE_MEASUREMENT_TYPES.includes(source.primary_type)) throw new Error("measurement_contract.primary_type is unsupported");
  if (!Array.isArray(source.measurements) || source.measurements.length === 0) throw new Error("measurement_contract.measurements must not be empty");
  const seen = new Set();
  const measurements = source.measurements.map((measurement, index) => {
    const item = object(measurement, `measurement_contract.measurements[${index}]`);
    const itemKey = key(item.key, `measurement_contract.measurements[${index}].key`);
    if (seen.has(itemKey)) throw new Error(`Duplicate measurement key: ${itemKey}`);
    seen.add(itemKey);
    if (!SERVICE_MEASUREMENT_TYPES.includes(item.type)) throw new Error(`Unsupported measurement type: ${item.type}`);
    if (!String(item.label || "").trim()) throw new Error(`Measurement ${itemKey} requires a label`);
    return { ...item, key: itemKey, required: item.required === true };
  });
  return { ...source, contract_version: Number(source.contract_version || 1), measurements };
}

export function normalizeChecklistContract(contract) {
  const source = object(contract, "checklist_contract");
  if (!Array.isArray(source.sections) || source.sections.length === 0) throw new Error("checklist_contract.sections must not be empty");
  const keys = new Set();
  const sections = source.sections.map((section, sectionIndex) => {
    const value = object(section, `checklist_contract.sections[${sectionIndex}]`);
    const sectionKey = key(value.key, `checklist_contract.sections[${sectionIndex}].key`);
    if (!Array.isArray(value.items) || value.items.length === 0) throw new Error(`Checklist section ${sectionKey} must contain items`);
    const items = value.items.map((item, itemIndex) => {
      const task = object(item, `checklist item ${sectionKey}[${itemIndex}]`);
      const taskKey = key(task.key, `checklist item ${sectionKey}[${itemIndex}].key`);
      if (keys.has(taskKey)) throw new Error(`Duplicate checklist item key: ${taskKey}`);
      keys.add(taskKey);
      if (!String(task.label || "").trim()) throw new Error(`Checklist item ${taskKey} requires a label`);
      return { ...task, key: taskKey, label: String(task.label).trim(), required: task.required !== false, section_key: sectionKey };
    });
    return { ...value, key: sectionKey, label: String(value.label || sectionKey), items };
  });
  return { ...source, version: Number(source.version || 1), sections };
}

export function normalizeEvidenceContract(contract) {
  const source = object(contract, "qa_evidence_contract");
  if (!Array.isArray(source.requirements) || source.requirements.length === 0) throw new Error("qa_evidence_contract.requirements must not be empty");
  const seen = new Set();
  const requirements = source.requirements.map((requirement, index) => {
    const item = object(requirement, `qa_evidence_contract.requirements[${index}]`);
    const requirementKey = key(item.requirement_key, `evidence requirement ${index}.requirement_key`);
    if (seen.has(requirementKey)) throw new Error(`Duplicate evidence requirement key: ${requirementKey}`);
    seen.add(requirementKey);
    if (!EVIDENCE_TYPES.has(item.evidence_type)) throw new Error(`Unsupported evidence type: ${item.evidence_type}`);
    const evidenceTag = key(item.evidence_tag, `evidence requirement ${requirementKey}.evidence_tag`);
    return {
      ...item,
      requirement_key: requirementKey,
      evidence_tag: evidenceTag,
      label: String(item.label || evidenceTag).trim(),
      required_count: finite(item.required_count ?? 1, `evidence requirement ${requirementKey}.required_count`, { minimum: 1 }),
      mandatory: item.mandatory !== false,
    };
  });
  return { ...source, version: Number(source.version || 1), requirements };
}

export function validateServiceDefinitionVersion(contract) {
  const source = object(contract, "service_definition_version");
  return {
    ...source,
    measurement_contract: validateMeasurementContract(source.measurement_contract),
    pricing_contract: object(source.pricing_contract, "pricing_contract"),
    duration_contract: object(source.duration_contract, "duration_contract"),
    dispatch_contract: object(source.dispatch_contract, "dispatch_contract"),
    checklist_contract: normalizeChecklistContract(source.checklist_contract),
    qa_evidence_contract: normalizeEvidenceContract(source.qa_evidence_contract),
  };
}

function readPath(context, path) {
  return String(path || "").split(".").filter(Boolean).reduce((value, segment) => value?.[segment], context);
}

function evaluateInput(input, context) {
  if (typeof input === "number") return input;
  const term = object(input, "formula input");
  const raw = term.value ?? readPath(context, term.source);
  const numeric = finite(raw ?? 0, `formula source ${term.source || "value"}`);
  return numeric * Number(term.multiply ?? 1) + Number(term.add ?? 0);
}

export function evaluateDeclarativeFormula(formula, context = {}) {
  const source = object(formula, "formula");
  if (!Array.isArray(source.inputs)) throw new Error("formula.inputs must be an array");
  const values = source.inputs.map((input) => evaluateInput(input, context));
  if (source.operator === "sum") return values.reduce((total, value) => total + value, 0);
  if (source.operator === "max") return Math.max(...values);
  if (source.operator === "min") return Math.min(...values);
  throw new Error(`Unsupported formula operator: ${source.operator}`);
}

export function evaluatePricingContract(contract, context = {}) {
  const source = object(contract, "pricing_contract");
  if (source.mode === "existing_pricing_configuration") return { mode: source.mode, configuration_version_id: source.configuration_version_id };
  if (source.mode !== "formula") throw new Error(`Unsupported pricing mode: ${source.mode}`);
  const calculated = evaluateDeclarativeFormula(source.formula, context);
  const subtotal = Math.max(Number(source.minimum_charge || 0), calculated);
  return { mode: source.mode, subtotal_amount: Math.round(subtotal * 100) / 100 };
}

export function evaluateDurationContract(contract, context = {}) {
  const source = object(contract, "duration_contract");
  if (source.mode === "existing_pricing_outputs") return { mode: source.mode };
  if (source.mode !== "formula") throw new Error(`Unsupported duration mode: ${source.mode}`);
  const calculated = evaluateDeclarativeFormula(source.formula, context);
  const minimum = Math.max(Number(source.minimum_minutes || 0), calculated);
  const increment = Math.max(1, Number(source.rounding_minutes || 1));
  return { mode: source.mode, estimated_minutes: Math.ceil(minimum / increment) * increment };
}

export function evaluateDispatchConstraints(contract, worker = {}, requestedCrewSize = 1) {
  const source = object(contract, "dispatch_contract");
  const crewSize = finite(requestedCrewSize, "requested crew size", { minimum: 1 });
  const minimum = Number(source.minimum_crew_size || 1);
  const maximum = Number(source.maximum_crew_size || minimum);
  const capabilities = new Set(Array.isArray(worker.capabilities) ? worker.capabilities : []);
  const equipment = new Set(Array.isArray(worker.equipment) ? worker.equipment : []);
  const missingCapabilities = (source.required_capabilities || []).filter((item) => !capabilities.has(item));
  const missingEquipment = (source.required_equipment || []).filter((item) => !equipment.has(item));
  return {
    eligible: crewSize >= minimum && crewSize <= maximum && missingCapabilities.length === 0 && missingEquipment.length === 0,
    crew_size_valid: crewSize >= minimum && crewSize <= maximum,
    missing_capabilities: missingCapabilities,
    missing_equipment: missingEquipment,
  };
}

export function flattenChecklistItems(contract) {
  return normalizeChecklistContract(contract).sections.flatMap((section) => section.items);
}

export function resolveServiceDefinitionVersion(rows, { serviceKey, businessUnitId, jurisdictionId, at = new Date() }) {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) throw new Error("Service definition resolution date is invalid");
  const eligible = (Array.isArray(rows) ? rows : []).filter((row) => {
    const configuration = row.configuration_version || row.configuration || {};
    const effectiveFrom = configuration.effective_from ? new Date(configuration.effective_from) : null;
    const effectiveTo = configuration.effective_to ? new Date(configuration.effective_to) : null;
    return row.service_key === serviceKey
      && row.business_unit_id === businessUnitId
      && (!row.jurisdiction_id || row.jurisdiction_id === jurisdictionId)
      && configuration.status === "published"
      && (!effectiveFrom || effectiveFrom <= instant)
      && (!effectiveTo || effectiveTo > instant);
  }).sort((left, right) => new Date(right.configuration_version?.effective_from || 0) - new Date(left.configuration_version?.effective_from || 0));
  if (eligible.length !== 1) throw new Error(`Expected exactly one effective published service definition for ${serviceKey}; found ${eligible.length}`);
  return validateServiceDefinitionVersion(eligible[0]);
}

export function adaptLegacyResidentialScope(scope = {}) {
  const beds = Number(scope.beds ?? scope.bedrooms ?? 0);
  const bathrooms = Number(scope.baths ?? scope.bathrooms ?? 0);
  const sqftValue = scope.sqft ?? scope.squareFeet ?? scope.square_feet;
  const sqft = sqftValue === null || sqftValue === undefined || sqftValue === "" ? null : Number(sqftValue);
  return {
    ...scope,
    service_definition_key: "residential_cleaning",
    measurement_contract_type: "unit_count",
    measurements: {
      bedrooms: Number.isFinite(beds) ? beds : 0,
      bathrooms: Number.isFinite(bathrooms) ? bathrooms : 0,
      ...(Number.isFinite(sqft) && sqft > 0 ? { service_area: { value: sqft, unit: "sqft" } } : {}),
    },
  };
}

export const RESIDENTIAL_CHECKLIST_CONTRACT = Object.freeze({
  version: 1,
  sections: [
    { key: "arrival", label: "Arrival and scope", items: [
      { key: "review_scope", label: "Review scope and access notes", required: true },
    ] },
    { key: "service", label: "Service execution", items: [
      { key: "complete_service_scope", label: "Complete every configured service-area task", required: true },
      { key: "final_quality_walkthrough", label: "Complete the final quality walkthrough", required: true },
    ] },
    { key: "evidence", label: "Completion evidence", items: [
      { key: "upload_completion_evidence", label: "Upload all required completion evidence", required: true },
    ] },
  ],
});

export const RESIDENTIAL_EVIDENCE_CONTRACT = Object.freeze({
  version: 1,
  requirements: [
    { requirement_key: "service_after", evidence_type: "photo_after", evidence_tag: "after_clean", label: "Completed service", required_count: 1, mandatory: true },
  ],
});

export function residentialDefinitionSnapshot(scope = {}, configurationVersionId = null) {
  return {
    service_definition_key: "residential_cleaning",
    configuration_version_id: configurationVersionId,
    measurement_contract: {
      contract_version: 1,
      primary_type: "unit_count",
      measurements: [
        { key: "bedrooms", type: "unit_count", label: "Bedrooms", required: true },
        { key: "bathrooms", type: "unit_count", label: "Bathrooms", required: true },
        { key: "service_area", type: "area_sqft_acre", label: "Service area", accepted_units: ["sqft"], required: false },
      ],
    },
    scope: adaptLegacyResidentialScope(scope),
    checklist_contract: RESIDENTIAL_CHECKLIST_CONTRACT,
    qa_evidence_contract: RESIDENTIAL_EVIDENCE_CONTRACT,
  };
}
