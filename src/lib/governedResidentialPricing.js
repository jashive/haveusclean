const SUPPORTED_PACKAGE_KEYS = new Set([
  "essential_refresh",
  "signature_initial_reset",
  "complete_deep",
  "move_in_move_out",
  "kitchen_bath_refresh",
  "kitchen_bath_deep",
]);

const KITCHEN_BATH_PACKAGE_KEYS = new Set(["kitchen_bath_refresh", "kitchen_bath_deep"]);
const KITCHEN_BATH_DEEP_INCLUDED_ADDONS = new Set(["inside_refrigerator", "inside_oven"]);

const ADDON_ALIASES = {
  fridge: "inside_refrigerator",
  refrigerator: "inside_refrigerator",
  inside_refrigerator: "inside_refrigerator",
  oven: "inside_oven",
  inside_oven: "inside_oven",
  cabinets: "inside_kitchen_cabinets",
  kitchen_cabinets: "inside_kitchen_cabinets",
  inside_kitchen_cabinets: "inside_kitchen_cabinets",
};
const DWELLING_TYPE_ALIASES = {
  apartments_condos: ["apartments_condos", "apartment_condo", "apartment", "condo"],
  townhouses: ["townhouses", "townhouse", "townhome"],
  semi_detached_detached: [
    "semi_detached_detached", "detached_house_semi_detached", "detached_semi_detached",
    "detached_house", "detached", "semi_detached", "semi_detached_house", "semi_detached_detached_house",
  ],
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMoney(value) {
  return Number((Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100).toFixed(2));
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeCondition(value) {
  const v = normalizeToken(value);
  if (!v) return "light";
  if (v === "average") return "moderate";
  return v;
}

function asRange(range, minKey = "min", maxKey = "max") {
  if (!range || typeof range !== "object") return null;
  const min = toNumber(range[minKey], Number.NaN);
  const max = toNumber(range[maxKey], Number.NaN);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min, max };
}

function valueInRange(selection, range) {
  const value = toNumber(selection, Number.NaN);
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function resolveRangeSelection(range, approvedValue, label) {
  if (!range || !valueInRange(approvedValue, range)) {
    return { requiresOfficeReview: true, reason: `${label} requires approved selection within published range` };
  }
  return { value: toNumber(approvedValue, 0) };
}

function normalizeFrequency(value) {
  const token = normalizeToken(value);
  if (token === "onetime" || token === "one_time" || token === "one_time_service") return "one_time";
  if (token === "weekly") return "weekly";
  if (token === "bi_weekly" || token === "biweekly") return "biweekly";
  if (token === "monthly") return "monthly";
  return token;
}

function buildBedBathKeyCandidates(beds, baths) {
  const bed = toNumber(beds, Number.NaN);
  const bath = toNumber(baths, Number.NaN);
  if (!Number.isFinite(bed) || !Number.isFinite(bath)) return [];
  const bedPart = Number.isInteger(bed) ? String(bed) : String(bed).replace(".", "_");
  const bathPart = Number.isInteger(bath) ? String(bath) : String(bath).replace(".", "_");
  return [`${bedPart}bed_${bathPart}bath`, `${bedPart}_bed_${bathPart}_bath`];
}

function buildKitchenBathKey(baths) {
  const bath = toNumber(baths, Number.NaN);
  if (!Number.isFinite(bath) || bath <= 0) return null;
  const bathPart = Number.isInteger(bath) ? String(bath) : String(bath).replace(".", "_");
  return `kitchen_${bathPart}bath`;
}

function findKitchenBathPrice(kitchenBathPackages, { baths, packageKey }) {
  if (!kitchenBathPackages || typeof kitchenBathPackages !== "object") return null;
  const rowKey = buildKitchenBathKey(baths);
  if (!rowKey) return null;
  const row = kitchenBathPackages[rowKey];
  if (!row || typeof row !== "object") return null;
  const priceKey = packageKey === "kitchen_bath_deep" ? "complete_deep" : "essential_refresh";
  const value = toNumber(row[priceKey], Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function resolveDwellingMatrixTypeKey(matrix, dwellingType) {
  const normalizedType = normalizeToken(dwellingType);
  const aliasEntry = Object.entries(DWELLING_TYPE_ALIASES).find(([, aliases]) => aliases.includes(normalizedType));
  const preferredKey = aliasEntry?.[0];
  if (preferredKey && Object.prototype.hasOwnProperty.call(matrix, preferredKey)) return preferredKey;
  const matchingEntry = Object.entries(matrix).find(([key]) => {
    const normalizedKey = normalizeToken(key);
    if (normalizedKey === normalizedType) return true;
    return preferredKey ? normalizeToken(preferredKey) === normalizedKey : false;
  });
  return matchingEntry?.[0] ?? null;
}

function mapFrequencyRule(recurringService, normalizedFrequency) {
  if (normalizedFrequency === "weekly") return recurringService?.weekly_discount;
  if (normalizedFrequency === "biweekly") return recurringService?.biweekly_discount;
  if (normalizedFrequency === "monthly") return recurringService?.monthly_discount;
  return null;
}

function mapUrgencyRule(urgency, urgencyLevel) {
  const urgencyKey = normalizeToken(urgencyLevel);
  if (urgencyKey === "small_job" || urgencyKey === "small_job_premium") return { type: "range", range: asRange(urgency?.small_job_premium, "minimum", "maximum") };
  if (urgencyKey === "large_job" || urgencyKey === "larger_job" || urgencyKey === "larger_job_premium") return { type: "range", range: asRange(urgency?.larger_job_premium, "minimum", "maximum") };
  if (urgencyKey === "evening_holiday_urgent_dispatch" || urgencyKey === "evening_holiday_urgent") return { type: "office_review" };
  return { type: "unknown" };
}

function mapSqftRule(squareFootageAdjustments, sqftBand) {
  const sqftKey = normalizeToken(sqftBand);
  if (sqftKey === "additional_250_500_sqft") return { type: "range", range: asRange(squareFootageAdjustments?.additional_250_500_sqft, "minimum", "maximum") };
  if (sqftKey === "additional_500_1000_sqft") return { type: "range", range: asRange(squareFootageAdjustments?.additional_500_1000_sqft, "minimum", "maximum") };
  if (sqftKey === "more_than_1000_sqft_above_typical") return { type: "office_review" };
  return { type: "unknown" };
}

function requiresOfficeReview(reason) {
  return { requiresOfficeReview: true, reason };
}

function findMatrixPrice(matrix, { dwellingType, beds, baths, packageKey }) {
  if (!matrix || typeof matrix !== "object") return null;
  const normalizedPackageKey = normalizeToken(packageKey);
  const rowKeyCandidates = buildBedBathKeyCandidates(beds, baths);
  const normalizedCandidates = new Set(rowKeyCandidates.map(normalizeToken));
  const bed = toNumber(beds, Number.NaN);
  const bath = toNumber(baths, Number.NaN);

  if (Array.isArray(matrix)) {
    const canonicalType = normalizeToken(dwellingType);
    const aliasEntry = Object.values(DWELLING_TYPE_ALIASES).find((aliases) => aliases.includes(canonicalType));
    const typeAliases = aliasEntry ?? [canonicalType];
    const row = matrix.find((entry) => entry && typeof entry === "object" && typeAliases.includes(normalizeToken(entry.dwelling_type)) && toNumber(entry.beds, Number.NaN) === bed && toNumber(entry.baths, Number.NaN) === bath);
    if (!row) return null;
    if (row.package_prices && typeof row.package_prices === "object") {
      const direct = row.package_prices[packageKey];
      if (typeof direct === "number") return direct;
      for (const [key, val] of Object.entries(row.package_prices)) if (normalizeToken(key) === normalizedPackageKey && typeof val === "number") return val;
    }
    return null;
  }

  const resolvedMatrixTypeKey = resolveDwellingMatrixTypeKey(matrix, dwellingType);
  if (!resolvedMatrixTypeKey) return null;
  const byBedsBaths = matrix[resolvedMatrixTypeKey];
  if (!byBedsBaths || typeof byBedsBaths !== "object") return null;
  const bedBathEntry = Object.entries(byBedsBaths).find(([key, value]) => value && typeof value === "object" && (normalizedCandidates.has(normalizeToken(key)) || (toNumber(value.beds, Number.NaN) === bed && toNumber(value.baths, Number.NaN) === bath)));
  if (!bedBathEntry) return null;
  const packagePrices = bedBathEntry[1]?.package_prices ?? bedBathEntry[1];
  if (!packagePrices || typeof packagePrices !== "object") return null;
  if (typeof packagePrices[packageKey] === "number") return packagePrices[packageKey];
  for (const [key, val] of Object.entries(packagePrices)) if (normalizeToken(key) === normalizedPackageKey && typeof val === "number") return val;
  return null;
}

function getCompleteDeepIncludedAddonSet(config) {
  const packageRule = config?.packages?.complete_deep_clean ?? config?.packages?.complete_deep;
  const values = [
    ...(Array.isArray(packageRule?.includes) ? packageRule.includes : []),
    ...(Array.isArray(packageRule?.do_not_double_charge) ? packageRule.do_not_double_charge : []),
  ];
  return new Set(values.map((value) => ADDON_ALIASES[normalizeToken(value)]).filter(Boolean));
}

export function computeGovernedResidentialQuote({
  configurationVersion, dwellingType, beds, baths, packageKey, condition = "light",
  frequency = "one_time", addons = [], approvedSelections = {},
}) {
  if (!configurationVersion || typeof configurationVersion !== "object") throw new Error("Governed residential pricing requires configurationVersion");
  if (!configurationVersion.configuration || typeof configurationVersion.configuration !== "object") throw new Error("Governed residential pricing requires configuration payload");

  const normalizedPackage = normalizeToken(packageKey);
  if (!SUPPORTED_PACKAGE_KEYS.has(normalizedPackage)) throw new Error(`Governed residential pricing unsupported packageKey: ${packageKey}`);

  const config = configurationVersion.configuration;
  const currencyCode = String(config.currency_code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Governed residential pricing requires valid currency_code");

  const kitchenBathPackage = KITCHEN_BATH_PACKAGE_KEYS.has(normalizedPackage);
  const startingPrice = kitchenBathPackage
    ? findKitchenBathPrice(config.kitchen_bath_packages, { baths, packageKey: normalizedPackage })
    : findMatrixPrice(config.dwelling_matrix, { dwellingType, beds, baths, packageKey: normalizedPackage });
  if (!Number.isFinite(startingPrice)) {
    return kitchenBathPackage
      ? requiresOfficeReview("Requires Management Review / Custom Pricing: this bathroom count and Kitchen & Bath service are not mapped in the published regional pricing configuration.")
      : requiresOfficeReview("Requires Management Review / Custom Pricing: this property, bed/bath, and service combination is not mapped in the published residential pricing matrix.");
  }

  const normalizedCondition = normalizeCondition(condition);
  let conditionMarkupPct = 0;
  if (normalizedCondition !== "light") {
    const conditionRule = config.condition_adjustments?.[normalizedCondition];
    const conditionRange = asRange(conditionRule, "minimum_markup", "maximum_markup");
    const resolved = resolveRangeSelection(conditionRange, approvedSelections.conditionMarkupPct, "condition markup");
    if (resolved.requiresOfficeReview) return resolved;
    conditionMarkupPct = resolved.value;
  }

  const normalizedFrequency = normalizeFrequency(frequency);
  let recurringDiscountPct = 0;
  if (normalizedFrequency !== "one_time") {
    const recurringRule = mapFrequencyRule(config.recurring_service, normalizedFrequency);
    const recurringRange = asRange(recurringRule, "min", "max");
    const resolved = resolveRangeSelection(recurringRange, approvedSelections.recurringDiscountPct, "recurring discount");
    if (resolved.requiresOfficeReview) return resolved;
    recurringDiscountPct = resolved.value;
  }

  let urgencyPremiumAmount = 0;
  if (approvedSelections.urgencyLevel) {
    const urgencyRule = mapUrgencyRule(config.urgency, approvedSelections.urgencyLevel);
    if (urgencyRule.type === "office_review") return requiresOfficeReview("urgency premium requires office review");
    if (urgencyRule.type === "range") {
      const resolved = resolveRangeSelection(urgencyRule.range, approvedSelections.urgencyPremiumAmount, "urgency premium");
      if (resolved.requiresOfficeReview) return resolved;
      urgencyPremiumAmount = resolved.value;
    }
    if (urgencyRule.type === "unknown") return requiresOfficeReview("urgency premium requires office review");
  }

  let sqftAdjustmentAmount = 0;
  if (approvedSelections.sqftBand) {
    const sqftRule = mapSqftRule(config.square_footage_adjustments, approvedSelections.sqftBand);
    if (sqftRule.type === "office_review") return requiresOfficeReview("sqft adjustment requires office review");
    if (sqftRule.type === "range") {
      const resolved = resolveRangeSelection(sqftRule.range, approvedSelections.sqftAdjustmentAmount, "sqft adjustment");
      if (resolved.requiresOfficeReview) return resolved;
      sqftAdjustmentAmount = resolved.value;
    }
    if (sqftRule.type === "unknown") return requiresOfficeReview("sqft adjustment requires office review");
  }

  const addonIds = Array.isArray(addons) ? addons.map((id) => ADDON_ALIASES[normalizeToken(id)] ?? normalizeToken(id)) : [];
  if (normalizedPackage === "complete_deep") {
    const includedAddons = getCompleteDeepIncludedAddonSet(config);
    const duplicateIncluded = addonIds.find((id) => includedAddons.has(id));
    if (duplicateIncluded) throw new Error("complete_deep includes selected service; do not double-charge addon");
  }
  if (normalizedPackage === "kitchen_bath_deep") {
    const duplicateIncluded = addonIds.find((id) => KITCHEN_BATH_DEEP_INCLUDED_ADDONS.has(id));
    if (duplicateIncluded) throw new Error("kitchen_bath_deep includes refrigerator and oven; do not double-charge addon");
  }

  const taxRate = toNumber(config.tax?.rate, 0);
  const minimumCharge = kitchenBathPackage ? 0 : toNumber(config.minimum_charge?.general_residential, 0);
  const baseSubtotal = toNumber(startingPrice, 0);
  const markedUpSubtotal = baseSubtotal * (1 + conditionMarkupPct);
  const withDollarAdjustmentsSubtotal = markedUpSubtotal + urgencyPremiumAmount + sqftAdjustmentAmount;
  const discountedSubtotal = withDollarAdjustmentsSubtotal * (1 - recurringDiscountPct);
  const subtotal = toMoney(Math.max(discountedSubtotal, minimumCharge));
  const taxAmount = toMoney(subtotal * taxRate);
  const total = toMoney(subtotal + taxAmount);

  return {
    total,
    preTaxTotal: subtotal,
    taxAmount,
    taxRate,
    taxName: config.tax?.label ?? config.tax?.name ?? "Tax",
    discountAmt: toMoney(markedUpSubtotal - discountedSubtotal),
    discPct: recurringDiscountPct,
    partnerPay: 0,
    partnerPayEach: 0,
    teamSize: null,
    jobHours: null,
    breakdown: [],
    currency: currencyCode,
    currencyCode,
    baseClientPrice: subtotal,
    quoteContractVersion: "2.1",
    governance: {
      authority: "configuration_version",
      configurationType: configurationVersion.configuration_type,
      version: configurationVersion.version,
      configurationVersionId: configurationVersion.id ?? null,
    },
  };
}

export function buildGovernedResidentialConfigurationSnapshot(configurationVersion) {
  if (!configurationVersion || typeof configurationVersion !== "object") throw new Error("Governed residential snapshot requires configurationVersion");
  if (!configurationVersion.configuration || typeof configurationVersion.configuration !== "object") throw new Error("Governed residential snapshot requires configuration payload");
  const configuration = configurationVersion.configuration;
  const snapshot = {
    source_authority: "published_configuration_version",
    configuration_type: configurationVersion.configuration_type,
    version: configurationVersion.version,
    effective_from: configurationVersion.effective_from ?? null,
    effective_to: configurationVersion.effective_to ?? null,
    business_unit_id: configurationVersion.business_unit_id,
    jurisdiction_id: configurationVersion.jurisdiction_id,
  };
  const publishedKeys = [
    "authority", "tax", "minimum_charge", "packages", "dwelling_matrix", "kitchen_bath_packages",
    "bathroom_only", "partial_cleaning", "move_in_move_out_addons", "premium_addons", "recurring_service",
    "condition_adjustments", "urgency", "square_footage_adjustments", "quote_controls", "currency_code",
    "jurisdiction_code", "business_unit_code",
  ];
  for (const key of publishedKeys) if (Object.prototype.hasOwnProperty.call(configuration, key)) snapshot[key] = configuration[key];
  return snapshot;
}
