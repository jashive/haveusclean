export const PARTNER_SHARE = 0.60;
export const COMPANY_SHARE = 0.40;
export const PROFIT_MARGIN = 0.40;

export const partnerPayFromPrice = (clientPrice) =>
  Math.round((clientPrice || 0) * PARTNER_SHARE);

export const companyProfitFromPrice = (clientPrice) =>
  Math.round((clientPrice || 0) * COMPANY_SHARE);

export const markupFactor = (cost) =>
  Math.ceil((cost || 0) / (1 - PROFIT_MARGIN));

export const getTeamSize = (sqft) => {
  if (!sqft || sqft <= 1000) return 1;
  if (sqft <= 3000) return 2;
  return 3;
};

export const getJobHours = (sqft) => {
  const raw = Math.max(1.5, (sqft || 900) / 1000);
  return Math.round(raw * 2) / 2;
};

export const PARTNER_HOURLY_ON = 30;
export const PARTNER_HOURLY_AZ = 25;

export const FLOOR_PRICES = {
  ON: {
    "Apartment / Condo": { "1 Bed": 140, "2 Bed": 165, "3 Bed": 205 },
    "Semi / Townhouse": { Small: 165, Medium: 205, Large: 245 },
    "Detached House": { Small: 185, Medium: 230, Large: 310 },
  },
  AZ: {
    "Apartment / Condo": { "1 Bed": 155, "2 Bed": 185, "3 Bed": 230 },
    "Semi / Townhouse": { Small: 185, Medium: 230, Large: 275 },
    "Detached House": { Small: 205, Medium: 255, Large: 345 },
  },
};

export const RES_SERVICE_MULT = {
  "Refresh Clean": 1.0,
  "Full Home Clean": 1.25,
  "Deep Clean": 1.65,
  "Move-In / Move-Out": 1.8,
  "Kitchen & Bathroom Refresh": 0.65,
  "Pre-Sale Clean": 1.5,
  "Post-Renovation Clean": 1.7,
  "Office / Commercial": 1.2,
};

export const CONDITION_MULT = {
  Light: 0.9,
  Average: 1.0,
  Heavy: 1.2,
  "": 1.0,
};

export const FREQ_DISCOUNTS = {
  "One-Time": 0,
  Weekly: 0.15,
  "Bi-Weekly": 0.1,
  Monthly: 0.05,
};

export const RES_ADDONS = [
  { id: "fridge", label: "Inside Fridge", clientPrice: 50, costToUs: 20 },
  { id: "oven", label: "Inside Oven", clientPrice: 55, costToUs: 22 },
  { id: "cabinets", label: "Inside Cabinets", clientPrice: 65, costToUs: 26 },
  { id: "windows", label: "Interior Windows", clientPrice: 60, costToUs: 24 },
  { id: "baseboards", label: "Baseboards / Detail", clientPrice: 55, costToUs: 22 },
  { id: "carpet", label: "Carpet Cleaning", clientPrice: 95, costToUs: 38 },
  { id: "pethair", label: "Pet Hair / Heavy Detail", clientPrice: 65, costToUs: 26 },
];

export const SQFT_HOURS = {
  500: 1.5, 750: 2, 1000: 2.5, 1250: 3, 1500: 3.5,
  1750: 4, 2000: 4.5, 2500: 5.5, 3000: 6.5, 3500: 7.5,
  4000: 9, 5000: 11,
};

export const getSqftHours = (sqft) => {
  const tiers = Object.keys(SQFT_HOURS).map(Number).sort((a, b) => a - b);
  for (const threshold of tiers) {
    if (sqft <= threshold) return SQFT_HOURS[threshold];
  }
  return SQFT_HOURS[5000] + (sqft - 5000) / 500;
};

export const PARTNER_COST_PER_HOUR = 30;

export function getJobCompensationBreakdown({
  teamSize = 1,
  hours = 0,
  partnerCostPerHour = PARTNER_COST_PER_HOUR,
}) {
  const normalizedTeamSize = Math.max(1, toFiniteNumber(teamSize, 1));
  const normalizedHours = Math.max(0, toFiniteNumber(hours, 0));
  const laborCost = normalizedTeamSize * toFiniteNumber(partnerCostPerHour, PARTNER_COST_PER_HOUR) * normalizedHours;
  const clientPrice = roundMoney(safeDivide(laborCost, PARTNER_SHARE, 0));
  const partnerPayTotal = partnerPayFromPrice(clientPrice);
  const partnerPayEach = roundMoney(safeDivide(partnerPayTotal, normalizedTeamSize, 0));
  const profit = companyProfitFromPrice(clientPrice);

  return {
    teamSize: normalizedTeamSize,
    hours: normalizedHours,
    laborCost,
    clientPrice,
    partnerPayTotal,
    partnerPayEach,
    profit,
  };
}

export const COM_SERVICE_COST_PER_SQFT = {
  "Office Clean": 0.07,
  "Janitorial (Daily)": 0.05,
  "Post-Construction": 0.14,
  "Medical/Lab Facility": 0.18,
  "Retail / Showroom": 0.065,
  "Warehouse / Industrial": 0.045,
};

export const COM_MIN_COST = {
  "Office Clean": 120,
  "Janitorial (Daily)": 100,
  "Post-Construction": 280,
  "Medical/Lab Facility": 350,
  "Retail / Showroom": 110,
  "Warehouse / Industrial": 140,
};

export const COM_ADDONS = [
  { id: "restrooms", label: "Deep Restroom Sanitization", costToUs: 60 },
  { id: "windows_ext", label: "Exterior Window Wash", costToUs: 85 },
  { id: "carpet_com", label: "Commercial Carpet Steam", costToUs: 105 },
  { id: "floor_strip", label: "Floor Strip & Wax", costToUs: 140 },
  { id: "pressure", label: "Pressure Washing (exterior)", costToUs: 120 },
  { id: "supply", label: "Restroom Supply Restocking", costToUs: 28 },
  { id: "trash", label: "After-Hours Trash Removal", costToUs: 42 },
  { id: "disinfect", label: "Full Disinfection Service", costToUs: 90 },
];

export const COM_FREQ_DISCOUNTS = {
  "One-Time": 0,
  Daily: 0.18,
  Weekly: 0.13,
  "Bi-Weekly": 0.08,
  Monthly: 0.04,
};

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDivide = (numerator, denominator, fallback = 0) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  return numerator / denominator;
};

const roundMoney = (value) => Math.round(Number(value || 0));

export function getResidentialQuoteInput(input = {}) {
  return {
    ...input,
    dwellingType: input.dwellingType || "Apartment / Condo",
    dwellingSize: input.dwellingSize || "2 Bed",
    serviceType: input.serviceType || "Refresh Clean",
    frequency: input.frequency || "One-Time",
    beds: toFiniteNumber(input.beds, 2),
    baths: toFiniteNumber(input.baths, 1),
    sqft: toFiniteNumber(input.sqft, 900),
    addons: Array.isArray(input.addons) ? input.addons : [],
  };
}

export function getCommercialQuoteInput(input = {}) {
  return {
    ...input,
    serviceType: input.serviceType || "Office Clean",
    frequency: input.frequency || "Weekly",
    sqft: toFiniteNumber(input.sqft, 2000),
    floors: Math.max(1, toFiniteNumber(input.floors, 1)),
    contractMonths: Math.max(1, toFiniteNumber(input.contractMonths, 1)),
    addons: Array.isArray(input.addons) ? input.addons : [],
  };
}

export function calcResQuote(input, region = { id: "ON", currencySymbol: "CA$", tax: { name: "HST", rate: 0.13 } }) {
  const form = getResidentialQuoteInput(input);
  const isAZ = region.id === "AZ";
  const hourlyRate = isAZ ? PARTNER_HOURLY_AZ : PARTNER_HOURLY_ON;
  const azUplift = isAZ ? 1.12 : 1.0;
  const inputSqft = toFiniteNumber(form?.sqft, 0);
  const inputBeds = toFiniteNumber(form?.beds, 2);
  const inputBaths = toFiniteNumber(form?.baths, 1);

  const estimatedSqft = inputSqft > 0 ? inputSqft : Math.max(400, 400 + inputBeds * 180 + inputBaths * 80);
  const teamSize = getTeamSize(estimatedSqft);
  const jobHours = getJobHours(estimatedSqft);
  const laborCost = toFiniteNumber(teamSize, 1) * toFiniteNumber(hourlyRate, 0) * toFiniteNumber(jobHours, 0);
  const laborBasePrice = Math.ceil(safeDivide(laborCost, PARTNER_SHARE, 0));
  const packageMultiplier = toFiniteNumber(RES_SERVICE_MULT[form?.serviceType], 1.0);
  const formulaPrice = roundMoney(laborBasePrice * packageMultiplier * azUplift);

  const regionKey = isAZ ? "AZ" : "ON";
  const floorGroup = FLOOR_PRICES[regionKey]?.[form?.dwellingType];
  const floorBase = toFiniteNumber(floorGroup?.[form?.dwellingSize], 140);
  const floorPrice = roundMoney(floorBase * packageMultiplier * azUplift);
  const baseClientPrice = Math.max(formulaPrice, floorPrice);
  const conditionMultiplier = toFiniteNumber(CONDITION_MULT[form?.condition || ""], 1.0);
  const conditionedPrice = roundMoney(baseClientPrice * conditionMultiplier);

  const addonClientTotal = (Array.isArray(form?.addons) ? form.addons : []).reduce((sum, id) => {
    const addon = RES_ADDONS.find((entry) => entry.id === id);
    return sum + toFiniteNumber(addon?.clientPrice, 0);
  }, 0);

  const clientSubtotal = conditionedPrice + addonClientTotal;
  const discountPercent = toFiniteNumber(FREQ_DISCOUNTS[form?.frequency], 0);
  const discountAmt = roundMoney(clientSubtotal * discountPercent);
  const preTaxTotal = clientSubtotal - discountAmt;
  const taxRate = region.id === "ON" ? toFiniteNumber(region?.tax?.rate, 0) : 0;
  const taxAmount = roundMoney(preTaxTotal * taxRate);
  const finalTotal = preTaxTotal + taxAmount;
  const partnerPayTotal = partnerPayFromPrice(preTaxTotal);
  const partnerPayEach = teamSize > 1 ? roundMoney(safeDivide(partnerPayTotal, teamSize, 0)) : partnerPayTotal;
  const profit = companyProfitFromPrice(preTaxTotal);
  const margin = preTaxTotal > 0 ? safeDivide(profit, preTaxTotal, 0) * 100 : 0;

  const freq_prices = {};
  Object.keys(FREQ_DISCOUNTS).forEach((frequency) => {
    const discount = FREQ_DISCOUNTS[frequency] || 0;
    freq_prices[frequency] = roundMoney(conditionedPrice * (1 - toFiniteNumber(discount, 0)));
  });

  const breakdown = [
    {
      label: `Labor (${teamSize} partner${teamSize > 1 ? "s" : ""} x ${jobHours}h x ${region.currencySymbol}${hourlyRate}/hr)`,
      cost: laborCost,
      price: conditionedPrice,
    },
    ...(Array.isArray(form?.addons) ? form.addons : []).map((id) => {
      const addon = RES_ADDONS.find((entry) => entry.id === id);
      return addon ? { label: addon.label, cost: addon.costToUs, price: addon.clientPrice } : null;
    }).filter(Boolean),
  ];

  return {
    total: finalTotal,
    preTaxTotal,
    taxAmount,
    taxRate,
    taxName: region.tax.name,
    discountAmt,
    discPct: discountPercent,
    partnerPay: partnerPayTotal,
    partnerPayEach,
    teamSize,
    jobHours,
    estimatedSqft,
    profit,
    margin,
    breakdown,
    serviceHours: jobHours,
    sqftHours: jobHours,
    currency: region.currencySymbol,
    region,
    freq_prices,
    baseClientPrice: conditionedPrice,
    formulaPrice,
    floorPrice,
    condMult: conditionMultiplier,
  };
}

export function calcComQuote(input, region = { id: "ON", currencySymbol: "CA$", tax: { name: "HST", rate: 0.13 } }) {
  const form = getCommercialQuoteInput(input);
  const costPerSqft = toFiniteNumber(COM_SERVICE_COST_PER_SQFT[form?.serviceType], 0.07);
  const minCost = toFiniteNumber(COM_MIN_COST[form?.serviceType], 120);
  const regionMult = region.id === "ON" ? 1.15 : 1.0;
  const sqft = Math.max(0, toFiniteNumber(form?.sqft, 2000));
  const floors = Math.max(1, toFiniteNumber(form?.floors, 1));
  const baseCost = Math.max(minCost, sqft * costPerSqft) * regionMult;
  const floorAdj = 1 + (floors - 1) * 0.10;
  const addonCost = (Array.isArray(form?.addons) ? form.addons : []).reduce((sum, id) => {
    const addon = COM_ADDONS.find((entry) => entry.id === id);
    return sum + toFiniteNumber(addon?.costToUs, 0);
  }, 0) * regionMult;
  const totalCost = baseCost * floorAdj + addonCost;
  const clientSubtotal = markupFactor(totalCost);
  const discPct = toFiniteNumber(COM_FREQ_DISCOUNTS[form?.frequency], 0);
  const discountAmt = clientSubtotal * discPct;
  const preTaxTotal = Math.max(0, clientSubtotal - discountAmt);
  const taxRate = region.id === "ON" ? toFiniteNumber(region?.tax?.rate, 0) : 0;
  const taxAmount = preTaxTotal * taxRate;
  const finalTotal = preTaxTotal + taxAmount;
  const profit = companyProfitFromPrice(preTaxTotal);
  const margin = preTaxTotal > 0 ? safeDivide(profit, preTaxTotal, 0) * 100 : 0;
  const visitsPerMonth = form?.frequency === "Daily" ? 22 : form?.frequency === "Weekly" ? 4 : form?.frequency === "Bi-Weekly" ? 2 : 1;
  const monthly = finalTotal * visitsPerMonth;
  const contract = monthly * Math.max(1, toFiniteNumber(form?.contractMonths, 1));

  return {
    total: finalTotal,
    preTaxTotal,
    taxAmount,
    taxRate,
    taxName: region.tax.name,
    partnerPay: partnerPayFromPrice(preTaxTotal),
    profit,
    margin,
    discountAmt,
    discPct,
    monthly,
    contract,
    totalCost,
    currency: region.currencySymbol,
    region,
  };
}