export const G4_HANDOFF_POLICY_VERSION = 'g4-handoff-preflight-2026-08-25';

const text = (value) => String(value ?? '').trim();

export function evaluateGrowthServiceOSHandoffPreflight(input = {}) {
  const blockers = [];
  const warnings = [];

  const candidate = input.handoffCandidate ?? {};
  const prospect = input.prospect ?? {};
  const contact = input.contactCandidate ?? {};
  const qualification = input.qualificationReview ?? {};

  if (input.growthLayerEnabled !== true) blockers.push('growth_layer_disabled');
  if (!text(candidate.id)) blockers.push('handoff_candidate_missing');
  if (!text(prospect.id)) blockers.push('prospect_missing');
  if (!text(contact.id)) blockers.push('contact_candidate_missing');
  if (!text(qualification.id)) blockers.push('qualification_review_missing');

  const scope = [
    ['organization_id', input.organizationId, candidate.organization_id, prospect.organization_id, contact.organization_id, qualification.organization_id],
    ['business_unit_id', input.businessUnitId, candidate.business_unit_id, prospect.business_unit_id, contact.business_unit_id, qualification.business_unit_id],
    ['jurisdiction_id', input.jurisdictionId, candidate.jurisdiction_id, prospect.jurisdiction_id, contact.jurisdiction_id, qualification.jurisdiction_id],
  ];

  for (const [name, expected, ...values] of scope) {
    if (!text(expected)) {
      blockers.push(`${name}_missing`);
      continue;
    }
    if (values.some((value) => text(value) !== text(expected))) blockers.push(`${name}_scope_mismatch`);
  }

  if (text(candidate.prospect_id) !== text(prospect.id)) blockers.push('candidate_prospect_mismatch');
  if (text(contact.prospect_id) !== text(prospect.id)) blockers.push('contact_prospect_mismatch');
  if (text(qualification.prospect_id) !== text(prospect.id)) blockers.push('qualification_prospect_mismatch');
  if (text(qualification.contact_candidate_id) !== text(contact.id)) blockers.push('qualification_contact_mismatch');

  if (candidate.status !== 'draft' && candidate.status !== 'ready') blockers.push('handoff_candidate_not_current');
  if (prospect.lifecycle_status !== 'handoff_ready') blockers.push('prospect_not_handoff_ready');
  if (qualification.decision !== 'qualified') blockers.push('human_qualification_not_current');
  if (qualification.verified_service_need !== true) blockers.push('verified_service_need_required');
  if (qualification.supported_geography !== true) blockers.push('supported_geography_required');
  if (qualification.verified_reachable_contact !== true) blockers.push('verified_reachable_contact_required');
  if (!text(qualification.reviewer_app_user_id)) blockers.push('human_reviewer_required');

  if (contact.review_status !== 'accepted') blockers.push('contact_not_accepted');
  if (contact.verification_status !== 'verified') blockers.push('contact_not_verified');
  if (!text(contact.email) && !text(contact.phone)) blockers.push('reachable_contact_identity_missing');

  if (input.activeSuppression === true) blockers.push('active_suppression');
  if (input.latestReplyClassification === 'opt_out') blockers.push('latest_reply_opt_out');
  if (['nurture', 'suppressed', 'disqualified'].includes(input.latestQualificationState)) blockers.push('terminal_growth_state');

  if (candidate.handoff_payload?.g4_required !== true) blockers.push('g4_required_marker_missing');
  if (candidate.handoff_payload?.serviceos_handoff_authorized !== false) blockers.push('pre_g4_authorization_boundary_invalid');

  const existingIds = [
    candidate.serviceos_customer_id,
    candidate.serviceos_contact_id,
    candidate.serviceos_location_id,
    candidate.serviceos_service_request_id,
    candidate.serviceos_opportunity_id,
  ].filter(Boolean);
  if (existingIds.length > 0) blockers.push('canonical_serviceos_ids_already_present');

  if (!text(candidate.idempotency_key)) blockers.push('growth_idempotency_key_missing');
  if (input.canonicalExternalReferenceConflict === true) blockers.push('canonical_external_reference_conflict');
  if (input.canonicalIdempotencyConflict === true) blockers.push('canonical_idempotency_conflict');

  if (input.sourceAttributionResolved !== true) blockers.push('source_attribution_required');
  if (input.jurisdictionResolved !== true) blockers.push('jurisdiction_resolution_required');

  const handoffGateEnabled = input.serviceOSHandoffEnabled === true;
  if (!handoffGateEnabled) warnings.push('serviceos_handoff_gate_disabled');

  return {
    status: blockers.length > 0 ? 'BLOCKED' : handoffGateEnabled ? 'READY_FOR_GOVERNED_HANDOFF' : 'READY_EXCEPT_HANDOFF_GATE',
    blockers,
    warnings,
    policyVersion: G4_HANDOFF_POLICY_VERSION,
    serviceosMutationAuthorized: blockers.length === 0 && handoffGateEnabled,
  };
}
