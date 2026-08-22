import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateG1ScopeReadiness } from '../src/growth/g1ScopeReadiness.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const ON_BU = '22222222-2222-2222-2222-222222222222';
const ON_JUR = '33333333-3333-3333-3333-333333333333';
const AZ_BU = '44444444-4444-4444-4444-444444444444';
const AZ_JUR = '55555555-5555-5555-5555-555555555555';

const on = (overrides = {}) => ({
  organization_id: ORG,
  business_unit_id: ON_BU,
  jurisdiction_id: ON_JUR,
  business_unit_status: 'active',
  jurisdiction_status: 'active',
  country_code: 'CA',
  subdivision_code: 'ON',
  currency_code: 'CAD',
  jurisdiction_code: 'ON-HUC',
  ...overrides,
});

const az = (overrides = {}) => ({
  organization_id: ORG,
  business_unit_id: AZ_BU,
  jurisdiction_id: AZ_JUR,
  business_unit_status: 'active',
  jurisdiction_status: 'active',
  country_code: 'US',
  subdivision_code: 'AZ',
  currency_code: 'USD',
  jurisdiction_code: 'AZ-HUC',
  ...overrides,
});

test('TEST-W6-like synthetic scope is BLOCKED and cannot load pilot', () => {
  const result = evaluateG1ScopeReadiness([{
    organization_id: ORG,
    business_unit_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    jurisdiction_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    business_unit_status: 'active',
    jurisdiction_status: 'active',
    country_code: 'US',
    subdivision_code: '',
    currency_code: 'CAD',
    jurisdiction_code: 'TEST-W6-JUR',
  }]);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.may_load_pilot, false);
  assert.deepEqual(result.reasons.sort(), ['arizona_scope_missing', 'ontario_scope_missing']);
});

test('exactly one governed ON and AZ scope in same organization is READY', () => {
  const result = evaluateG1ScopeReadiness([on(), az()]);
  assert.equal(result.status, 'READY');
  assert.equal(result.ready, true);
  assert.equal(result.may_load_pilot, true);
  assert.equal(result.may_enable_outreach, false);
  assert.equal(result.may_enable_handoff, false);
  assert.equal(result.scopes.ON.business_unit_id, ON_BU);
  assert.equal(result.scopes.AZ.business_unit_id, AZ_BU);
});

test('duplicate active Ontario canonical candidates fail closed as ambiguous', () => {
  const result = evaluateG1ScopeReadiness([
    on(),
    on({ business_unit_id: '66666666-6666-6666-6666-666666666666', jurisdiction_id: '77777777-7777-7777-7777-777777777777' }),
    az(),
  ]);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('ontario_scope_ambiguous'));
});

test('ON and AZ scopes belonging to different organizations are BLOCKED', () => {
  const result = evaluateG1ScopeReadiness([
    on(),
    az({ organization_id: '99999999-9999-9999-9999-999999999999' }),
  ]);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('organization_mismatch'));
});

test('business unit and jurisdiction identity must be distinct between markets', () => {
  const sameBu = evaluateG1ScopeReadiness([on(), az({ business_unit_id: ON_BU })]);
  assert.ok(sameBu.reasons.includes('business_units_not_distinct'));

  const sameJur = evaluateG1ScopeReadiness([on(), az({ jurisdiction_id: ON_JUR })]);
  assert.ok(sameJur.reasons.includes('jurisdictions_not_distinct'));
});

test('inactive business unit or jurisdiction does not satisfy readiness', () => {
  const inactiveBu = evaluateG1ScopeReadiness([on({ business_unit_status: 'inactive' }), az()]);
  assert.ok(inactiveBu.reasons.includes('ontario_scope_missing'));

  const inactiveJur = evaluateG1ScopeReadiness([on(), az({ jurisdiction_status: 'inactive' })]);
  assert.ok(inactiveJur.reasons.includes('arizona_scope_missing'));
});
