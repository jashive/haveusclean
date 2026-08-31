# G6 Review Hardening Closure

Status: **REVIEW FINDINGS REMEDIATED IN ACCEPTANCE / NOT ACTIVATED**

This addendum records the final PR #60 hardening discovered during review after the G6 branch was synchronized to current `main`.

## Review round 1

### P1 — pilot quota continuity across replacement authorizations

The initial quota function counted reservations by `staged_activation_authorization_id`. A revoked/expired authorization could therefore be replaced under the same pilot policy and reset the daily/total counters.

**Fix:** Acceptance migration `20260831152642_growth_layer_g6_review_hardening.sql` locks the shared `growth.pilot_policy` row and counts reservations by `pilot_policy_id` (plus `quota_day` for the daily cap). Replacement staged authorizations under the same policy share one quota. Index `pilot_send_policy_quota_idx` supports the policy/day access path.

### P2 — active handoff-pilot policy idempotency

The original handoff-policy RPC checked for an active policy before checking the request idempotency key, so an exact retry of a successful active policy was incorrectly blocked.

**Fix:** `growth_g6_record_handoff_pilot_policy(...)` now checks the exact scope/idempotency key first. Exact unchanged retries return the original policy with `idempotent_replay=true`; changed payload under the same key remains a collision. The replay hash uses the original immutable evidence snapshot so later evidence drift does not convert an exact retry into a false collision.

### OAT 027

`supabase/acceptance/027_growth_g6_review_hardening_oat.sql` is Acceptance-only, synthetic, and rollback-only. It verifies policy-scoped quota locking/counting, the policy/day index, active handoff-policy exact replay, changed-payload collision protection, protected gates OFF, and zero synthetic residue.

## Review round 2

### P1 — provider emergency stop vs in-flight consumption

The original emergency-stop loop selected issued provider leases and then called a helper that separately locked each lease. A concurrent consumer could move a lease to `consumed` between those operations, causing the helper to raise and roll back the entire emergency-stop transaction.

**Fix:** Acceptance migration `20260831153133_growth_layer_g6_concurrency_replay_hardening.sql` acquires all linked issued provider execution-lease locks before feature-gate locks, matching the execution lock order. After the locks are held, it forces the protected outreach/provider/auto-followup gates OFF and directly revokes only leases still `issued`. A lease that completed before lock acquisition is tolerated and cannot roll back the stop transaction.

### P1 — handoff-policy revocation lock-order deadlock

The original handoff revocation updated the ServiceOS handoff feature gate before locking G4 execution leases, opposite the G4 execute path (`lease -> gate`). Under concurrency this could deadlock and roll back policy revocation/gate shutdown.

**Fix:** handoff-policy revocation now acquires linked issued G4 execution-lease locks first, then locks/disables `growth_serviceos_handoff_enabled`, then revokes leases still issued. This matches G4 execution lock order and removes the opposing lock cycle.

### P2 — staged-authorization lost-response replay

The original staged-authorization RPC evaluated current commissioning readiness before idempotency lookup. An exact retry could therefore be blocked after gates were deliberately enabled or prerequisites drifted, even though the original authorization had already been recorded.

**Fix:** `growth_g6_record_staged_activation_authorization(...)` now resolves exact scope/idempotency replay before current readiness checks, using the original immutable policy/runtime fingerprint in the request hash. Changed payload still collides. This only recovers the original response; it does not grant current execution eligibility, which remains separately re-evaluated before lease issuance/consumption.

### OAT 028

`supabase/acceptance/028_growth_g6_concurrency_replay_hardening_oat.sql` is Acceptance-only, synthetic, and rollback-only. It verifies:

- provider emergency-stop lease-lock ordering precedes feature-gate locking;
- provider emergency stop conditionally revokes only still-issued leases;
- handoff revocation lease-lock ordering precedes handoff-gate locking;
- an exact staged-authorization retry succeeds even after current readiness is deliberately made false by enabling a protected gate inside the rollback transaction;
- changed payload under the same staged-authorization key remains a collision;
- all temporary state/gate changes roll back and protected gates finish OFF.

## Security and control state

Hardened G6 RPCs remain `SECURITY DEFINER` with empty `search_path` and service-role boundaries. Persistent protected gates remain OFF:

- `growth_outreach_enabled=false`
- `growth_auto_followup_enabled=false`
- `growth_provider_execution_enabled=false`
- `growth_serviceos_handoff_enabled=false`

No real provider credentials were added, no provider API/network send occurred, no live Growth→ServiceOS handoff was activated, and Production ServiceOS was not modified.

## Commissioning status

Engineering hardening does not remove the operational commissioning gate. Real execution remains **BLOCKED AT COMMISSIONING** until current legal/compliance approval, provider/security approval, externally stored credentials, sender/DNS readiness, event-derived sender health, monitoring/rollback readiness, staff training, exact pilot policy, and HEMS live-pilot approval are present and explicitly governed.
