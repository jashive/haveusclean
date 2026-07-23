import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead } from '../src/lib/leadValidation.js';

test('accepts a complete lead', () => {
  const result = validateLead({ lead_id: 'ON-1001', company: 'North York Dental', email: 'ops@example.com', phone: '555-0100' });
  assert.equal(result.valid, true);
  assert.equal(result.reason, '');
});

test('marks a lead invalid when company and contact are missing', () => {
  const result = validateLead({ lead_id: 'ON-1002', city: 'Toronto' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /missing company/i);
});

test('marks duplicate IDs invalid when a duplicate is seen', () => {
  const seen = new Set(['ON-1003']);
  const result = validateLead({ lead_id: 'ON-1003', company: 'Bluewave Co', email: 'ops@example.com' }, seen);
  assert.equal(result.valid, false);
  assert.match(result.reason, /duplicate/i);
});

test('marks placeholder or test records invalid', () => {
  const result = validateLead({ lead_id: 'ON-1004', company: 'test', notes: 'demo lead' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /test/i);
});
