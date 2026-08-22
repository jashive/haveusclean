import test from 'node:test';
import assert from 'node:assert/strict';
import { G1_PILOT_FIXTURE, G1_PILOT_EXPECTATIONS } from './fixtures/growthG1PilotFixture.js';
import { normalizeLegacyLead, scoreProspectV1 } from '../src/growth/g1LeadMining.js';
import { classifyDuplicate } from '../src/growth/g1DuplicateResolution.js';

const scope = {
  ON: { organization_id: '11111111-1111-1111-1111-111111111111', business_unit_id: '22222222-2222-2222-2222-222222222222', jurisdiction_id: '33333333-3333-3333-3333-333333333333' },
  AZ: { organization_id: '11111111-1111-1111-1111-111111111111', business_unit_id: '44444444-4444-4444-4444-444444444444', jurisdiction_id: '55555555-5555-5555-5555-555555555555' },
};

function byId(id) { return G1_PILOT_FIXTURE.find((r) => r['Lead ID'] === id); }

test('fixture has 24 synthetic, non-outbound prospects across all eight target cities', () => {
  assert.equal(G1_PILOT_FIXTURE.length, G1_PILOT_EXPECTATIONS.total);
  assert.equal(G1_PILOT_EXPECTATIONS.outboundAllowed, false);
  const cities = new Set(G1_PILOT_FIXTURE.map((r) => r.City));
  assert.deepEqual([...cities].sort(), [...G1_PILOT_EXPECTATIONS.cities].sort());
  for (const row of G1_PILOT_FIXTURE) {
    assert.match(row['Raw Notes'], /NOT FOR OUTREACH/);
    assert.match(row.Website, /\.example\.invalid$/);
  }
});

test('normalizer maps Ontario and Arizona fixtures to separate canonical scopes', () => {
  const on = normalizeLegacyLead(byId('PILOT-ON-001'), scope);
  const az = normalizeLegacyLead(byId('PILOT-AZ-001'), scope);
  assert.equal(on.country_code, 'CA');
  assert.equal(on.subdivision_code, 'ON');
  assert.equal(on.business_unit_id, scope.ON.business_unit_id);
  assert.equal(az.country_code, 'US');
  assert.equal(az.subdivision_code, 'AZ');
  assert.equal(az.business_unit_id, scope.AZ.business_unit_id);
});

test('intent remains zero even for high-ICP fixture until verified intent is supplied', () => {
  const p = normalizeLegacyLead(byId('PILOT-ON-003'), scope);
  const score = scoreProspectV1(p, { verifiedContact: true, positiveIntent: false });
  assert.equal(score.intent_score, 0);
});

test('intentional Ontario exact duplicate is classified exact', () => {
  const a = normalizeLegacyLead(byId('PILOT-ON-004'), scope);
  const b = normalizeLegacyLead(byId('PILOT-ON-005'), scope);
  const result = classifyDuplicate({ ...a, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { ...b, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
  assert.equal(result.classification, 'exact_duplicate');
});

test('shared domain in same scope is not exact without another strong identity signal', () => {
  const a = normalizeLegacyLead(byId('PILOT-ON-003'), scope);
  const b = normalizeLegacyLead(byId('PILOT-ON-012'), scope);
  const result = classifyDuplicate({ ...a, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { ...b, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
  assert.equal(result.classification, 'probable_duplicate');
});
