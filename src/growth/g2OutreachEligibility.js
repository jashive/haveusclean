// Growth Layer 1.0 — G2 controlled outreach eligibility.
// Pure deterministic policy logic only. No sends, writes, or ServiceOS handoff.

export const G2_POLICY_VERSION = 'g2-foundation-2026-08-23';

const EMAIL = 'email';
const SMS = 'sms';
const PHONE = 'phone';

function text(value) {
  return String(value ?? '').trim();
}

function bool(value) {
  return value === true;
}

function normalizedChannel(value) {
  return text(value).toLowerCase();
}

function normalizedCountry(value) {
  return text(value).toUpperCase();
}

function normalizedSubdivision(value) {
  return text(value).toUpperCase();
}

function hasVerifiedReachableContact(input) {
  return bool(input.contact_verified) && bool(input.contact_reachable) && !bool(input.contact_inferred_only);
}

function hasCaslBasis(input) {
  const basis = text(input.consent_basis).toLowerCase();
  const evidence = text(input.consent_evidence_ref);
  return ['express', 'implied', 'exempt'].includes(basis) && Boolean(evidence);
}

export function evaluateG2OutreachEligibility(input = {}) {
  const blocking_reasons = [];
  const channel = normalizedChannel(input.channel);
  const country = normalizedCountry(input.country_code);
  const subdivision = normalizedSubdivision(input.subdivision_code);

  if (!text(input.organization_id)) blocking_reasons.push('organization_missing');
  if (!text(input.business_unit_id)) blocking_reasons.push('business_unit_missing');
  if (!text(input.jurisdiction_id)) blocking_reasons.push('jurisdiction_missing');

  if (!bool(input.growth_layer_enabled)) blocking_reasons.push('growth_layer_disabled');
  if (!bool(input.growth_outreach_enabled)) blocking_reasons.push('outreach_gate_disabled');

  if (![EMAIL, SMS, PHONE].includes(channel)) blocking_reasons.push('unsupported_channel');

  // G2 foundation authorizes eligibility evaluation for email only.
  if (channel === SMS) blocking_reasons.push('sms_not_authorized');
  if (channel === PHONE) blocking_reasons.push('phone_not_authorized');

  if (!hasVerifiedReachableContact(input)) blocking_reasons.push('verified_reachable_contact_required');

  if (bool(input.suppressed)) blocking_reasons.push('suppressed');
  if (bool(input.unsubscribed)) blocking_reasons.push('unsubscribed');
  if (bool(input.hard_bounce)) blocking_reasons.push('hard_bounce');
  if (bool(input.complaint)) blocking_reasons.push('complaint');
  if (bool(input.replied)) blocking_reasons.push('reply_received');
  if (bool(input.frequency_cap_exceeded)) blocking_reasons.push('frequency_cap_exceeded');
  if (bool(input.cooldown_active)) blocking_reasons.push('cooldown_active');

  if (!bool(input.sender_identity_configured)) blocking_reasons.push('sender_identity_missing');
  if (!bool(input.postal_address_configured)) blocking_reasons.push('postal_address_missing');
  if (!bool(input.unsubscribe_mechanism_configured)) blocking_reasons.push('unsubscribe_mechanism_missing');

  // Canada / Ontario commercial electronic messages fail closed without documented CASL basis.
  if (country === 'CA' && subdivision === 'ON' && channel === EMAIL && !hasCaslBasis(input)) {
    blocking_reasons.push('casl_basis_required');
  }

  // This foundation only recognizes governed ON and AZ scopes.
  const supportedScope =
    (country === 'CA' && subdivision === 'ON') ||
    (country === 'US' && subdivision === 'AZ');
  if (!supportedScope) blocking_reasons.push('unsupported_jurisdiction');

  // Pilot sends remain human-approved even after all other controls pass.
  if (!bool(input.human_approved)) blocking_reasons.push('human_approval_required');

  return {
    eligible: blocking_reasons.length === 0,
    decision_code: blocking_reasons.length === 0 ? 'ELIGIBLE_FOR_CONTROLLED_EMAIL' : 'BLOCKED',
    blocking_reasons,
    policy_version: G2_POLICY_VERSION,
    requires_human_approval: true,
    channel,
  };
}
