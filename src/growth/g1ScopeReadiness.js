// Growth Layer 1.0 governed scope-readiness detector.
// Pure logic only: it never creates or repairs ServiceOS canonical scope records.

function text(value) {
  return String(value ?? '').trim();
}

function normalize(row = {}) {
  return {
    organization_id: text(row.organization_id),
    business_unit_id: text(row.business_unit_id || row.id),
    jurisdiction_id: text(row.jurisdiction_id),
    business_unit_status: text(row.business_unit_status || row.status).toLowerCase(),
    jurisdiction_status: text(row.jurisdiction_status || row.jurisdiction_status_code || 'active').toLowerCase(),
    country_code: text(row.country_code).toUpperCase(),
    subdivision_code: text(row.subdivision_code).toUpperCase(),
    currency_code: text(row.currency_code).toUpperCase(),
    jurisdiction_code: text(row.jurisdiction_code || row.code),
  };
}

function matches(row, expected) {
  return row.business_unit_status === 'active' &&
    row.jurisdiction_status === 'active' &&
    row.country_code === expected.country_code &&
    row.subdivision_code === expected.subdivision_code &&
    row.currency_code === expected.currency_code &&
    Boolean(row.organization_id && row.business_unit_id && row.jurisdiction_id);
}

export const G1_REQUIRED_SCOPES = Object.freeze({
  ON: Object.freeze({ country_code: 'CA', subdivision_code: 'ON', currency_code: 'CAD' }),
  AZ: Object.freeze({ country_code: 'US', subdivision_code: 'AZ', currency_code: 'USD' }),
});

export function evaluateG1ScopeReadiness(rows = []) {
  const normalized = rows.map(normalize);
  const onCandidates = normalized.filter((r) => matches(r, G1_REQUIRED_SCOPES.ON));
  const azCandidates = normalized.filter((r) => matches(r, G1_REQUIRED_SCOPES.AZ));
  const reasons = [];

  if (onCandidates.length !== 1) reasons.push(onCandidates.length === 0 ? 'ontario_scope_missing' : 'ontario_scope_ambiguous');
  if (azCandidates.length !== 1) reasons.push(azCandidates.length === 0 ? 'arizona_scope_missing' : 'arizona_scope_ambiguous');

  const on = onCandidates.length === 1 ? onCandidates[0] : null;
  const az = azCandidates.length === 1 ? azCandidates[0] : null;

  if (on && az) {
    if (on.organization_id !== az.organization_id) reasons.push('organization_mismatch');
    if (on.business_unit_id === az.business_unit_id) reasons.push('business_units_not_distinct');
    if (on.jurisdiction_id === az.jurisdiction_id) reasons.push('jurisdictions_not_distinct');
  }

  return {
    ready: reasons.length === 0,
    status: reasons.length === 0 ? 'READY' : 'BLOCKED',
    reasons,
    scopes: { ON: on, AZ: az },
    required: G1_REQUIRED_SCOPES,
    may_load_pilot: reasons.length === 0,
    may_enable_outreach: false,
    may_enable_handoff: false,
  };
}
