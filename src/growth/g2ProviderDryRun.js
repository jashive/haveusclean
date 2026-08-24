import { createHash } from 'node:crypto';

export const G2_PROVIDER_DRY_RUN_POLICY_VERSION = 'g2-provider-dry-run-2026-08-24';

const HEX_64 = /^[0-9a-f]{64}$/;

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function ensure(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function normalizedReservation(reservation = {}) {
  return {
    ...reservation,
    provider_code: text(reservation.provider_code).toLowerCase(),
    envelope_version: text(reservation.envelope_version),
    sender_hash: text(reservation.sender_hash).toLowerCase(),
    recipient_hash: text(reservation.recipient_hash).toLowerCase(),
    content_hash: text(reservation.content_hash).toLowerCase(),
    envelope_hash: text(reservation.envelope_hash).toLowerCase(),
    submission_key: text(reservation.submission_key).toLowerCase(),
    reservation_status: text(reservation.reservation_status).toLowerCase(),
    envelope: reservation.envelope && typeof reservation.envelope === 'object' ? reservation.envelope : {},
    metadata: reservation.metadata && typeof reservation.metadata === 'object' ? reservation.metadata : {},
  };
}

export function validateG2SubmissionReservation(reservationInput = {}) {
  const reservation = normalizedReservation(reservationInput);
  const envelope = reservation.envelope;

  ensure(text(reservation.id), 'reservation_id_missing');
  ensure(text(reservation.outreach_attempt_id), 'attempt_id_missing');
  ensure(text(reservation.sender_identity_id), 'sender_identity_id_missing');
  ensure(reservation.reservation_status === 'reserved', 'reservation_not_reserved');
  ensure(reservation.metadata.non_sending === true, 'reservation_not_non_sending');
  ensure(reservation.metadata.credentials_state === 'absent', 'provider_credentials_not_absent');

  ensure(text(envelope.envelope_version) === reservation.envelope_version, 'envelope_version_mismatch');
  ensure(text(envelope.outreach_attempt_id) === text(reservation.outreach_attempt_id), 'attempt_linkage_mismatch');
  ensure(text(envelope.sender_identity_id) === text(reservation.sender_identity_id), 'sender_linkage_mismatch');
  ensure(text(envelope.provider_code).toLowerCase() === reservation.provider_code, 'provider_code_mismatch');
  ensure(envelope.non_sending_preflight === true, 'envelope_not_non_sending');
  ensure(envelope.unsubscribe_required === true, 'unsubscribe_control_missing');

  const from = text(envelope.from).toLowerCase();
  const to = text(envelope.to).toLowerCase();
  const subject = String(envelope.subject ?? '');
  const body = String(envelope.body ?? '');
  const contractVersion = text(envelope.provider_contract_version);
  const organizationId = text(envelope.organization_id);
  const businessUnitId = text(envelope.business_unit_id);
  const jurisdictionId = text(envelope.jurisdiction_id);

  ensure(from, 'sender_missing');
  ensure(to, 'recipient_missing');
  ensure(subject.trim(), 'subject_missing');
  ensure(body.trim(), 'body_missing');
  ensure(contractVersion, 'provider_contract_version_missing');
  ensure(organizationId && businessUnitId && jurisdictionId, 'scope_missing');

  for (const [name, value] of [
    ['sender_hash', reservation.sender_hash],
    ['recipient_hash', reservation.recipient_hash],
    ['content_hash', reservation.content_hash],
    ['envelope_hash', reservation.envelope_hash],
    ['submission_key', reservation.submission_key],
  ]) {
    ensure(HEX_64.test(value), `${name}_invalid`);
  }

  const expectedSenderHash = sha256(from);
  const expectedRecipientHash = sha256(to);
  const expectedContentHash = sha256(`${subject}\n${body}`);
  const expectedSubmissionKey = sha256([
    organizationId,
    businessUnitId,
    jurisdictionId,
    text(reservation.outreach_attempt_id),
    expectedSenderHash,
    expectedRecipientHash,
    expectedContentHash,
    reservation.provider_code,
    contractVersion,
  ].join('|'));

  ensure(reservation.sender_hash === expectedSenderHash, 'sender_hash_mismatch');
  ensure(reservation.recipient_hash === expectedRecipientHash, 'recipient_hash_mismatch');
  ensure(reservation.content_hash === expectedContentHash, 'content_hash_mismatch');
  ensure(reservation.submission_key === expectedSubmissionKey, 'submission_key_mismatch');

  return {
    valid: true,
    reservation,
    authoritative_envelope_hash: reservation.envelope_hash,
    recomputed: {
      sender_hash: expectedSenderHash,
      recipient_hash: expectedRecipientHash,
      content_hash: expectedContentHash,
      submission_key: expectedSubmissionKey,
    },
  };
}

export function createG2NoSendProviderAdapter({ providerCode } = {}) {
  const normalizedProvider = text(providerCode).toLowerCase();
  ensure(normalizedProvider, 'provider_code_missing');

  return Object.freeze({
    provider_code: normalizedProvider,
    mode: 'dry_run_no_send',
    network_io_permitted: false,
    credentials_supported: false,
    serialize(envelope, submissionKey) {
      ensure(text(envelope?.provider_code).toLowerCase() === normalizedProvider, 'adapter_provider_mismatch');
      ensure(text(submissionKey), 'submission_key_missing');

      const payload = {
        from: text(envelope.from).toLowerCase(),
        to: text(envelope.to).toLowerCase(),
        subject: String(envelope.subject ?? ''),
        text: String(envelope.body ?? ''),
        idempotency_key: text(submissionKey),
        headers: {
          'X-HUC-G2-Submission-Key': text(submissionKey),
          'X-HUC-G2-Mode': 'DRY_RUN_NO_SEND',
        },
      };

      return Object.freeze({
        payload,
        payload_hash: sha256(stableJson(payload)),
      });
    },
    async send() {
      const error = new Error('G2_NETWORK_IO_REFUSED');
      error.code = 'G2_NETWORK_IO_REFUSED';
      throw error;
    },
  });
}

export async function executeG2ProviderDryRun({ reservation, adapter } = {}) {
  ensure(adapter && typeof adapter.serialize === 'function', 'provider_adapter_missing');
  ensure(adapter.network_io_permitted === false, 'network_io_must_be_disabled');
  ensure(adapter.credentials_supported === false, 'provider_credentials_must_be_disabled');

  const validation = validateG2SubmissionReservation(reservation);
  ensure(adapter.provider_code === validation.reservation.provider_code, 'adapter_provider_mismatch');

  const serialized = adapter.serialize(
    validation.reservation.envelope,
    validation.reservation.submission_key,
  );

  ensure(serialized?.payload && typeof serialized.payload === 'object', 'serialized_payload_missing');
  ensure(HEX_64.test(text(serialized.payload_hash).toLowerCase()), 'serialized_payload_hash_invalid');

  return Object.freeze({
    status: 'DRY_RUN_READY_NO_SEND',
    policy_version: G2_PROVIDER_DRY_RUN_POLICY_VERSION,
    reservation_id: validation.reservation.id,
    outreach_attempt_id: validation.reservation.outreach_attempt_id,
    provider_code: validation.reservation.provider_code,
    provider_credentials_state: 'absent',
    network_io_permitted: false,
    send_invoked: false,
    submission_key: validation.reservation.submission_key,
    authoritative_envelope_hash: validation.authoritative_envelope_hash,
    provider_payload_hash: serialized.payload_hash,
    provider_payload: serialized.payload,
  });
}
