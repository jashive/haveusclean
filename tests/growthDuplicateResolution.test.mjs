import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDuplicate,
  lifecycleAfterDuplicateReview,
  normalizeAddress,
  normalizePhone,
  resolveDuplicate,
} from '../src/growth/g1DuplicateResolution.js';

const scope = {
  organization_id: 'org-1',
  business_unit_id: 'bu-1',
  jurisdiction_id: 'jur-1',
};

test('normalizes North American phone numbers', () => {
  assert.equal(normalizePhone('(905) 555-1212'), '9055551212');
  assert.equal(normalizePhone('+1 905 555 1212'), '9055551212');
});

test('normalizes common address suffixes', () => {
  assert.equal(normalizeAddress('1956 Shannon Drive, Unit 4'), '1956 shannon dr 4');
});

test('classifies same company plus same domain as exact duplicate', () => {
  const result = classifyDuplicate(
    { ...scope, id: 'a', company_name: 'Acme Property Management Inc.', normalized_company_name: 'acme property management', normalized_domain: 'acme.ca' },
    { ...scope, id: 'b', company_name: 'Acme Property Management', normalized_company_name: 'acme property management', normalized_domain: 'acme.ca' },
  );
  assert.equal(result.classification, 'exact_duplicate');
  assert.equal(result.matched_prospect_id, 'b');
});

test('domain match alone is probable, not exact', () => {
  const result = classifyDuplicate(
    { ...scope, id: 'a', company_name: 'Acme Building A', normalized_company_name: 'acme building a', normalized_domain: 'acme.ca' },
    { ...scope, id: 'b', company_name: 'Acme Building B', normalized_company_name: 'acme building b', normalized_domain: 'acme.ca' },
  );
  assert.equal(result.classification, 'probable_duplicate');
});

test('company plus city creates probable duplicate', () => {
  const result = classifyDuplicate(
    { ...scope, id: 'a', normalized_company_name: 'example dental', city: 'Toronto' },
    { ...scope, id: 'b', normalized_company_name: 'example dental', city: 'Toronto' },
  );
  assert.equal(result.classification, 'probable_duplicate');
});

test('single weak company match requires review', () => {
  const result = classifyDuplicate(
    { ...scope, id: 'a', normalized_company_name: 'example dental', city: 'Toronto' },
    { ...scope, id: 'b', normalized_company_name: 'example dental', city: 'Mississauga' },
  );
  assert.equal(result.classification, 'review_required');
});

test('different canonical scope cannot be considered a duplicate', () => {
  const result = classifyDuplicate(
    { ...scope, id: 'a', normalized_company_name: 'same company', normalized_domain: 'same.com' },
    { ...scope, business_unit_id: 'bu-2', id: 'b', normalized_company_name: 'same company', normalized_domain: 'same.com' },
  );
  assert.equal(result, null);
});

test('resolver returns highest-risk duplicate candidate', () => {
  const candidate = { ...scope, id: 'a', normalized_company_name: 'acme', normalized_domain: 'acme.com', phone: '9055551212' };
  const result = resolveDuplicate(candidate, [
    { ...scope, id: 'b', normalized_company_name: 'acme west', normalized_domain: 'acme.com' },
    { ...scope, id: 'c', normalized_company_name: 'acme', normalized_domain: 'acme.com', phone: '(905) 555-1212' },
  ]);
  assert.equal(result.classification, 'exact_duplicate');
  assert.equal(result.matched_prospect_id, 'c');
});

test('exact duplicate suppresses while probable/review goes to human queue', () => {
  assert.equal(lifecycleAfterDuplicateReview('normalized', 'exact_duplicate'), 'suppressed');
  assert.equal(lifecycleAfterDuplicateReview('normalized', 'probable_duplicate'), 'review_ready');
  assert.equal(lifecycleAfterDuplicateReview('normalized', 'review_required'), 'review_ready');
  assert.equal(lifecycleAfterDuplicateReview('normalized', 'unique'), 'normalized');
});
