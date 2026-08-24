import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyLead, normalizeDomain, scoreProspectV1 } from '../src/growth/g1LeadMining.js';

const scopes = {
  ON: { organization_id: '11111111-1111-4111-8111-111111111111', business_unit_id: '22222222-2222-4222-8222-222222222222', jurisdiction_id: '33333333-3333-4333-8333-333333333333' },
  AZ: { organization_id: '11111111-1111-4111-8111-111111111111', business_unit_id: '44444444-4444-4444-8444-444444444444', jurisdiction_id: '55555555-5555-4555-8555-555555555555' },
};

test('legacy Ontario lead maps to CA/ON and never invents ServiceOS revenue state', () => {
  const p = normalizeLegacyLead({
    'Lead ID': 'ON-001', Market: 'Mississauga', City: 'Mississauga', 'Source Lane': 'Google Maps',
    'Company / Building': 'Mississauga Executive Centre Inc.', Segment: 'Property managers',
    Website: 'https://www.example.ca/path', Phone: '905-555-0100', Address: '1 Example Rd',
    'Verification Status': 'Verified', 'Buyer Title Guess': 'Property Manager', 'Likely Cleaning Need': 'Recurring janitorial',
    'Ready for Review': 'Yes'
  }, scopes);
  assert.equal(p.country_code, 'CA');
  assert.equal(p.subdivision_code, 'ON');
  assert.equal(p.business_unit_id, scopes.ON.business_unit_id);
  assert.equal(p.lifecycle_status, 'review_ready');
  assert.equal(p.external_prospect_key, 'legacy-lead-mining:ON-001');
  assert.equal(p.normalized_domain, 'example.ca');
  assert.ok(!['quoted','won','lost'].includes(p.lifecycle_status));
});

test('legacy Arizona lead maps to US/AZ', () => {
  const p = normalizeLegacyLead({
    'Lead ID': 'AZ-001', Market: 'Phoenix', City: 'Phoenix', 'Source Lane': 'Medical Directories',
    'Company / Building': 'Phoenix Medical Office', Segment: 'medical', Website: 'phoenix.example.com'
  }, scopes);
  assert.equal(p.country_code, 'US');
  assert.equal(p.subdivision_code, 'AZ');
  assert.equal(p.business_unit_id, scopes.AZ.business_unit_id);
});

test('normalizer fails closed when canonical market scope is missing', () => {
  assert.throws(() => normalizeLegacyLead({
    'Lead ID': 'ON-002', Market: 'Toronto', City: 'Toronto', 'Company / Building': 'Toronto Office', Segment: 'office'
  }, { AZ: scopes.AZ }), /Canonical ON Growth scope is not configured/);
});

test('domain normalization strips protocol, path and www', () => {
  assert.equal(normalizeDomain('https://www.Example.com/a/b'), 'example.com');
});

test('G1 scoring never infers intent from ICP fit', () => {
  const score = scoreProspectV1({ segment: 'medical', company_name: 'Clinic', city: 'Toronto', website: 'https://clinic.ca', phone: '416-555-0100' });
  assert.equal(score.icp_fit_score, 100);
  assert.equal(score.intent_score, 0);
  assert.equal(score.rationale.intent_inference_prohibited, true);
});
