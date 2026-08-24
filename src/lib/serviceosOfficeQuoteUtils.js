const HAZARD_PATTERNS = [
  /hoard/i,
  /biohazard/i,
  /blood/i,
  /needle/i,
  /human waste/i,
  /animal waste/i,
  /feces/i,
  /faeces/i,
  /mold/i,
  /mould/i,
  /infestation/i,
  /hazmat/i,
  /chemical contamination/i,
  /drug contamination/i,
  /fire damage/i,
  /smoke damage/i,
  /water damage/i,
  /construction debris/i,
  /unsafe access/i,
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

const COMPLETE_DEEP_INCLUDED_ADDONS = new Set([
  "inside_refrigerator",
  "inside_oven",
  "inside_kitchen_cabinets",
]);

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

export function getManagementReviewReason({ condition, notes, packageKey, addons = [] }) {
  if (String(condition || "").toLowerCase() === "extreme") {
    return "Extreme condition requires management review.";
  }
  const text = String(notes || "");
  const hazard = HAZARD_PATTERNS.find((pattern) => pattern.test(text));
  if (hazard) {
    return "Potential hazardous or specialty scope requires management review.";
  }
  if (packageKey === "complete_deep") {
    const duplicate = addons.find((id) => COMPLETE_DEEP_INCLUDED_ADDONS.has(id));
    if (duplicate) {
      return "Complete Deep already includes refrigerator, oven, and empty kitchen-cabinet interiors. Remove duplicate add-ons.";
    }
  }
  return null;
}

export function getDefaultApprovedSelections(configurationVersion, { condition, frequency, sqftBand }) {
  const config = configurationVersion?.configuration || {};
  const normalizedCondition = String(condition || "light").toLowerCase();
  const normalizedFrequency = String(frequency || "one_time").toLowerCase();
  const approved = {};

  if (normalizedCondition === "moderate") {
    approved.conditionMarkupPct = Number(config.condition_adjustments?.moderate?.minimum_markup ?? 0.1);
  } else if (normalizedCondition === "heavy") {
    approved.conditionMarkupPct = Number(config.condition_adjustments?.heavy?.minimum_markup ?? 0.2);
  }

  if (normalizedFrequency === "weekly") {
    approved.recurringDiscountPct = Number(config.recurring_service?.weekly_discount?.min ?? 0.1);
  } else if (normalizedFrequency === "biweekly") {
    approved.recurringDiscountPct = Number(config.recurring_service?.biweekly_discount?.min ?? 0.05);
  } else if (normalizedFrequency === "monthly") {
    approved.recurringDiscountPct = Number(config.recurring_service?.monthly_discount?.min ?? 0);
  }

  if (sqftBand === "additional_250_500_sqft") {
    approved.sqftBand = sqftBand;
    approved.sqftAdjustmentAmount = Number(config.square_footage_adjustments?.additional_250_500_sqft?.minimum ?? 25);
  } else if (sqftBand === "additional_500_1000_sqft") {
    approved.sqftBand = sqftBand;
    approved.sqftAdjustmentAmount = Number(config.square_footage_adjustments?.additional_500_1000_sqft?.minimum ?? 50);
  } else if (sqftBand === "more_than_1000_sqft_above_typical") {
    approved.sqftBand = sqftBand;
  }

  return approved;
}

export function applyGovernedResidentialAddons(quote, configurationVersion, addonIds = []) {
  const config = configurationVersion?.configuration || {};
  const rateCard = config.premium_addons || {};
  const selected = OFFICE_ADDON_OPTIONS.filter((option) => addonIds.includes(option.id));
  const addonLines = selected.map((option) => ({
    id: option.id,
    label: option.label,
    amount: money(rateCard[option.configKey]),
  }));
  const addonTotal = money(addonLines.reduce((sum, line) => sum + line.amount, 0));
  if (!addonTotal) {
    return {
      ...quote,
      addonLines,
      addonTotal: 0,
      input: { ...(quote?.input || {}), addons: addonIds },
    };
  }

  const taxRate = Number(quote?.taxRate ?? config.tax?.rate ?? 0);
  const preTaxTotal = money(Number(quote?.preTaxTotal ?? 0) + addonTotal);
  const taxAmount = money(preTaxTotal * taxRate);
  const total = money(preTaxTotal + taxAmount);

  return {
    ...quote,
    preTaxTotal,
    taxAmount,
    total,
    baseClientPrice: preTaxTotal,
    addonLines,
    addonTotal,
    input: { ...(quote?.input || {}), addons: addonIds },
  };
}

export function buildCustomerFacingQuoteText({ customerName, serviceLabel, quote, frequencyLabel }) {
  const firstName = String(customerName || "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const frequency = frequencyLabel && frequencyLabel !== "One-Time" ? ` (${frequencyLabel})` : "";
  const addonText = quote?.addonLines?.length
    ? ` Add-ons included: ${quote.addonLines.map((line) => line.label).join(", ")}.`
    : "";
  return `${greeting}\n\nThank you for contacting Have Us Clean. Your ${serviceLabel}${frequency} is $${Number(quote?.preTaxTotal || 0).toFixed(2)} + HST, for a total of $${Number(quote?.total || 0).toFixed(2)}.${addonText}\n\nWould you like me to check availability and get that scheduled for you?`;
}
