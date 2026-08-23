import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260823005500_growth_layer_g1_review_hardening.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/growth-g1/index.ts', 'utf8');
const oat = fs.readFileSync('supabase/tests/growth-g1-dual-market-pilot-oat.sql', 'utf8');

test('target-scope guard binds mutations to the authorized business unit', () => {
  assert.match(migration, /growth_g1_assert_target_scope/i);
  assert.match(migration, /business_unit_id = p_business_unit_id/i);
  assert.match(edge, /assertTargetScope\(organizationId, businessUnitId/i);
  assert.match(edge, /duplicateReviewId/);
  assert.match(edge, /contactCandidateId/);
});

test('field resolution requires evidence field identity to match requested field', () => {
  assert.match(migration, /select field_name, field_value, is_inferred/i);
  assert.match(migration, /v_evidence_field <> p_field_name/i);
  assert.match(migration, /evidence field does not match requested field/i);
});

test('rejecting previously applied evidence recomputes or clears the prospect field', () => {
  assert.match(migration, /v_previous_applied_value/i);
  assert.match(migration, /decision = 'accepted'/i);
  assert.match(migration, /v_replacement_value/i);
  assert.match(migration, /v_previous_applied_value is not null/i);
});

test('Edge contact path normalizes and rejects invalid direct identities', () => {
  assert.match(edge, /function normalizeEmail/);
  assert.match(edge, /function normalizePhone/);
  assert.match(edge, /digits\.length === 10 \? digits : null/);
  assert.match(edge, /function normalizeLinkedIn/);
  assert.match(edge, /GROWTH_CONTACT_INVALID/);
  assert.match(edge, /normalizeContact\(body\.contact/);
});

test('dual-market OAT contains executable post-load invariant assertions', () => {
  assert.match(oat, /OAT FAIL: expected 24 pilot prospects/);
  assert.match(oat, /OAT FAIL: cross-business-unit duplicate review detected/);
  assert.match(oat, /OAT FAIL: inferred identity resolution accepted/);
  assert.match(oat, /OAT FAIL: unexpected outreach-eligible pilot prospect/);
  assert.match(oat, /OAT FAIL: downstream Growth gate enabled/);
});
