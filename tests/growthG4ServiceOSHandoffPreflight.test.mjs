import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGrowthServiceOSHandoffPreflight } from '../src/growth/g4ServiceOSHandoffPreflight.js';

const base = {
  growthLayerEnabled: true,
  serviceOSHandoffEnabled: false,
  organizationId: 'org-1',
  businessUnitId: 'bu-1',
  jurisdictionId: 'jur-1',
  jurisdictionResolved: true,
  sourceAttributionResolved: true,
  activeSuppression: false,
  latestReplyClassification: 'positive_interest',
  latestQualificationState: 'handoff_candidate',
  canonicalExternalReferenceConflict: false,
  canonicalIdempotencyConflict: false,
  prospect: {
    id: 'prospect-1', organization_id: 'org-1', business_unit_id: 'bu-1', jurisdiction_id: 'jur-1', lifecycle_status: 'handoff_ready',
  },
  contactCandidate: {
    id: 'contact-1', prospect_id: 'prospect-1', organization_id: 'org-1', business_unit_id: 'bu-1', jurisdiction_id: 'jur-1',
    review_status: 'accepted', verification_status: 'verified', email: 'buyer@example.invalid',
  },
  qualificationReview: {
    id: 'review-1', prospect_id: 'prospect-1', contact_candidate_id: 'contact-1', organization_id: 'org-1', business_unit_id: 'bu-1', jurisdiction_id: 'jur-1',
    decision: 'qualified', verified_service_need: true, supported_geography: true, verified_reachable_contact: true, reviewer_app_user_id: 'user-1',
  },
  handoffCandidate: {
    id: 'handoff-1', prospect_id: 'prospect-1', organization_id: 'org-1', business_unit_id: 'bu-1', jurisdiction_id: 'jur-1', status: 'draft',
    idempotency_key: 'g3:review-1', handoff_payload: { g4_required: true, serviceos_handoff_authorized: false },
    serviceos_customer_id: null, serviceos_contact_id: null, serviceos_location_id: null, serviceos_service_request_id: null, serviceos_opportunity_id: null,
  },
};

const evaluate = (patch = {}) => evaluateGrowthServiceOSHandoffPreflight({ ...base, ...patch });

test('fully qualified candidate stays READY_EXCEPT_HANDOFF_GATE while gate is off', () => {
  const result = evaluate();
  assert.equal(result.status, 'READY_EXCEPT_HANDOFF_GATE');
  assert.equal(result.serviceosMutationAuthorized, false);
  assert.deepEqual(result.blockers, []);
  assert.ok(result.warnings.includes('serviceos_handoff_gate_disabled'));
});

test('handoff gate alone cannot overcome qualification blocker', () => {
  const result = evaluate({ serviceOSHandoffEnabled: true, activeSuppression: true });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.serviceosMutationAuthorized, false);
  assert.ok(result.blockers.includes('active_suppression'));
});

test('all controls plus handoff gate produce governed-ready state only', () => {
  const result = evaluate({ serviceOSHandoffEnabled: true });
  assert.equal(result.status, 'READY_FOR_GOVERNED_HANDOFF');
  assert.equal(result.serviceosMutationAuthorized, true);
});

test('opt-out blocks even with positive historical qualification', () => {
  const result = evaluate({ latestReplyClassification: 'opt_out' });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('latest_reply_opt_out'));
});

test('terminal Growth state blocks handoff', () => {
  for (const state of ['nurture', 'suppressed', 'disqualified']) {
    const result = evaluate({ latestQualificationState: state });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes('terminal_growth_state'));
  }
});

test('scope mismatches block', () => {
  const result = evaluate({ prospect: { ...base.prospect, business_unit_id: 'bu-other' } });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('business_unit_id_scope_mismatch'));
});

test('existing ServiceOS IDs block duplicate canonical mutation', () => {
  const result = evaluate({ handoffCandidate: { ...base.handoffCandidate, serviceos_service_request_id: 'sr-existing' } });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('canonical_serviceos_ids_already_present'));
});

test('canonical external-reference or idempotency conflicts block', () => {
  assert.ok(evaluate({ canonicalExternalReferenceConflict: true }).blockers.includes('canonical_external_reference_conflict'));
  assert.ok(evaluate({ canonicalIdempotencyConflict: true }).blockers.includes('canonical_idempotency_conflict'));
});

test('pre-G4 authorization marker cannot be forged true', () => {
  const result = evaluate({ handoffCandidate: { ...base.handoffCandidate, handoff_payload: { g4_required: true, serviceos_handoff_authorized: true } } });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('pre_g4_authorization_boundary_invalid'));
});

test('human qualification requirements remain mandatory', () => {
  const result = evaluate({ qualificationReview: { ...base.qualificationReview, verified_service_need: false } });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('verified_service_need_required'));
});
