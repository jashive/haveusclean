# Growth Layer G6 — Production Readiness & Controlled Pilot Commissioning

Status: **IN PROGRESS — engineering commissioning + staged-activation control plane implemented and proven in Acceptance; real commissioning remains BLOCKED; no persistent execution gate activated.**

Branch: `growth/g6-production-readiness-pilot`  
Base: G5 merge/main `4a343e638d28aa88a64bd790db241a654afb256e`  
Acceptance: `HEMS_Growth_Dev` (`hqeamecwdsrjfjybrsox`)  
Production ServiceOS was not modified.

## 1. Architectural boundary

G6 commissions the existing Growth Layer; it does not create another outreach engine or operational lifecycle. HEMS remains governance authority. G2 remains authoritative for outreach/provider/legal/sender controls. G4 remains authoritative for Growth→ServiceOS handoff. G5 remains the read-only analytics/feedback surface.

Persistent control state remains:

- `growth_layer_enabled=true`
- `growth_outreach_enabled=false`
- `growth_auto_followup_enabled=false`
- `growth_provider_execution_enabled=false`
- `growth_serviceos_handoff_enabled=false`

## 2. G6 slice 1 — commissioning evidence and readiness

Implemented private/RLS/append-only tables:

- `growth.commissioning_evidence`
- `growth.commissioning_evidence_revocation`
- `growth.pilot_policy`
- `growth.pilot_policy_revocation`

Commissioning evidence types are legal/compliance approval, provider security review, sender-domain readiness, monitoring/alerting readiness, rollback/emergency-stop readiness, staff SOP/training readiness, ServiceOS handoff-pilot readiness, and HEMS pilot approval.

First-stage policy is deliberately narrow:

- `manual_email_outreach`
- email only
- daily cap 1–25
- total cap 1–100
- `handoff_cap=0`
- auto-followup/SMS/phone all false
- kill on any complaint
- maximum policy validity 7 days.

Service-role-only RPCs record/revoke evidence and policy and evaluate `growth_g6_commissioning_readiness(...)`. Readiness is pre-activation only: it requires all protected execution gates OFF and returns `BLOCKED` or `READY_FOR_STAGED_ACTIVATION_REQUEST`; it never changes a gate and always reports `execution_authorized=false`.

### OAT 024 — PASS

Rollback-only Acceptance proof covers fail-closed empty state, idempotency/collision rejection, append-only controls, evidence revocation, sender/provider blockers, channel/handoff restrictions, no gate mutation and zero synthetic residue.

Source: `supabase/tests/growth-g6-commissioning-foundation-oat.sql`.

## 3. G6 slice 2 — staged activation + server-side pilot quota

Implemented:

- `growth.staged_activation_authorization`
- `growth.staged_activation_authorization_revocation`
- `growth.pilot_send_reservation`

All are private/RLS/append-only and service-role operated.

### Runtime prerequisite fingerprint

`growth_g6_runtime_prerequisite_snapshot(...)` derives a server-authoritative snapshot of the exact current pilot policy, required commissioning evidence IDs, sender readiness, provider runtime binding, adapter allowlist, activation approval and canonical jurisdiction timezone. The snapshot is SHA-256 fingerprinted.

This snapshot intentionally excludes the two deliberate first-stage execution gates so an authorization can be recorded while gates are OFF and remain valid after an explicitly governed micro-stage activation. It still blocks if auto-followup or ServiceOS handoff is enabled during the manual-email pilot.

### Staged activation authorization

`growth_g6_record_staged_activation_authorization(...)` requires:

- pre-activation G6 readiness = `READY_FOR_STAGED_ACTIVATION_REQUEST`;
- current runtime prerequisites = ready;
- active human approver;
- exact org/BU/jurisdiction/environment;
- exact policy/request hash/evidence/runtime fingerprint;
- validity no longer than 24 hours and never beyond pilot-policy expiry.

It is idempotent, immutable and separately revocable. It does **not** mutate a feature gate.

`growth_g6_evaluate_staged_activation_authorization(...)` fails closed on expiry, revocation, policy drift, evidence/sender/provider drift, or premature later-stage gate activation.

### Server-side pilot quota

`growth_g6_reserve_pilot_send_for_provider_lease(...)` locks the authorization row while reserving a send slot, preventing concurrent cap races. It enforces:

- exact submission/provider/sender scope;
- one reservation per G2 submission reservation;
- canonical jurisdiction timezone (`America/Toronto` for Ontario, `America/Phoenix` for Arizona);
- daily and total pilot send caps.

Quota is intentionally conservative: reserved slots are not automatically released, preferring under-send over accidental over-send.

## 4. G2 production provider-lease hardening

Existing G2 provider controls remain mandatory. G6 adds an additional production-only requirement rather than replacing them.

`growth.provider_execution_lease` now links optionally to:

- `g6_staged_activation_authorization_id`
- `g6_pilot_send_reservation_id`

For `environment_name='production'`, `growth_g2_issue_provider_execution_lease(...)` now requires exactly one current matching G6 staged authorization plus an available G6 quota slot. A missing or ambiguous G6 authorization blocks issuance. Lease expiry cannot exceed G6 authorization expiry.

Acceptance/non-production behavior remains compatible with G2.

`growth_g2_consume_provider_execution_lease(...)` now rechecks the linked G6 authorization and quota binding before a production lease can be consumed. Revocation or prerequisite drift after lease issuance therefore blocks consumption.

There is still no generic G6 gate-toggle RPC.

## 5. OAT 025 — PASS

Source: `supabase/acceptance/025_growth_g6_staged_activation_quota_provider_lease_oat.sql`.

Rollback-only Acceptance test proved the real G2/G6 chain:

1. Starts with every protected execution gate OFF.
2. Builds two synthetic, legally approved, sender-ready G2 outreach targets and valid non-sending preflight reservations.
3. Creates production-shaped provider metadata in Acceptance only; no secret or network send.
4. Temporarily enables the old G2 outreach/provider gates and proves production lease issuance is still BLOCKED without G6 (`g6_staged_activation_authorization_missing`).
5. Restores gates OFF, records G6 evidence + one-send production-shaped pilot policy, and proves readiness is `READY_FOR_STAGED_ACTIVATION_REQUEST` without execution authorization or gate mutation.
6. Records a human staged authorization while all execution gates remain OFF.
7. Temporarily enables only outreach + provider execution; handoff + auto-followup remain OFF.
8. First production-mode lease is issued and bound to the exact G6 authorization + pilot-send reservation.
9. Quota uses `America/Toronto` for the Ontario scope.
10. With total cap = 1, a second otherwise-valid reservation is blocked by `pilot_total_send_cap_reached` and creates no second lease.
11. Revoking the G6 authorization invalidates it immediately.
12. Consumption of the already-issued unconsumed lease is BLOCKED by `authorization_revoked` and does not burn the lease.
13. Transaction rolls back all synthetic data and temporary gate changes.

OAT discovery: PostgreSQL does not support `min(uuid)`. The initial authorization lookup was corrected to explicit count + deterministic UUID selection before the final PASS.

## 6. Acceptance migration ledger

First slice:

- `20260828174019_growth_layer_g6_commissioning_readiness_foundation.sql`
- `20260828174128_growth_layer_g6_business_unit_status_hotfix.sql`
- `20260828174232_growth_layer_g6_active_human_approver_hotfix.sql`
- `20260828174425_growth_layer_g6_provider_readiness_alignment_hotfix.sql`

Second slice:

- `20260828181425_growth_layer_g6_staged_activation_quota_provider_lease.sql`
- `20260828181714_growth_layer_g6_provider_lease_uuid_selection_hotfix.sql`

Clean-source migrations contain the final corrected state; hotfix-version files are retained as documented no-op ledger reconciliation where the clean consolidated migration already includes the fix.

## 7. Real commissioning state

**BLOCKED AT COMMISSIONING.** No real commissioning evidence, sender identity, provider binding, provider credentials, provider activation approval or HEMS live-pilot approval was fabricated.

Current real prerequisites still include:

- Ontario/Canada CASL operating/legal approval for the chosen pilot scope;
- Arizona/US CAN-SPAM operating/legal approval for any US pilot scope;
- provider/security selection and review;
- credentials stored externally, not repo/database plaintext;
- approved sender identity plus current SPF/DKIM/DMARC evidence;
- event-derived healthy sender state;
- monitoring/alerting operational proof;
- emergency-stop/rollback approval;
- staff SOP/training approval;
- exact micro-pilot policy;
- HEMS live-pilot approval.

Until these are real, the correct outcome is BLOCKED, not a bypass.

## 8. Next G6 engineering work

1. Formalize pilot monitoring/go-no-go and emergency-stop evidence around the existing G2 complaint/bounce/sender-health rules.
2. Add the separately governed **handoff-pilot stage** only after manual-email pilot proof. It must require `serviceos_handoff_pilot_ready`, a tiny explicit handoff cap and the existing G4 authorization/lease/atomic handoff path.
3. Keep `growth_serviceos_handoff_enabled=false` until that later stage is approved.
4. Keep `growth_auto_followup_enabled=false` until manual sequence quality is proven; auto-followup remains the last stage.
5. Use G5 dashboard v2 for pilot evidence; G5 recommendations remain advisory and sample-gated.
6. Complete CI/PR review and merge the G6 engineering foundation without activating it.

## 9. Commissioning exit criteria

G6 can move from engineering foundation to a real controlled live pilot only when legal/compliance, provider/security, sender authentication/health, monitoring, rollback, training, exact pilot policy and HEMS approvals are current; server-side staged authorization passes; all relevant OAT/CI checks are green; and Production ServiceOS remains protected until the separately authorized G4 handoff stage.
