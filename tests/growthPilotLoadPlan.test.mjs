import test from 'node:test';
import assert from 'node:assert/strict';
import { G1_PILOT_FIXTURE } from './fixtures/growthG1PilotFixture.js';
import { buildG1PilotLoadPlan, G1_ACCEPTANCE_PROJECT_REF } from '../src/growth/g1PilotLoadPlan.js';

const readiness = {
  status: 'READY',
  ready: true,
  may_load_pilot: true,
  scopes: {
    ON: { organization_id: 'org-1', business_unit_id: 'bu-on', jurisdiction_id: 'jur-on' },
    AZ: { organization_id: 'org-1', business_unit_id: 'bu-az', jurisdiction_id: 'jur-az' },
  },
};

const gates = {
  growth_layer_enabled: true,
  growth_outreach_enabled: false,
  growth_auto_followup_enabled: false,
  growth_serviceos_handoff_enabled: false,
};

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

test('planner produces deterministic 24-record dry-run plan only under safe READY conditions', () => {
  const a = buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: gates, fixture: G1_PILOT_FIXTURE });
  const b = buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: gates, fixture: G1_PILOT_FIXTURE });
  assert.equal(a.status, 'READY_TO_LOAD');
  assert.equal(a.dry_run, true);
  assert.equal(a.record_count, 24);
  assert.deepEqual(a.market_counts, { ON: 12, AZ: 12 });
  assert.equal(a.safety.writes_performed, false);
  assert.equal(a.safety.outbound_allowed, false);
  assert.equal(a.checksum, b.checksum);
});

test('planner rejects production/wrong project', () => {
  expectCode(() => buildG1PilotLoadPlan({ projectRef: 'opazwghrohmfykzxxsjk', readiness, featureGates: gates, fixture: G1_PILOT_FIXTURE }), 'G1_PILOT_WRONG_PROJECT');
});

test('planner rejects blocked canonical scope', () => {
  expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness: { ...readiness, status: 'BLOCKED', ready: false, may_load_pilot: false }, featureGates: gates, fixture: G1_PILOT_FIXTURE }), 'G1_PILOT_SCOPE_BLOCKED');
});

test('planner rejects any downstream activation', () => {
  for (const key of ['growth_outreach_enabled', 'growth_auto_followup_enabled', 'growth_serviceos_handoff_enabled']) {
    expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: { ...gates, [key]: true }, fixture: G1_PILOT_FIXTURE }), key === 'growth_outreach_enabled' ? 'G1_PILOT_OUTREACH_ON' : key === 'growth_auto_followup_enabled' ? 'G1_PILOT_FOLLOWUP_ON' : 'G1_PILOT_HANDOFF_ON');
  }
});

test('planner rejects altered fixture count, unsafe website, and missing safety marker', () => {
  expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: gates, fixture: G1_PILOT_FIXTURE.slice(0, 23) }), 'G1_PILOT_FIXTURE_COUNT');

  const unsafeWebsite = G1_PILOT_FIXTURE.map((r) => ({ ...r }));
  unsafeWebsite[0].Website = 'https://example.com';
  expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: gates, fixture: unsafeWebsite }), 'G1_PILOT_WEBSITE_UNSAFE');

  const unsafeNotes = G1_PILOT_FIXTURE.map((r) => ({ ...r }));
  unsafeNotes[0]['Raw Notes'] = 'ordinary note';
  expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness, featureGates: gates, fixture: unsafeNotes }), 'G1_PILOT_MARKER_MISSING');
});

test('planner rejects non-distinct ON/AZ canonical scope', () => {
  const sameBu = { ...readiness, scopes: { ON: readiness.scopes.ON, AZ: { ...readiness.scopes.AZ, business_unit_id: 'bu-on' } } };
  expectCode(() => buildG1PilotLoadPlan({ projectRef: G1_ACCEPTANCE_PROJECT_REF, readiness: sameBu, featureGates: gates, fixture: G1_PILOT_FIXTURE }), 'G1_PILOT_BU_COLLISION');
});
