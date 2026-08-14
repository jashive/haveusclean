import { GOVERNED_RESIDENTIAL_REQUIRED_VERSION } from "./governedResidentialConfig.js";

const SUPPORTED_PACKAGE_KEYS = new Set([
  "essential_refresh",
  "signature_initial_reset",
  "complete_deep",
  "move_in_move_out",
]);

const INCLUDED_COMPLETE_DEEP_ADDONS = new Set(["fridge", "oven", "cabinets", "kitchen_cabinets", "kitchen-cabinets"]);
const DWELLING_TYPE_ALIASES = {
  apartment_condo: ["apartment_condo", "apartment", "condo"],
  townhouse: ["townhouse", "semi_townhouse", "semi", "townhome"],
  detached_semi_detached: ["detached_semi_detached", "detached", "semi_detached", "semi_detached_house"],
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMoney(value) {
  return Number((Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100).toFixed(2));
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeCondition(value) {
  const v = normalizeToken(value);
  if (!v) return "light";
  if (v === "average") return "moderate";
  return v;
}

function valueInRange(selection, range) {
  const value = toNumber(selection, Number.NaN);
  if (!Number.isFinite(value)) return false;
  const min = toNumber(range.min, Number.NaN);
  const max = toNumber(range.max, Number.NaN);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return false;
  return value >= min && value <= max;
}

function resolveDeterministicAdjustment(value, approvedValue, label) {
  if (value === undefined || value === null) return { value: 0 };
  if (typeof value === "number") return { value };
  if (typeof value === "object" && value !== null) {
    const hasRange = Object.prototype.hasOwnProperty.call(value, "min") && Object.prototype.hasOwnProperty.call(value, "max");
    if (hasRange) {
      if (!valueInRange(approvedValue, value)) {
        return {
          requiresOfficeReview: true,
          reason: `${label} requires approved selection within published range`,
        };
      }
      return { value: toNumber(approvedValue, 0) };
    }
  }
  return {
    requiresOfficeReview: true,
    reason: `${label} is non-deterministic and requires office review`,
  };
}

function findMatrixPrice(matrix, { dwellingType, beds, baths, packageKey }) {
  if (!matrix || typeof matrix !== "object") return null;
  const canonicalType = normalizeToken(dwellingType);
  const typeAliases = DWELLING_TYPE_ALIASES[canonicalType] ?? [canonicalType];
  const bed = toNumber(beds, Number.NaN);
  const bath = toNumber(baths, Number.NaN);
  const pkg = normalizeToken(packageKey);

  if (Array.isArray(matrix)) {
    const row = matrix.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const typeToken = normalizeToken(entry.dwelling_type);
      const typeMatch = typeAliases.includes(typeToken);
      const bedMatch = toNumber(entry.beds, Number.NaN) === bed;
      const bathMatch = toNumber(entry.baths, Number.NaN) === bath;
      return typeMatch && bedMatch && bathMatch;
    });
    if (!row) return null;
    if (row.package_prices && typeof row.package_prices === "object") {
      const direct = row.package_prices[packageKey];
      if (typeof direct === "number") return direct;
      for (const [key, val] of Object.entries(row.package_prices)) {
        if (normalizeToken(key) === pkg && typeof val === "number") return val;
      }
    }
    return null;
  }

  const typeEntry = Object.entries(matrix).find(([key]) => typeAliases.includes(normalizeToken(key)));
  if (!typeEntry) return null;
  const byBedsBaths = typeEntry[1];
  if (!byBedsBaths || typeof byBedsBaths !== "object") return null;

  const bedBathEntry = Object.entries(byBedsBaths).find(([key, value]) => {
    if (!value || typeof value !== "object") return false;
    if (toNumber(value.beds, Number.NaN) === bed && toNumber(value.baths, Number.NaN) === bath) return true;
    const token = normalizeToken(key);
    const bathToken = String(bath).replace(".", "_");
    return (
      (token.includes(`${bed}_bed`) && token.includes(`${bath}_bath`)) ||
      token.includes(`${bed}_${bathToken}`)
    );
  });
  if (!bedBathEntry) return null;

  const packagePrices = bedBathEntry[1]?.package_prices ?? bedBathEntry[1];
  if (!packagePrices || typeof packagePrices !== "object") return null;
  if (typeof packagePrices[packageKey] === "number") return packagePrices[packageKey];
  for (const [key, val] of Object.entries(packagePrices)) {
    if (normalizeToken(key) === pkg && typeof val === "number") return val;
  }
  return null;
}

export function computeGovernedResidentialQuote({
  configurationVersion,
  dwellingType,
  beds,
  baths,
  packageKey,
  condition = "light",
  frequency = "one_time",
  addons = [],
  approvedSelections = {},
}) {
  if (!configurationVersion || typeof configurationVersion !== "object") {
    throw new Error("Governed residential pricing requires configurationVersion");
  }
  if (!configurationVersion.configuration || typeof configurationVersion.configuration !== "object") {
    throw new Error("Governed residential pricing requires configuration payload");
  }

  const normalizedPackage = normalizeToken(packageKey);
  if (!SUPPORTED_PACKAGE_KEYS.has(normalizedPackage)) {
    throw new Error(`Governed residential pricing unsupported packageKey: ${packageKey}`);
  }

  const config = configurationVersion.configuration;
  const startingPrice = findMatrixPrice(config.dwelling_matrix, {
    dwellingType,
    beds,
    baths,
    packageKey: normalizedPackage,
  });
  if (!Number.isFinite(startingPrice)) {
    throw new Error("Governed residential pricing matrix row not found");
  }

  const normalizedCondition = normalizeCondition(condition);
  let conditionMarkupPct = 0;
  if (normalizedCondition !== "light") {
    const conditionRule = config.condition_markup?.[normalizedCondition];
    const resolved = resolveDeterministicAdjustment(
      conditionRule,
      approvedSelections.conditionMarkupPct,
      "condition markup"
    );
    if (resolved.requiresOfficeReview) return resolved;
    conditionMarkupPct = resolved.value;
  }

  const normalizedFrequency = normalizeToken(frequency);
  let recurringDiscountPct = 0;
  if (!["one_time", "onetime"].includes(normalizedFrequency)) {
    const recurringRule =
      config.recurring_discount?.[normalizedFrequency] ??
      config.recurring_discounts?.[normalizedFrequency];
    const resolved = resolveDeterministicAdjustment(
      recurringRule,
      approvedSelections.recurringDiscountPct,
      "recurring discount"
    );
    if (resolved.requiresOfficeReview) return resolved;
    recurringDiscountPct = resolved.value;
  }

  let urgencyPremiumPct = 0;
  if (approvedSelections.urgencyLevel) {
    const urgencyKey = normalizeToken(approvedSelections.urgencyLevel);
    const urgencyRule = config.urgency_premium?.[urgencyKey];
    const resolved = resolveDeterministicAdjustment(
      urgencyRule,
      approvedSelections.urgencyPremiumPct,
      "urgency premium"
    );
    if (resolved.requiresOfficeReview) return resolved;
    urgencyPremiumPct = resolved.value;
  }

  let sqftAdjustmentPct = 0;
  if (approvedSelections.sqftBand) {
    const sqftKey = normalizeToken(approvedSelections.sqftBand);
    const sqftRule =
      config.sqft_adjustment?.[sqftKey] ??
      config.square_footage_adjustment?.[sqftKey];
    const resolved = resolveDeterministicAdjustment(
      sqftRule,
      approvedSelections.sqftAdjustmentPct,
      "sqft adjustment"
    );
    if (resolved.requiresOfficeReview) return resolved;
    sqftAdjustmentPct = resolved.value;
  }

  const addonIds = Array.isArray(addons) ? addons.map(normalizeToken) : [];
  if (normalizedPackage === "complete_deep") {
    const duplicateIncluded = addonIds.find((id) => INCLUDED_COMPLETE_DEEP_ADDONS.has(id));
    if (duplicateIncluded) {
      throw new Error("complete_deep includes fridge/oven/kitchen-cabinet services; do not double-charge addons");
    }
  }

  const taxRate = toNumber(config.tax?.rate, 0);
  const minimumCharge = toNumber(
    config.minimum_charge?.amount ?? config.minimum_charge,
    0
  );
  const baseSubtotal = toNumber(startingPrice, 0);
  const markedUpSubtotal = baseSubtotal * (1 + conditionMarkupPct + urgencyPremiumPct + sqftAdjustmentPct);
  const discountedSubtotal = markedUpSubtotal * (1 - recurringDiscountPct);
  const subtotal = toMoney(Math.max(discountedSubtotal, minimumCharge));
  const taxAmount = toMoney(subtotal * taxRate);
  const total = toMoney(subtotal + taxAmount);

  return {
    total,
    preTaxTotal: subtotal,
    taxAmount,
    taxRate,
    taxName: config.tax?.name ?? "HST",
    discountAmt: toMoney(markedUpSubtotal - discountedSubtotal),
    discPct: recurringDiscountPct,
    partnerPay: 0,
    partnerPayEach: 0,
    teamSize: null,
    jobHours: null,
    breakdown: [],
    currency: "CA$",
    baseClientPrice: subtotal,
    quoteContractVersion: "2.0",
    governance: {
      authority: "configuration_version",
      configurationType: configurationVersion.configuration_type,
      version: configurationVersion.version ?? GOVERNED_RESIDENTIAL_REQUIRED_VERSION,
      configurationVersionId: configurationVersion.id ?? null,
    },
  };
}

export function buildGovernedResidentialConfigurationSnapshot(configurationVersion) {
  if (!configurationVersion || typeof configurationVersion !== "object") {
    throw new Error("Governed residential snapshot requires configurationVersion");
  }
  if (!configurationVersion.configuration || typeof configurationVersion.configuration !== "object") {
    throw new Error("Governed residential snapshot requires configuration payload");
  }

  return {
    source_authority: "published_configuration_version",
    configuration_type: configurationVersion.configuration_type,
    version: configurationVersion.version,
    effective_from: configurationVersion.effective_from ?? null,
    effective_to: configurationVersion.effective_to ?? null,
    business_unit_id: configurationVersion.business_unit_id,
    jurisdiction_id: configurationVersion.jurisdiction_id,
    pricing_rules: {
      dwelling_matrix: configurationVersion.configuration.dwelling_matrix ?? null,
      condition_markup: configurationVersion.configuration.condition_markup ?? null,
      recurring_discount:
        configurationVersion.configuration.recurring_discount ??
        configurationVersion.configuration.recurring_discounts ??
        null,
      urgency_premium: configurationVersion.configuration.urgency_premium ?? null,
      sqft_adjustment:
        configurationVersion.configuration.sqft_adjustment ??
        configurationVersion.configuration.square_footage_adjustment ??
        null,
      tax: configurationVersion.configuration.tax ?? null,
      minimum_charge: configurationVersion.configuration.minimum_charge ?? null,
      package_inclusions: configurationVersion.configuration.package_inclusions ?? null,
    },
    source_authority_metadata: configurationVersion.configuration.source_authority_metadata ?? null,
  };
}
