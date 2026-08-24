import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateG2OutreachEligibility, G2_POLICY_VERSION } from '../src/growth/g2OutreachEligibility.js';

const base = (overrides = {}) => ({
  organization_id: '11111111-1111-1111-1111-111111111111',
  business_unit_id: '22222222-2222-2222-2222-222222222222',
  jurisdiction_id: '33333333-3333-3333-3333-333333333333',
  country_code: 'US',
  subdivision_code: 'AZ',
  channel: 'email',
  contact_verified: true,
  contact_reachable: true,
  contact_inferred_only: false,
  growth_layer_enabled: true,
  growth_outreach_enabled: true,
  suppressed: false,
  unsubscribed: false,
  hard_bounce: false,
  complaint: false,
  replied: false,
  frequency_cap_exceeded: false,
  cooldown_active: false,
  sender_identity_configured: true,
  postal_address_configured: true,
  unsubscribe_mechanism_configured: true,
  human_approved: true,
  ...overrides,
});

test('Arizona controlled email can pass only when every foundation control passes', () => {
  const result = evaluateG2OutreachEligibility(base());
  assert.equal(result.eligible, true);
  assert.equal(result.decision_code, 'ELIGIBLE_FOR_CONTROLLED_EMAIL');
  assert.equal(result.policy_version, G2_POLICY_VERSION);
  assert.equal(result.requires_human_approval, true);
});

test('outreach gate OFF fails closed even when all other controls pass', () => {
  const result = evaluateG2OutreachEligibility(base({ growth_outreach_enabled: false }));
  assert.equal(result.eligible, false);
  assert.ok(result.blocking_reasons.includes('outreach_gate_disabled'));
});

test('Ontario email fails closed without documented CASL basis', () => {
  const result = evaluateG2OutreachEligibility(base({ country_code: 'CA', subdivision_code: 'ON' }));
  assert.equal(result.eligible, false);
  assert.ok(result.blocking_reasons.includes('casl_basis_required'));
});

test('Ontario email may pass with documented express or implied basis evidence', () => {
  for (const consent_basis of ['express', 'implied']) {
    const result = evaluateG2OutreachEligibility(base({
      country_code: 'CA',
      subdivision_code: 'ON',
      consent_basis,
      consent_evidence_ref: `evidence:${consent_basis}`,
    }));
    assert.equal(result.eligible, true);
  }
});

test('SMS and phone are explicitly unauthorized by G2 foundation', () => {
  const sms = evaluateG2OutreachEligibility(base({ channel: 'sms' }));
  assert.equal(sms.eligible, false);
  assert.ok(sms.blocking_reasons.includes('sms_not_authorized'));

  const phone = evaluateG2OutreachEligibility(base({ channel: 'phone' }));
  assert.equal(phone.eligible, false);
  assert.ok(phone.blocking_reasons.includes('phone_not_authorized'));
});

test('inferred-only or unreachable contact fails closed', () => {
  const inferred = evaluateG2OutreachEligibility(base({ contact_inferred_only: true }));
  assert.ok(inferred.blocking_reasons.includes('verified_reachable_contact_required'));

  const unreachable = evaluateG2OutreachEligibility(base({ contact_reachable: false }));
  assert.ok(unreachable.blocking_reasons.includes('verified_reachable_contact_required'));
});

test('suppression, unsubscribe, bounce, complaint and reply each block outreach', () => {
  const flags = [
    ['suppressed', 'suppressed'],
    ['unsubscribed', 'unsubscribed'],
    ['hard_bounce', 'hard_bounce'],
    ['complaint', 'complaint'],
    ['replied', 'reply_received'],
  ];
  for (const [field, reason] of flags) {
    const result = evaluateG2OutreachEligibility(base({ [field]: true }));
    assert.equal(result.eligible, false);
    assert.ok(result.blocking_reasons.includes(reason));
  }
});

test('human approval remains mandatory for controlled pilot email', () => {
  const result = evaluateG2OutreachEligibility(base({ human_approved: false }));
  assert.equal(result.eligible, false);
  assert.ok(result.blocking_reasons.includes('human_approval_required'));
});

test('unsupported jurisdictions fail closed', () => {
  const result = evaluateG2OutreachEligibility(base({ country_code: 'US', subdivision_code: 'CA' }));
  assert.equal(result.eligible, false);
  assert.ok(result.blocking_reasons.includes('unsupported_jurisdiction'));
});
