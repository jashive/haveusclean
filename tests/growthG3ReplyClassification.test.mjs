import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGrowthReply, evaluateGrowthQualification } from '../src/growth/g3ReplyClassification.js';

test('opt-out wins over positive language', () => {
  const result = classifyGrowthReply({ text: 'I was interested, but please unsubscribe me.' });
  assert.equal(result.classification, 'opt_out');
  assert.equal(result.qualificationState, 'suppressed');
  assert.equal(result.sequenceAction, 'stop');
});

test('positive interest remains qualification pending', () => {
  const result = classifyGrowthReply({ text: "Yes please, let's talk about this." });
  assert.equal(result.classification, 'positive_interest');
  assert.equal(result.qualificationState, 'qualification_pending');
  assert.equal(result.requiresHumanReview, true);
});

test('request for pricing is request_information', () => {
  const result = classifyGrowthReply({ text: 'Can you send pricing and more information?' });
  assert.equal(result.classification, 'request_information');
});

test('later timing routes to nurture only after qualification evaluation', () => {
  const classification = classifyGrowthReply({ text: 'Not right now. Circle back next month.' });
  assert.equal(classification.classification, 'timing_later');
  const result = evaluateGrowthQualification({ classification: classification.classification });
  assert.equal(result.state, 'nurture');
  assert.equal(result.handoffEligible, false);
});

test('not interested is disqualified', () => {
  const result = evaluateGrowthQualification({ classification: 'not_interested' });
  assert.equal(result.state, 'disqualified');
  assert.equal(result.handoffEligible, false);
});

test('active suppression overrides otherwise positive reply', () => {
  const result = evaluateGrowthQualification({
    classification: 'positive_interest',
    activeSuppression: true,
    humanQualified: true,
    verifiedServiceNeed: true,
    supportedGeography: true,
    verifiedReachableContact: true,
  });
  assert.equal(result.state, 'suppressed');
  assert.equal(result.handoffEligible, false);
});

test('all G3 qualification controls only create a handoff candidate, never ServiceOS eligibility', () => {
  const result = evaluateGrowthQualification({
    classification: 'positive_interest',
    humanQualified: true,
    verifiedServiceNeed: true,
    supportedGeography: true,
    verifiedReachableContact: true,
  });
  assert.equal(result.state, 'handoff_candidate');
  assert.equal(result.handoffEligible, false);
  assert.deepEqual(result.reasons, ['g3_handoff_candidate_requires_separate_g4_handoff']);
});

test('ambiguous reply remains fail-closed', () => {
  const classification = classifyGrowthReply({ text: 'Thanks for reaching out.' });
  assert.equal(classification.classification, 'unclear');
  assert.equal(classification.qualificationState, 'qualification_pending');
  const result = evaluateGrowthQualification({ classification: classification.classification });
  assert.equal(result.state, 'qualification_pending');
  assert.equal(result.handoffEligible, false);
});
