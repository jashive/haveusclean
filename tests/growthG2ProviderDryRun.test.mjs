import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  G2_PROVIDER_DRY_RUN_POLICY_VERSION,
  createG2NoSendProviderAdapter,
  executeG2ProviderDryRun,
  validateG2SubmissionReservation,
} from '../src/growth/g2ProviderDryRun.js';

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function reservation(overrides = {}) {
  const organizationId = '11111111-1111-1111-1111-111111111111';
  const businessUnitId = '22222222-2222-2222-2222-222222222222';
  const jurisdictionId = '33333333-3333-3333-3333-333333333333';
  const attemptId = '44444444-4444-4444-4444-444444444444';
  const senderId = '55555555-5555-5555-5555-555555555555';
  const providerCode = 'synthetic-provider';
  const contractVersion = 'contract-v1';
  const from = 'sender@example.invalid';
  const to = 'target@example.invalid';
  const subject = 'Synthetic approved subject';
  const body = 'Synthetic approved body';
  const senderHash = sha256(from);
  const recipientHash = sha256(to);
  const contentHash = sha256(`${subject}\n${body}`);
  const submissionKey = sha256([
    organizationId,
    businessUnitId,
    jurisdictionId,
    attemptId,
    senderHash,
    recipientHash,
    contentHash,
    providerCode,
    contractVersion,
  ].join('|'));

  return {
    id: '66666666-6666-6666-6666-666666666666',
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    outreach_attempt_id: attemptId,
    sender_identity_id: senderId,
    provider_code: providerCode,
    envelope_version: 'g2-provider-envelope-2026-08-23',
    sender_hash: senderHash,
    recipient_hash: recipientHash,
    content_hash: contentHash,
    envelope_hash: 'a'.repeat(64),
    submission_key: submissionKey,
    reservation_status: 'reserved',
    metadata: {
      non_sending: true,
      credentials_state: 'absent',
      preflight_policy: 'g2-provider-preflight-2026-08-23',
    },
    envelope: {
      envelope_version: 'g2-provider-envelope-2026-08-23',
      organization_id: organizationId,
      business_unit_id: businessUnitId,
      jurisdiction_id: jurisdictionId,
      outreach_attempt_id: attemptId,
      sender_identity_id: senderId,
      from,
      to,
      subject,
      body,
      provider_code: providerCode,
      provider_contract_version: contractVersion,
      unsubscribe_required: true,
      non_sending_preflight: true,
    },
    ...overrides,
  };
}

test('valid immutable reservation produces deterministic dry-run payload without sending', async () => {
  const input = reservation();
  const adapter = createG2NoSendProviderAdapter({ providerCode: 'synthetic-provider' });
  const result = await executeG2ProviderDryRun({ reservation: input, adapter });

  assert.equal(result.status, 'DRY_RUN_READY_NO_SEND');
  assert.equal(result.policy_version, G2_PROVIDER_DRY_RUN_POLICY_VERSION);
  assert.equal(result.provider_credentials_state, 'absent');
  assert.equal(result.network_io_permitted, false);
  assert.equal(result.send_invoked, false);
  assert.equal(result.submission_key, input.submission_key);
  assert.equal(result.provider_payload.idempotency_key, input.submission_key);
  assert.equal(result.provider_payload.headers['X-HUC-G2-Mode'], 'DRY_RUN_NO_SEND');
  assert.match(result.provider_payload_hash, /^[0-9a-f]{64}$/);
});

test('dry-run replay is deterministic for the same reserved envelope', async () => {
  const input = reservation();
  const adapter = createG2NoSendProviderAdapter({ providerCode: input.provider_code });
  const first = await executeG2ProviderDryRun({ reservation: input, adapter });
  const second = await executeG2ProviderDryRun({ reservation: input, adapter });

  assert.equal(second.provider_payload_hash, first.provider_payload_hash);
  assert.equal(second.submission_key, first.submission_key);
  assert.deepEqual(second.provider_payload, first.provider_payload);
});

test('sender, recipient, content and submission-key tampering fail closed', () => {
  const cases = [
    [
      'sender_hash_mismatch',
      () => {
        const value = reservation();
        value.envelope = { ...value.envelope, from: 'tampered@example.invalid' };
        return value;
      },
    ],
    [
      'recipient_hash_mismatch',
      () => {
        const value = reservation();
        value.envelope = { ...value.envelope, to: 'tampered@example.invalid' };
        return value;
      },
    ],
    [
      'content_hash_mismatch',
      () => {
        const value = reservation();
        value.envelope = { ...value.envelope, body: 'Tampered body' };
        return value;
      },
    ],
    [
      'submission_key_mismatch',
      () => ({ ...reservation(), submission_key: 'b'.repeat(64) }),
    ],
  ];

  for (const [code, makeInput] of cases) {
    assert.throws(() => validateG2SubmissionReservation(makeInput()), (error) => error?.code === code);
  }
});

test('scope, sender linkage, provider and no-send controls cannot be changed in the envelope', () => {
  const cases = [
    ['attempt_linkage_mismatch', { outreach_attempt_id: '77777777-7777-7777-7777-777777777777' }],
    ['sender_linkage_mismatch', { sender_identity_id: '77777777-7777-7777-7777-777777777777' }],
    ['provider_code_mismatch', { provider_code: 'different-provider' }],
    ['envelope_not_non_sending', { non_sending_preflight: false }],
    ['unsubscribe_control_missing', { unsubscribe_required: false }],
  ];

  for (const [code, envelopePatch] of cases) {
    const value = reservation();
    value.envelope = { ...value.envelope, ...envelopePatch };
    assert.throws(() => validateG2SubmissionReservation(value), (error) => error?.code === code);
  }
});

test('reservation must remain reserved, non-sending, and credential-free', () => {
  assert.throws(
    () => validateG2SubmissionReservation(reservation({ reservation_status: 'submitted' })),
    (error) => error?.code === 'reservation_not_reserved',
  );

  assert.throws(
    () => validateG2SubmissionReservation(reservation({ metadata: { non_sending: false, credentials_state: 'absent' } })),
    (error) => error?.code === 'reservation_not_non_sending',
  );

  assert.throws(
    () => validateG2SubmissionReservation(reservation({ metadata: { non_sending: true, credentials_state: 'configured' } })),
    (error) => error?.code === 'provider_credentials_not_absent',
  );
});

test('adapter must exactly match reserved provider and cannot advertise network or credentials', async () => {
  const input = reservation();

  const wrongProvider = createG2NoSendProviderAdapter({ providerCode: 'other-provider' });
  await assert.rejects(
    executeG2ProviderDryRun({ reservation: input, adapter: wrongProvider }),
    (error) => error?.code === 'adapter_provider_mismatch',
  );

  const networkCapable = {
    provider_code: input.provider_code,
    network_io_permitted: true,
    credentials_supported: false,
    serialize() {
      throw new Error('serialize should not be reached');
    },
  };
  await assert.rejects(
    executeG2ProviderDryRun({ reservation: input, adapter: networkCapable }),
    (error) => error?.code === 'network_io_must_be_disabled',
  );

  const credentialCapable = {
    provider_code: input.provider_code,
    network_io_permitted: false,
    credentials_supported: true,
    serialize() {
      throw new Error('serialize should not be reached');
    },
  };
  await assert.rejects(
    executeG2ProviderDryRun({ reservation: input, adapter: credentialCapable }),
    (error) => error?.code === 'provider_credentials_must_be_disabled',
  );
});

test('no-send adapter send method always refuses network I/O', async () => {
  const adapter = createG2NoSendProviderAdapter({ providerCode: 'synthetic-provider' });
  assert.equal(adapter.network_io_permitted, false);
  assert.equal(adapter.credentials_supported, false);

  await assert.rejects(adapter.send(), (error) => error?.code === 'G2_NETWORK_IO_REFUSED');
});
