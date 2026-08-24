// Growth Layer 1.0 / G1 review-readiness rules.
// Deterministic, explainable, and independent of outbound/handoff activation.

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return String(value ?? '').trim().length > 0;
}

export const REQUIRED_FOR_NORMALIZED = Object.freeze([
  'company_name',
  'city',
  'segment',
  'country_code',
  'business_unit_id',
  'jurisdiction_id',
]);

export const DESIRED_FOR_REVIEW = Object.freeze([
  'normalized_company_name',
  'normalized_domain',
  'phone',
  'address_line1',
  'website',
  'buyer_title_guess',
  'service_need_summary',
]);

export function computeMissingFields(prospect) {
  return [...REQUIRED_FOR_NORMALIZED, ...DESIRED_FOR_REVIEW].filter((field) => !present(prospect?.[field]));
}

export function determineReviewReadiness(prospect, duplicateResolution, { hasEnrichmentEvidence = false, hasCurrentScore = false } = {}) {
  const missingFields = computeMissingFields(prospect);
  const missingRequired = REQUIRED_FOR_NORMALIZED.filter((field) => missingFields.includes(field));
  const duplicateClass = duplicateResolution?.classification || 'unreviewed';

  if (missingRequired.length) {
    return {
      lifecycle_status: 'discovered',
      review_ready: false,
      outreach_eligible: false,
      missing_fields: missingFields,
      reasons: ['missing_required_normalization_fields'],
    };
  }

  if (duplicateClass === 'exact_duplicate') {
    return {
      lifecycle_status: 'suppressed',
      review_ready: false,
      outreach_eligible: false,
      missing_fields: missingFields,
      reasons: ['exact_duplicate'],
    };
  }

  if (duplicateClass === 'probable_duplicate' || duplicateClass === 'review_required') {
    return {
      lifecycle_status: 'review_ready',
      review_ready: true,
      outreach_eligible: false,
      missing_fields: missingFields,
      reasons: ['duplicate_requires_human_review'],
    };
  }

  if (!hasEnrichmentEvidence) {
    return {
      lifecycle_status: 'normalized',
      review_ready: false,
      outreach_eligible: false,
      missing_fields: missingFields,
      reasons: ['enrichment_evidence_required'],
    };
  }

  if (!hasCurrentScore) {
    return {
      lifecycle_status: 'enriched',
      review_ready: false,
      outreach_eligible: false,
      missing_fields: missingFields,
      reasons: ['current_score_required'],
    };
  }

  return {
    lifecycle_status: 'review_ready',
    review_ready: true,
    outreach_eligible: false,
    missing_fields: missingFields,
    reasons: missingFields.length ? ['human_review_with_missing_desired_fields'] : ['ready_for_human_review'],
  };
}
