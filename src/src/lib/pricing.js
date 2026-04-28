export const PARTNER_SHARE = 0.65;
export const COMPANY_SHARE = 0.35;
export const PROFIT_MARGIN = 0.35;

export const partnerPayFromPrice = (clientPrice) =>
  Math.round(clientPrice * PARTNER_SHARE);

export const companyProfitFromPrice = (clientPrice) =>
  Math.round(clientPrice * COMPANY_SHARE);

export const markupFactor = (cost) =>
  Math.ceil(cost / (1 - PROFIT_MARGIN));

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

export const FLOOR_PRICES = { ... };
export const RES_SERVICE_MULT = { ... };
export const CONDITION_MULT = { ... };
export const FREQ_DISCOUNTS = { ... };
export const RES_ADDONS = [ ... ];

export const SQFT_HOURS = { ... };

export const getSqftHours = (sqft) => {
  const tiers = Object.keys(SQFT_HOURS).map(Number).sort((a, b) => a - b);
  for (let t of tiers) if (sqft <= t) return SQFT_HOURS[t];
  return SQFT_HOURS[5000] + (sqft - 5000) / 500;
};

export const PARTNER_COST_PER_HOUR = 30;

export const COM_SERVICE_COST_PER_SQFT = { ... };
export const COM_MIN_COST = { ... };
export const COM_ADDONS = [ ... ];
export const COM_FREQ_DISCOUNTS = { ... };
