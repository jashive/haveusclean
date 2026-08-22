// Growth Layer 1.0 / G1 lead-mining adapter.
// Converts the March 2026 Lead Mining workbook shape into the governed Growth schema.
// Canonical organization/business-unit/jurisdiction IDs are injected by configuration;
// this module never creates ServiceOS scope records.

const MARKET = Object.freeze({
  toronto: { country_code: "CA", subdivision_code: "ON", market_key: "ON" },
  mississauga: { country_code: "CA", subdivision_code: "ON", market_key: "ON" },
  brampton: { country_code: "CA", subdivision_code: "ON", market_key: "ON" },
  vaughan: { country_code: "CA", subdivision_code: "ON", market_key: "ON" },
  phoenix: { country_code: "US", subdivision_code: "AZ", market_key: "AZ" },
  scottsdale: { country_code: "US", subdivision_code: "AZ", market_key: "AZ" },
  tempe: { country_code: "US", subdivision_code: "AZ", market_key: "AZ" },
  mesa: { country_code: "US", subdivision_code: "AZ", market_key: "AZ" },
});

const TARGET_SEGMENTS = new Set([
  "property management",
  "property managers",
  "office",
  "offices",
  "corporate office",
  "general office",
  "medical",
  "medical office",
  "clinic",
  "clinics",
  "dental",
  "dental office",
  "industrial-office",
  "industrial office",
  "vacation rental",
  "multi-property operator",
]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function first(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] != null && text(row[key])) return text(row[key]);
  }
  return "";
}

export function normalizeDomain(rawWebsite) {
  const raw = text(rawWebsite);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function normalizeCompanyName(value) {
  return lower(value)
    .replace(/[.,]/g, " ")
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") || null;
}

export function resolveMarket(cityOrMarket) {
  const key = lower(cityOrMarket);
  return MARKET[key] || null;
}

export function normalizeLegacyLead(row, scopeByMarket) {
  const leadId = first(row, "Lead ID", "lead_id");
  const city = first(row, "City", "city", "Market", "market");
  const market = resolveMarket(city) || resolveMarket(first(row, "Market", "market"));
  if (!leadId) throw new Error("Lead ID is required for deterministic legacy import.");
  if (!market) throw new Error(`Unsupported Growth market: ${city || first(row, "Market", "market") || "unknown"}`);

  const scope = scopeByMarket?.[market.market_key];
  if (!scope?.organization_id || !scope?.business_unit_id || !scope?.jurisdiction_id) {
    throw new Error(`Canonical ${market.market_key} Growth scope is not configured.`);
  }

  const companyName = first(row, "Company / Building", "Company", "company_name");
  if (!companyName) throw new Error("Company / Building is required.");

  const website = first(row, "Website", "Normalized Website", "website");
  const normalizedCompany = first(row, "Normalized Company") || normalizeCompanyName(companyName);
  const risk = first(row, "Risk Flag", "Risk Flag(s)");
  const ready = lower(first(row, "Ready for Review"));
  const verification = lower(first(row, "Verification Status"));

  return {
    organization_id: scope.organization_id,
    business_unit_id: scope.business_unit_id,
    jurisdiction_id: scope.jurisdiction_id,
    external_prospect_key: `legacy-lead-mining:${leadId}`,
    lifecycle_status: ready === "yes" || ready === "true" ? "review_ready" : normalizedCompany ? "normalized" : "discovered",
    source_lane: first(row, "Source Lane", "source_lane") || "legacy_lead_mining",
    source_record_id: leadId,
    city,
    subdivision_code: market.subdivision_code,
    country_code: market.country_code,
    company_name: companyName,
    normalized_company_name: normalizedCompany,
    website: website || null,
    normalized_domain: normalizeDomain(website),
    phone: first(row, "Phone", "phone") || null,
    address_line1: first(row, "Address", "address") || null,
    segment: first(row, "Segment", "segment") || "unclassified",
    facility_type: first(row, "Facility Type", "facility_type") || null,
    raw_notes: first(row, "Raw Notes", "Why it is worth reviewing", "raw_notes") || null,
    verification_status: ["verified", "partially_verified", "rejected"].includes(verification) ? verification : "unverified",
    buyer_title_guess: first(row, "Buyer Title Guess", "Buyer Title", "buyer_title_guess") || null,
    service_need_summary: first(row, "Likely Cleaning Need", "service_need_summary") || null,
    risk_flags: risk ? [risk] : [],
    missing_fields: [],
    metadata: {
      legacy_market: first(row, "Market", "market") || city,
      captured_by: first(row, "Captured By", "captured_by") || null,
      duplicate_review: first(row, "Duplicate?", "duplicate") || null,
      review_decision: first(row, "Decision", "decision") || null,
      review_next_step: first(row, "Next Step", "next_step") || null,
    },
    captured_at: first(row, "Captured Date", "captured_at") || undefined,
  };
}

function completenessScore(p) {
  const fields = [p.company_name, p.city, p.segment, p.website, p.phone, p.address_line1, p.normalized_domain, p.buyer_title_guess];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

export function scoreProspectV1(prospect, { verifiedContact = false, positiveIntent = false } = {}) {
  const segment = lower(prospect?.segment);
  const icp = TARGET_SEGMENTS.has(segment) ? 100 : segment === "unclassified" ? 25 : 50;
  const quality = completenessScore(prospect || {});
  const contactability = verifiedContact ? 100 : prospect?.phone && prospect?.website ? 70 : prospect?.phone || prospect?.website ? 45 : 10;
  // AI must not infer buying intent. Positive intent is supplied only by verified response/call/manual evidence.
  const intent = positiveIntent ? 100 : 0;
  const total = Math.round((icp * 0.4 + quality * 0.3 + contactability * 0.2 + intent * 0.1) * 100) / 100;
  return {
    score_version: "g1-rules-v1",
    icp_fit_score: icp,
    data_quality_score: quality,
    contactability_score: contactability,
    intent_score: intent,
    total_score: total,
    segment_fit: icp === 100 ? "primary_icp" : icp >= 50 ? "adjacent" : "weak",
    rationale: { formula: "40% ICP + 30% data quality + 20% contactability + 10% verified intent", intent_inference_prohibited: true },
    scored_by: "growth_g1_rules",
  };
}
