// Growth Layer 1.0 / G1 deterministic duplicate resolution.
// This module produces explainable duplicate classifications. AI/LLMs are not used.

function text(value) {
  return String(value ?? "").trim();
}

export function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function normalizeAddress(value) {
  return text(value)
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(suite|unit)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") || null;
}

function same(a, b) {
  return !!a && !!b && a === b;
}

function normalizedRecord(record) {
  return {
    id: record?.id ?? null,
    organization_id: record?.organization_id ?? null,
    business_unit_id: record?.business_unit_id ?? null,
    jurisdiction_id: record?.jurisdiction_id ?? null,
    company: text(record?.normalized_company_name || record?.company_name).toLowerCase() || null,
    domain: text(record?.normalized_domain).toLowerCase() || null,
    phone: normalizePhone(record?.phone),
    address: normalizeAddress(record?.address_line1),
    city: text(record?.city).toLowerCase() || null,
    postal_code: text(record?.postal_code).toLowerCase().replace(/\s+/g, "") || null,
  };
}

export function classifyDuplicate(candidate, existing) {
  const a = normalizedRecord(candidate);
  const b = normalizedRecord(existing);

  if (a.id && b.id && a.id === b.id) return null;
  if (!same(a.organization_id, b.organization_id)) return null;
  if (!same(a.business_unit_id, b.business_unit_id)) return null;
  if (!same(a.jurisdiction_id, b.jurisdiction_id)) return null;

  const signals = {
    company: same(a.company, b.company),
    domain: same(a.domain, b.domain),
    phone: same(a.phone, b.phone),
    address: same(a.address, b.address),
    city: same(a.city, b.city),
    postal_code: same(a.postal_code, b.postal_code),
  };

  const strongIdentityCount = [signals.domain, signals.phone, signals.address, signals.postal_code].filter(Boolean).length;

  let classification = "unique";
  let confidence = 0;

  // Exact duplicate requires company identity plus at least one strong identity signal,
  // or two independent strong identity signals. Domain alone is not exact because one
  // property manager/company domain can legitimately own many service locations.
  if ((signals.company && strongIdentityCount >= 1) || strongIdentityCount >= 2) {
    classification = "exact_duplicate";
    confidence = signals.company && strongIdentityCount >= 2 ? 1 : 0.95;
  } else if (
    signals.domain ||
    signals.phone ||
    (signals.company && signals.city) ||
    (signals.address && signals.city)
  ) {
    classification = "probable_duplicate";
    confidence = signals.company && signals.city ? 0.8 : 0.75;
  } else if (signals.company || signals.address || signals.postal_code) {
    classification = "review_required";
    confidence = 0.5;
  }

  return {
    candidate_prospect_id: a.id,
    matched_prospect_id: b.id,
    classification,
    confidence,
    evidence: signals,
    algorithm_version: "g1-duplicate-v1",
  };
}

const PRIORITY = {
  exact_duplicate: 3,
  probable_duplicate: 2,
  review_required: 1,
  unique: 0,
};

export function resolveDuplicate(candidate, existingProspects = []) {
  const matches = existingProspects
    .map((existing) => classifyDuplicate(candidate, existing))
    .filter(Boolean)
    .filter((match) => match.classification !== "unique")
    .sort((a, b) =>
      PRIORITY[b.classification] - PRIORITY[a.classification] ||
      b.confidence - a.confidence
    );

  if (!matches.length) {
    return {
      classification: "unique",
      confidence: 1,
      matched_prospect_id: null,
      evidence: {},
      algorithm_version: "g1-duplicate-v1",
      candidates: [],
    };
  }

  return { ...matches[0], candidates: matches };
}

export function lifecycleAfterDuplicateReview(currentStatus, classification) {
  if (classification === "exact_duplicate") return "suppressed";
  if (classification === "probable_duplicate" || classification === "review_required") return "review_ready";
  if (["discovered", "normalized"].includes(currentStatus)) return currentStatus;
  return currentStatus || "normalized";
}
