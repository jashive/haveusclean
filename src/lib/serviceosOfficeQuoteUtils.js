const HAZARD_PATTERNS = [
  /hoard/i, /biohazard/i, /blood/i, /needle/i, /human waste/i, /animal waste/i,
  /feces/i, /faeces/i, /mold/i, /mould/i, /infestation/i, /hazmat/i,
  /chemical contamination/i, /drug contamination/i, /fire damage/i, /smoke damage/i,
  /water damage/i, /construction debris/i, /unsafe access/i,
];

export const OFFICE_ADDON_OPTIONS = [
  { id: "inside_refrigerator", label: "Inside refrigerator", configKey: "inside_refrigerator" },
  { id: "inside_oven", label: "Inside oven", configKey: "inside_oven" },
  { id: "inside_kitchen_cabinets", label: "Inside kitchen cabinets", configKey: "inside_kitchen_cabinets_minimum" },
  { id: "interior_windows", label: "Interior windows", configKey: "interior_windows_starting" },
  { id: "pet_hair_removal", label: "Pet hair removal", configKey: "pet_hair_removal_starting" },
  { id: "heavy_baseboard_detailing", label: "Heavy baseboard detailing", configKey: "heavy_baseboard_detailing_starting" },
  { id: "balcony_cleaning", label: "Balcony cleaning", configKey: "balcony_cleaning_starting" },
  { id: "garage_sweep_out", label: "Garage sweep-out", configKey: "garage_sweep_out_starting" },
];

export const ONTARIO_COMPLETE_DEEP_BUNDLED_ADDON_IDS = Object.freeze([
  "inside_refrigerator",
  "inside_oven",
  "inside_kitchen_cabinets",
]);

export const KITCHEN_BATH_DEEP_BUNDLED_ADDON_IDS = Object.freeze([
  "inside_refrigerator",
  "inside_oven",
]);

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function completeDeepIncludedAddonIds(configurationVersion) {
  const config = configurationVersion?.configuration || {};
  const packageRule = config.packages?.complete_deep_clean ?? config.packages?.complete_deep ?? {};
  const text = [
    ...(Array.isArray(packageRule.includes) ? packageRule.includes : []),
    ...(Array.isArray(packageRule.do_not_double_charge) ? packageRule.do_not_double_charge : []),
  ].map(normalizeToken);
  const included = new Set();
  if (text.some((item) => item.includes("refrigerator") || item === "fridge")) included.add("inside_refrigerator");
  if (text.some((item) => item.includes("oven"))) included.add("inside_oven");
  if (text.some((item) => item.includes("kitchen_cabinet") || item === "cabinets")) included.add("inside_kitchen_cabinets");
  return included;
}

export function getCompleteDeepBundledAddonIds({ businessUnitCode = null, configurationVersion = null } = {}) {
  const configured = completeDeepIncludedAddonIds(configurationVersion);
  if (configured.size) return configured;
  if (businessUnitCode === "HUC-ON") return new Set(ONTARIO_COMPLETE_DEEP_BUNDLED_ADDON_IDS);
  return new Set();
}

export function getBundledAddonIdsForPackage({ packageKey, businessUnitCode = null, configurationVersion = null } = {}) {
  if (packageKey === "complete_deep") return getCompleteDeepBundledAddonIds({ businessUnitCode, configurationVersion });
  if (packageKey === "kitchen_bath_deep") return new Set(KITCHEN_BATH_DEEP_BUNDLED_ADDON_IDS);
  return new Set();
}

export function isAddonBundledForPackage({ packageKey, addonId, businessUnitCode = null, configurationVersion = null }) {
  return getBundledAddonIdsForPackage({ packageKey, businessUnitCode, configurationVersion }).has(addonId);
}

export function removeBundledAddonsForPackage({ packageKey, addons = [], businessUnitCode = null, configurationVersion = null }) {
  const bundled = getBundledAddonIdsForPackage({ packageKey, businessUnitCode, configurationVersion });
  if (!bundled.size) return Array.isArray(addons) ? [...addons] : [];
  return (Array.isArray(addons) ? addons : []).filter((id) => !bundled.has(id));
}

export function getManagementReviewReason({ condition, notes, packageKey, addons = [], configurationVersion = null, businessUnitCode = null }) {
  if (String(condition || "").toLowerCase() === "extreme") return "Extreme condition requires management review.";
  const text = String(notes || "");
  const hazard = HAZARD_PATTERNS.find((pattern) => pattern.test(text));
  if (hazard) return "Potential hazardous or specialty scope requires management review.";
  const included = getBundledAddonIdsForPackage({ packageKey, businessUnitCode, configurationVersion });
  const duplicate = addons.find((id) => included.has(id));
  if (duplicate) {
    if (packageKey === "kitchen_bath_deep") return "Kitchen & Bath Deep already includes refrigerator and oven cleaning. Remove the duplicate add-on.";
    return "Complete Deep already includes that selected service under this market's published package. Remove the duplicate add-on.";
  }
  return null;
}

export function getDefaultApprovedSelections(configurationVersion, { condition, frequency, sqftBand }) {
  const config = configurationVersion?.configuration || {};
  const normalizedCondition = String(condition || "light").toLowerCase();
  const normalizedFrequency = String(frequency || "one_time").toLowerCase();
  const approved = {};

  if (normalizedCondition === "moderate") approved.conditionMarkupPct = Number(config.condition_adjustments?.moderate?.minimum_markup ?? Number.NaN);
  else if (normalizedCondition === "heavy") approved.conditionMarkupPct = Number(config.condition_adjustments?.heavy?.minimum_markup ?? Number.NaN);

  if (normalizedFrequency === "weekly") approved.recurringDiscountPct = Number(config.recurring_service?.weekly_discount?.min ?? Number.NaN);
  else if (normalizedFrequency === "biweekly") approved.recurringDiscountPct = Number(config.recurring_service?.biweekly_discount?.min ?? Number.NaN);
  else if (normalizedFrequency === "monthly") approved.recurringDiscountPct = Number(config.recurring_service?.monthly_discount?.min ?? Number.NaN);

  if (sqftBand === "additional_250_500_sqft") {
    approved.sqftBand = sqftBand;
    approved.sqftAdjustmentAmount = Number(config.square_footage_adjustments?.additional_250_500_sqft?.minimum ?? Number.NaN);
  } else if (sqftBand === "additional_500_1000_sqft") {
    approved.sqftBand = sqftBand;
    approved.sqftAdjustmentAmount = Number(config.square_footage_adjustments?.additional_500_1000_sqft?.minimum ?? Number.NaN);
  } else if (sqftBand === "more_than_1000_sqft_above_typical") approved.sqftBand = sqftBand;

  return approved;
}

export function applyGovernedResidentialAddons(quote, configurationVersion, addonIds = []) {
  const config = configurationVersion?.configuration || {};
  const rateCard = config.premium_addons || {};
  const selected = OFFICE_ADDON_OPTIONS.filter((option) => addonIds.includes(option.id));
  const addonLines = selected.map((option) => ({ id: option.id, label: option.label, amount: money(rateCard[option.configKey]) }));
  const addonTotal = money(addonLines.reduce((sum, line) => sum + line.amount, 0));
  if (!addonTotal) return { ...quote, addonLines, addonTotal: 0, input: { ...(quote?.input || {}), addons: addonIds } };

  const taxRate = Number(quote?.taxRate ?? config.tax?.rate ?? 0);
  const preTaxTotal = money(Number(quote?.preTaxTotal ?? 0) + addonTotal);
  const taxAmount = money(preTaxTotal * taxRate);
  const total = money(preTaxTotal + taxAmount);
  return { ...quote, preTaxTotal, taxAmount, total, baseClientPrice: preTaxTotal, addonLines, addonTotal, input: { ...(quote?.input || {}), addons: addonIds } };
}

export function formatQuoteMoney(amount, currencyCode) {
  const code = String(currencyCode || "CAD").toUpperCase();
  const symbol = code === "CAD" ? "CA$" : code === "USD" ? "$" : `${code} `;
  return `${symbol}${Number(amount || 0).toFixed(2)}`;
}

export function buildCustomerFacingQuoteText({ customerName, serviceLabel, quote, frequencyLabel }) {
  const firstName = String(customerName || "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const frequency = frequencyLabel && frequencyLabel !== "One-Time" ? ` (${frequencyLabel})` : "";
  const addonText = quote?.addonLines?.length ? ` Add-ons included: ${quote.addonLines.map((line) => line.label).join(", ")}.` : "";
  const currencyCode = quote?.currencyCode ?? quote?.currency ?? "CAD";
  const preTax = formatQuoteMoney(quote?.preTaxTotal, currencyCode);
  const total = formatQuoteMoney(quote?.total, currencyCode);
  const taxName = quote?.taxName || "Tax";
  const taxRate = Number(quote?.taxRate || 0);
  const priceText = taxRate > 0 ? `${preTax} + ${taxName}, for a total of ${total}` : `${total} total (no service tax applied)`;
  return `${greeting}\n\nThank you for contacting Have Us Clean. Your ${serviceLabel}${frequency} is ${priceText}.${addonText}\n\nWould you like me to check availability and get that scheduled for you?`;
}
