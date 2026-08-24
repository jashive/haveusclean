// Growth Layer 1.0 / field-level enrichment provenance.
// Every mutable enriched prospect field must resolve through a specific evidence record.

const DIRECT_FACT_FIELDS = new Set([
  "website",
  "normalized_domain",
  "phone",
  "address_line1",
  "postal_code",
  "facility_type",
  "buyer_title_guess",
  "service_need_summary",
]);

const INFERENCE_ALLOWED_FIELDS = new Set([
  "facility_type",
  "buyer_title_guess",
  "service_need_summary",
]);

function text(value) {
  return String(value ?? "").trim();
}

export function validateFieldResolution({ field_name, evidence, decision = "accept" } = {}) {
  const field = text(field_name);
  if (!DIRECT_FACT_FIELDS.has(field)) throw new Error(`Unsupported enriched prospect field: ${field || "missing"}`);
  if (!evidence?.id) throw new Error("Evidence id is required for field resolution.");
  if (!evidence?.evidence_type) throw new Error("Evidence type is required for field resolution.");
  if (!evidence?.field_name) throw new Error("Evidence field_name is required for field resolution.");
  if (!evidence?.source_label && !evidence?.source_url && evidence.evidence_type !== "manual_note") {
    throw new Error("Non-manual enrichment evidence requires source provenance.");
  }
  if (!['accept', 'reject'].includes(decision)) throw new Error("Field resolution decision must be accept or reject.");

  if (evidence.is_inferred && !INFERENCE_ALLOWED_FIELDS.has(field)) {
    throw new Error(`Inferred evidence cannot update ${field}.`);
  }

  if (field === "buyer_title_guess" && evidence.evidence_type === "contact_fact" && evidence.is_inferred) {
    throw new Error("Contact facts cannot be marked inferred.");
  }

  return {
    field_name: field,
    evidence_id: evidence.id,
    decision,
    inferred: Boolean(evidence.is_inferred),
    provenance: {
      evidence_type: evidence.evidence_type,
      source_label: evidence.source_label || null,
      source_url: evidence.source_url || null,
      observed_at: evidence.observed_at || null,
      confidence: evidence.confidence ?? null,
      model_or_agent: evidence.model_or_agent || null,
    },
  };
}

export function canApplyResolvedValue(fieldName, evidence) {
  const field = text(fieldName);
  if (!DIRECT_FACT_FIELDS.has(field)) return false;
  if (!evidence?.id) return false;
  if (evidence.is_inferred && !INFERENCE_ALLOWED_FIELDS.has(field)) return false;
  return true;
}

export function reviewCompletionState({ duplicate_status, accepted_contact = false, current_score = false, enrichment_count = 0 } = {}) {
  const reasons = [];
  if (!['confirmed_unique', 'dismissed', 'not_required'].includes(duplicate_status || 'not_required')) reasons.push('duplicate_review_incomplete');
  if (!accepted_contact) reasons.push('accepted_contact_required');
  if (!current_score) reasons.push('current_score_required');
  if (!(Number(enrichment_count) > 0)) reasons.push('enrichment_evidence_required');
  return {
    can_complete_review: reasons.length === 0,
    reasons,
    next_lifecycle_status: reasons.length === 0 ? 'review_ready' : null,
    outreach_eligible: false,
  };
}
