export const PARTNER_SHARE = 0.65;
export const COMPANY_SHARE = 0.35;
export const PROFIT_MARGIN = 0.35;

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
  for (let t of tiers) { if (sqft <= t) return SQFT_HOURS[t]; }
  return SQFT_HOURS[5000] + (sqft - 5000) / 500;
};

export const PARTNER_COST_PER_HOUR = 30;

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
