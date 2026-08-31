# G6 Review Hardening Closure

Status: **REVIEW FINDINGS REMEDIATED IN ACCEPTANCE / NOT ACTIVATED**

This addendum records the final PR #60 hardening discovered during review after the G6 branch was synchronized to current `main`.

## Findings

### P1 — pilot quota continuity across replacement authorizations

The initial quota function counted reservations by `staged_activation_authorization_id`. A revoked/expired authorization could therefore be replaced under the same pilot policy and reset the daily/total counters.

**Fix:** Acceptance migration `20260831152642_growth_layer_g6_review_hardening.sql` now locks the shared `growth.pilot_policy` row and counts reservations by `pilot_policy_id` (plus `quota_day` for the daily cap). Replacement staged authorizations under the same policy share one quota. Index `pilot_send_policy_quota_idx` supports the policy/day access path.

### P2 — active handoff-pilot policy idempotency

The original handoff-policy RPC checked for an active policy before checking the request idempotency key, so an exact retry of a successful active policy was incorrectly blocked.

**Fix:** `growth_g6_record_handoff_pilot_policy(...)` now checks the exact scope/idempotency key first. Exact unchanged retries return the original policy with `idempotent_replay=true`; changed payload under the same key remains a collision. The replay hash uses the original immutable evidence snapshot so later evidence drift does not convert an exact retry into a false collision.

## OAT 027

`supabase/acceptance/027_growth_g6_review_hardening_oat.sql` is Acceptance-only, synthetic, and rollback-only.

It verifies:

- the provider-lease quota function locks the shared pilot policy;
- total quota is scoped to `pilot_policy_id`;
- daily quota is scoped to `pilot_policy_id + quota_day`;
- the policy/day quota index exists;
- a first handoff pilot policy is created normally;
- an exact retry while that policy remains active returns the same ID as an idempotent replay;
- changed payload under the same idempotency key is rejected;
- all protected execution gates remain OFF;
- synthetic handoff-policy and commissioning-evidence records roll back to zero.

## Security and control state

Both hardened RPCs remain `SECURITY DEFINER` with empty `search_path`, executable by `service_role` and not by `anon` or `authenticated`.

Persistent protected gates remain OFF:

- `growth_outreach_enabled=false`
- `growth_auto_followup_enabled=false`
- `growth_provider_execution_enabled=false`
- `growth_serviceos_handoff_enabled=false`

No real provider credentials were added, no provider API/network send occurred, no live Growth→ServiceOS handoff was activated, and Production ServiceOS was not modified.

## Commissioning status

Engineering hardening does not remove the operational commissioning gate. Real execution remains **BLOCKED AT COMMISSIONING** until current legal/compliance approval, provider/security approval, externally stored credentials, sender/DNS readiness, event-derived sender health, monitoring/rollback readiness, staff training, exact pilot policy, and HEMS live-pilot approval are present and explicitly governed.
