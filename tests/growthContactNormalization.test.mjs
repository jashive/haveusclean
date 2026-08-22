import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizePhone,
  normalizeLinkedIn,
  normalizeContactCandidate,
  contactIdentityKeys,
  evidenceFromContact,
  contactReadiness,
} from '../src/growth/g1ContactNormalization.js';

const scope = {
  prospect_id: '11111111-1111-1111-1111-111111111111',
  organization_id: '22222222-2222-2222-2222-222222222222',
  business_unit_id: '33333333-3333-3333-3333-333333333333',
  jurisdiction_id: '44444444-4444-4444-4444-444444444444',
};

test('normalizes email, North American phone and LinkedIn URL', () => {
  assert.equal(normalizeEmail(' Buyer@Example.COM '), 'buyer@example.com');
  assert.equal(normalizePhone('+1 (416) 555-1212'), '4165551212');
  assert.equal(normalizeLinkedIn('linkedin.com/in/jane-doe/?trk=test#top'), 'https://linkedin.com/in/jane-doe');
});

test('contact candidate fails closed without reachable identity', () => {
  assert.throws(() => normalizeContactCandidate({ first_name: 'Jane' }, scope), /valid email, phone, or LinkedIn/);
});

test('contact candidate requires canonical prospect scope', () => {
  assert.throws(() => normalizeContactCandidate({ email: 'jane@example.com' }, {}), /Canonical Growth prospect scope/);
});

test('normalizes candidate and preserves original source values in metadata', () => {
  const c = normalizeContactCandidate({
    first_name: ' Jane ',
    last_name: ' Doe ',
    buyer_title: 'Property Manager',
    email: ' Jane.Doe@Example.com ',
    phone: '(602) 555-0100',
    linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
    contact_source: 'company website',
    source_url: 'https://example.com/team',
    verification_status: 'verified',
  }, scope);

  assert.equal(c.email, 'jane.doe@example.com');
  assert.equal(c.phone, '6025550100');
  assert.equal(c.linkedin_url, 'https://www.linkedin.com/in/jane-doe');
  assert.equal(c.metadata.normalization_version, 'g1-contact-v1');
  assert.equal(c.metadata.original_email, 'Jane.Doe@Example.com');
});

test('identity keys are deterministic', () => {
  const keys = contactIdentityKeys({
    email: 'BUYER@example.com',
    phone: '+1 416 555 1212',
    linkedin_url: 'https://linkedin.com/in/buyer/',
  });
  assert.deepEqual(keys, [
    'email:buyer@example.com',
    'phone:4165551212',
    'linkedin:https://linkedin.com/in/buyer',
  ]);
});

test('contact evidence is factual and never inferred', () => {
  const c = normalizeContactCandidate({
    first_name: 'Jane',
    email: 'jane@example.com',
    contact_source: 'company website',
    source_url: 'https://example.com/team',
    verification_status: 'verified',
  }, scope);
  const evidence = evidenceFromContact(c, { observed_at: '2026-08-22T12:00:00Z' });
  assert.ok(evidence.length >= 2);
  assert.ok(evidence.every((e) => e.evidence_type === 'contact_fact'));
  assert.ok(evidence.every((e) => e.is_inferred === false));
  assert.ok(evidence.every((e) => e.model_or_agent === null));
});

test('reachable contact still cannot auto-enable outreach', () => {
  const state = contactReadiness({ email: 'jane@example.com', verification_status: 'verified' });
  assert.equal(state.reachable, true);
  assert.equal(state.ready_for_human_review, true);
  assert.equal(state.ready_for_outreach, false);
});
