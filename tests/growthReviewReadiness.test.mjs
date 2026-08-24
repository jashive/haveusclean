import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMissingFields, determineReviewReadiness } from '../src/growth/g1ReviewReadiness.js';

const base = {
  company_name: 'Acme Dental',
  normalized_company_name: 'acme dental',
  city: 'Toronto',
  segment: 'dental',
  country_code: 'CA',
  business_unit_id: 'bu-1',
  jurisdiction_id: 'jur-1',
  normalized_domain: 'acmedental.ca',
  website: 'https://acmedental.ca',
  phone: '9055551212',
  address_line1: '1 Main St',
  buyer_title_guess: 'Office Manager',
  service_need_summary: 'Recurring janitorial cleaning',
};

test('missing required normalization field fails closed at discovered', () => {
  const prospect = { ...base, business_unit_id: '' };
  const result = determineReviewReadiness(prospect, { classification: 'unique' }, { hasEnrichmentEvidence: true, hasCurrentScore: true });
  assert.equal(result.lifecycle_status, 'discovered');
  assert.equal(result.review_ready, false);
  assert.ok(result.missing_fields.includes('business_unit_id'));
});

test('exact duplicate becomes suppressed', () => {
  const result = determineReviewReadiness(base, { classification: 'exact_duplicate' }, { hasEnrichmentEvidence: true, hasCurrentScore: true });
  assert.equal(result.lifecycle_status, 'suppressed');
  assert.equal(result.review_ready, false);
});

test('probable duplicate is routed to human review and never auto-outreach', () => {
  const result = determineReviewReadiness(base, { classification: 'probable_duplicate' }, { hasEnrichmentEvidence: true, hasCurrentScore: true });
  assert.equal(result.lifecycle_status, 'review_ready');
  assert.equal(result.review_ready, true);
  assert.equal(result.outreach_eligible, false);
});

test('unique prospect without evidence remains normalized', () => {
  const result = determineReviewReadiness(base, { classification: 'unique' }, { hasEnrichmentEvidence: false, hasCurrentScore: false });
  assert.equal(result.lifecycle_status, 'normalized');
  assert.equal(result.review_ready, false);
});

test('enriched prospect without score remains enriched', () => {
  const result = determineReviewReadiness(base, { classification: 'unique' }, { hasEnrichmentEvidence: true, hasCurrentScore: false });
  assert.equal(result.lifecycle_status, 'enriched');
});

test('scored unique prospect reaches human review, not outreach eligibility', () => {
  const result = determineReviewReadiness(base, { classification: 'unique' }, { hasEnrichmentEvidence: true, hasCurrentScore: true });
  assert.equal(result.lifecycle_status, 'review_ready');
  assert.equal(result.review_ready, true);
  assert.equal(result.outreach_eligible, false);
});

test('missing desired fields are preserved as review metadata', () => {
  const prospect = { ...base, buyer_title_guess: null, service_need_summary: null };
  const missing = computeMissingFields(prospect);
  assert.ok(missing.includes('buyer_title_guess'));
  assert.ok(missing.includes('service_need_summary'));
});
