import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead } from '../src/lib/leadValidation.js';

test('accepts a complete lead', () => {
  const result = validateLead({ lead_id: 'ON-1001', company: 'North York Dental', email: 'ops@example.com', phone: '555-0100' });
  assert.equal(result.valid, true);
  assert.equal(result.reason, '');
});

test('keeps a row with only a city instead of dropping it', () => {
  const result = validateLead({ lead_id: 'ON-1002', city: 'Toronto' });
  assert.equal(result.valid, true);
  assert.equal(result.reason, '');
});

test('rejects a row with only a fallback id and no extra fields', () => {
  const result = validateLead({ id: 'lead-42' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /empty/i);
});

test('marks placeholder or test records invalid', () => {
  const result = validateLead({ lead_id: 'ON-1004', company: 'test', notes: 'demo lead' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /test/i);
});
