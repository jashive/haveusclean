// Growth Layer 1.0 controlled pilot load planner.
// Pure source-level safety control. This module NEVER writes to Supabase or ServiceOS.

import { normalizeLegacyLead } from './g1LeadMining.js';

export const G1_ACCEPTANCE_PROJECT_REF = 'hqeamecwdsrjfjybrsox';
export const G1_PILOT_RECORD_COUNT = 24;
export const G1_PILOT_SAFETY_MARKER = 'SYNTHETIC ACCEPTANCE FIXTURE — NOT FOR OUTREACH.';

function gate(gates, key) {
  return gates?.[key] === true;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function assert(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function scopeByMarket(readiness) {
  const on = readiness?.scopes?.ON;
  const az = readiness?.scopes?.AZ;
  return {
    ON: {
      organization_id: on?.organization_id,
      business_unit_id: on?.business_unit_id,
      jurisdiction_id: on?.jurisdiction_id,
    },
    AZ: {
      organization_id: az?.organization_id,
      business_unit_id: az?.business_unit_id,
      jurisdiction_id: az?.jurisdiction_id,
    },
  };
}

export function buildG1PilotLoadPlan({
  projectRef,
  readiness,
  featureGates,
  fixture,
} = {}) {
  assert(projectRef === G1_ACCEPTANCE_PROJECT_REF,
    'G1 pilot planner is acceptance-project-only.', 'G1_PILOT_WRONG_PROJECT');
  assert(readiness?.status === 'READY' && readiness?.ready === true && readiness?.may_load_pilot === true,
    'G1 pilot planner requires canonical dual-market readiness.', 'G1_PILOT_SCOPE_BLOCKED');
  assert(gate(featureGates, 'growth_layer_enabled'),
    'Growth Layer core gate must be enabled in acceptance.', 'G1_PILOT_CORE_GATE_OFF');
  assert(!gate(featureGates, 'growth_outreach_enabled'),
    'Outbound outreach must remain disabled during G1 pilot.', 'G1_PILOT_OUTREACH_ON');
  assert(!gate(featureGates, 'growth_auto_followup_enabled'),
    'Automatic follow-up must remain disabled during G1 pilot.', 'G1_PILOT_FOLLOWUP_ON');
  assert(!gate(featureGates, 'growth_serviceos_handoff_enabled'),
    'ServiceOS handoff must remain disabled during G1 pilot.', 'G1_PILOT_HANDOFF_ON');
  assert(Array.isArray(fixture) && fixture.length === G1_PILOT_RECORD_COUNT,
    `G1 pilot fixture must contain exactly ${G1_PILOT_RECORD_COUNT} records.`, 'G1_PILOT_FIXTURE_COUNT');

  const seen = new Set();
  for (const row of fixture) {
    const leadId = String(row?.['Lead ID'] || '').trim();
    const website = String(row?.Website || '').trim().toLowerCase();
    const notes = String(row?.['Raw Notes'] || '');
    assert(leadId && !seen.has(leadId), 'Pilot Lead IDs must be present and unique.', 'G1_PILOT_LEAD_ID_INVALID');
    seen.add(leadId);
    assert(website.endsWith('.example.invalid'), 'Every pilot website must use .example.invalid.', 'G1_PILOT_WEBSITE_UNSAFE');
    assert(notes.includes(G1_PILOT_SAFETY_MARKER), 'Every pilot row must contain the NOT FOR OUTREACH safety marker.', 'G1_PILOT_MARKER_MISSING');
  }

  const scopes = scopeByMarket(readiness);
  const prospects = fixture.map((row) => normalizeLegacyLead(row, scopes));
  const on = prospects.filter((p) => p.country_code === 'CA' && p.subdivision_code === 'ON');
  const az = prospects.filter((p) => p.country_code === 'US' && p.subdivision_code === 'AZ');

  assert(on.length === 12 && az.length === 12,
    'Pilot must normalize to exactly 12 Ontario and 12 Arizona prospects.', 'G1_PILOT_MARKET_SPLIT');
  assert(new Set(prospects.map((p) => p.organization_id)).size === 1,
    'Pilot prospects must share one canonical organization.', 'G1_PILOT_ORG_MISMATCH');
  assert(scopes.ON.business_unit_id !== scopes.AZ.business_unit_id,
    'Ontario and Arizona business units must be distinct.', 'G1_PILOT_BU_COLLISION');
  assert(scopes.ON.jurisdiction_id !== scopes.AZ.jurisdiction_id,
    'Ontario and Arizona jurisdictions must be distinct.', 'G1_PILOT_JURISDICTION_COLLISION');

  const canonical = prospects
    .map((p) => ({
      external_prospect_key: p.external_prospect_key,
      organization_id: p.organization_id,
      business_unit_id: p.business_unit_id,
      jurisdiction_id: p.jurisdiction_id,
      country_code: p.country_code,
      subdivision_code: p.subdivision_code,
      company_name: p.company_name,
      normalized_domain: p.normalized_domain,
    }))
    .sort((a, b) => a.external_prospect_key.localeCompare(b.external_prospect_key));

  return Object.freeze({
    status: 'READY_TO_LOAD',
    dry_run: true,
    project_ref: projectRef,
    record_count: prospects.length,
    market_counts: Object.freeze({ ON: on.length, AZ: az.length }),
    scopes: Object.freeze({ ON: scopes.ON, AZ: scopes.AZ }),
    checksum: `fnv1a32:${fnv1a(JSON.stringify(canonical))}`,
    safety: Object.freeze({
      synthetic_only: true,
      outbound_allowed: false,
      auto_followup_allowed: false,
      serviceos_handoff_allowed: false,
      writes_performed: false,
    }),
    prospects,
  });
}
