import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFieldResolution, canApplyResolvedValue, reviewCompletionState } from '../src/growth/g1EnrichmentProvenance.js';

test('direct source fact can resolve website with provenance', () => {
  const r = validateFieldResolution({
    field_name: 'website',
    evidence: { id: 'e1', evidence_type: 'source_fact', field_name: 'website', source_url: 'https://example.com', is_inferred: false, confidence: 1 },
  });
  assert.equal(r.field_name, 'website');
  assert.equal(r.inferred, false);
  assert.equal(r.provenance.source_url, 'https://example.com');
});

test('inference cannot update phone', () => {
  assert.throws(() => validateFieldResolution({
    field_name: 'phone',
    evidence: { id: 'e2', evidence_type: 'inference', field_name: 'phone', source_label: 'model', is_inferred: true, model_or_agent: 'test' },
  }), /Inferred evidence cannot update phone/);
});

test('inference may support service need summary', () => {
  assert.equal(canApplyResolvedValue('service_need_summary', { id: 'e3', is_inferred: true }), true);
});

test('review completion remains human gated and never outreach eligible', () => {
  const blocked = reviewCompletionState({ duplicate_status: 'pending', accepted_contact: true, current_score: true, enrichment_count: 2 });
  assert.equal(blocked.can_complete_review, false);
  assert.ok(blocked.reasons.includes('duplicate_review_incomplete'));

  const complete = reviewCompletionState({ duplicate_status: 'confirmed_unique', accepted_contact: true, current_score: true, enrichment_count: 2 });
  assert.equal(complete.can_complete_review, true);
  assert.equal(complete.next_lifecycle_status, 'review_ready');
  assert.equal(complete.outreach_eligible, false);
});
