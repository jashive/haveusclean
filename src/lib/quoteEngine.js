const roundMoney = (value) => Math.round(Number(value || 0));

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

function confidenceFromInputs(type, data = {}, quote = {}) {
  const requiredByType = {
    residential: ["dwellingType", "serviceType", "frequency", "beds", "baths"],
    commercial: ["bizName", "serviceType", "sqft", "frequency"],
  };

  const required = requiredByType[type] || requiredByType.residential;
  const missingCount = required.filter((key) => !hasValue(data?.[key])).length;
  const total = Number(quote?.total || 0);

  if (!Number.isFinite(total) || total <= 0 || missingCount >= 2) return "Needs Review";
  if (missingCount === 1) return "Medium";
  return "High";
}

export function withQuotePresentation(quote = {}, { type = "residential", data = {} } = {}) {
  const recommendedPrice = roundMoney(quote.total);
  const rangeBase = Number(quote.preTaxTotal || quote.baseClientPrice || quote.total || 0);
  const minimumPrice = Math.max(0, roundMoney(rangeBase * 0.92));
  const maximumPrice = Math.max(recommendedPrice, roundMoney(Math.max(rangeBase, recommendedPrice) * 1.12));

  const inferredCrew = Number(quote.teamSize || 0) > 0
    ? Number(quote.teamSize)
    : type === "commercial"
      ? Math.max(1, roundMoney((quote.totalCost || 0) / 120))
      : 1;

  const estimatedHours = Number(quote.jobHours || quote.serviceHours || quote.sqftHours || 0) || null;
  const confidence = confidenceFromInputs(type, data, quote);

  return {
    ...quote,
    recommendedPrice,
    minimumPrice,
    maximumPrice,
    crewSize: inferredCrew,
    estimatedHours,
    confidence,
    quoteContractVersion: "2.0",
  };
}

export function calculateQuote({
  type = "residential",
  data = {},
  region,
  residentialCalculator,
  commercialCalculator,
}) {
  const calculator = type === "commercial" ? commercialCalculator : residentialCalculator;
  if (typeof calculator !== "function") {
    throw new Error(`Missing calculator for quote type: ${type}`);
  }

  const rawQuote = calculator(data, region);
  return withQuotePresentation(rawQuote, { type, data });
}
