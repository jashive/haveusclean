import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/features/wave4/ServiceOSQaWorkspace.jsx', import.meta.url), 'utf8');

test('Wave 4 QA can recover a passed inspection whose downstream finalization failed', () => {
  assert.match(source, /recoverablePassedInspection/);
  assert.match(source, /Finalize Passed QA/);
  assert.match(source, /passInspection\.inspection_status !== "passed"/);
  assert.match(source, /resumed_after_partial_failure/);
});

test('Wave 4 QA recovery preserves later-wave boundaries', () => {
  assert.doesNotMatch(source, /createInvoice|createPayment|createPayable|profitability/i);
  assert.doesNotMatch(source, /createOperationalJob|createScheduleWindow|createWorkerAssignment/);
});
