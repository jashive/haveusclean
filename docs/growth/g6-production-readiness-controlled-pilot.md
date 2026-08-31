# Growth Layer G6 — Production Readiness & Controlled Pilot Commissioning

Status: **ENGINEERING FOUNDATION COMPLETE IN ACCEPTANCE / LIVE COMMISSIONING BLOCKED / NOT ACTIVATED.**

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

No migration or authorization RPC in G6 turns an execution gate ON.

## 2. Slice 1 — commissioning evidence and pre-activation readiness

Private/RLS/append-only tables:

- `growth.commissioning_evidence`
- `growth.commissioning_evidence_revocation`
- `growth.pilot_policy`
- `growth.pilot_policy_revocation`

Evidence types:

- legal/compliance approval
- provider security review
- sender-domain readiness
- monitoring/alerting readiness
- rollback/emergency-stop readiness
- staff SOP/training readiness
- ServiceOS handoff-pilot readiness
- HEMS pilot approval.

First-stage policy is deliberately narrow: manual email only, daily cap 1–25, total cap 1–100, handoff cap 0, auto-followup/SMS/phone false, kill on any complaint, maximum policy validity 7 days.

`growth_g6_commissioning_readiness(...)` is a pre-activation evaluator. It requires all protected execution gates OFF, reuses G2 sender/provider readiness, returns `BLOCKED` or `READY_FOR_STAGED_ACTIVATION_REQUEST`, never mutates a gate, and always reports `execution_authorized=false`.

**OAT 024 PASS** — fail-closed empty state, idempotency/collision rejection, append-only controls, evidence revocation, sender/provider blockers, channel/handoff restrictions, no gate mutation and zero synthetic residue.

## 3. Slice 2 — staged activation authorization and server-side send quota

Private/RLS/append-only tables:

- `growth.staged_activation_authorization`
- `growth.staged_activation_authorization_revocation`
- `growth.pilot_send_reservation`

`growth_g6_runtime_prerequisite_snapshot(...)` derives the exact pilot policy, commissioning evidence IDs, sender readiness, provider runtime binding, adapter allowlist, activation approval and canonical jurisdiction timezone, then SHA-256 fingerprints that state.

`growth_g6_record_staged_activation_authorization(...)` can be recorded only when pre-activation readiness is green while gates are still OFF. It binds an active human approval to exact scope, policy/request hash, evidence/runtime fingerprint and a validity window no longer than 24 hours or the pilot-policy expiry. It does not mutate a gate.

`growth_g6_evaluate_staged_activation_authorization(...)` fails closed on expiry, revocation, policy/evidence/sender/provider drift, or premature auto-followup/ServiceOS-handoff activation.

`growth_g6_reserve_pilot_send_for_provider_lease(...)` serializes quota decisions by locking the authorization row and applies daily + total caps using the canonical jurisdiction timezone (`America/Toronto` for Ontario, `America/Phoenix` for Arizona). Reserved quota is conservative and is not automatically released.

### G2 provider-lease hardening

For `environment_name='production'`, the existing G2 lease path now additionally requires exactly one current G6 staged authorization and a G6 pilot-send reservation. Production lease records link to both. Consumption rechecks G6, so later revocation or drift blocks an already-issued lease.

Acceptance/non-production behavior remains compatible with G2.

**OAT 025 PASS** proved:

- old G2 outreach/provider gates alone cannot issue a production-mode lease;
- staged authorization is recorded with all gates OFF;
- the first production-shaped lease is G6-bound;
- Ontario quota uses `America/Toronto`;
- a one-send total cap blocks a second otherwise-valid reservation;
- revocation blocks consumption of an already-issued lease;
- all temporary gate changes and synthetic state roll back.

OAT 025 also caught and fixed PostgreSQL `min(uuid)` incompatibility before final PASS.

## 4. Slice 3 — emergency stop and separately capped G4 handoff pilot

Private/RLS/append-only tables:

- `growth.handoff_pilot_policy`
- `growth.handoff_pilot_policy_revocation`
- `growth.handoff_pilot_reservation`

### Handoff-pilot evidence and policy

A live handoff micro-pilot requires current production-scoped evidence for:

- `serviceos_handoff_pilot_ready`
- `monitoring_alerting_readiness`
- `rollback_emergency_stop_readiness`
- `staff_sop_training_ready`
- `hems_pilot_approval`.

`growth_g6_record_handoff_pilot_policy(...)` requires the ServiceOS handoff gate OFF, an active human approver, current evidence and an explicit cap of **1–5 handoffs**. Policy validity is at most 24 hours. Approval itself performs no gate mutation.

`growth_g6_evaluate_handoff_pilot_policy(...)` detects expiry/revocation/evidence drift and reports remaining handoff capacity.

`growth_g6_reserve_handoff_pilot_slot(...)` locks the current policy and enforces the cap server-side, one slot per G4 handoff authorization.

### G4 hardening

The existing G4 authorization/plan/idempotency/lease/atomic handoff remains authoritative. G6 wraps rather than replaces it.

When `growth_serviceos_handoff_enabled=true`:

- `growth_g4_evaluate_serviceos_handoff_authorization(...)` now also requires a current G6 handoff-pilot policy;
- `growth_g4_issue_serviceos_handoff_execution_lease(...)` must reserve a G6 handoff slot and stores the G6 policy/reservation linkage;
- the normal G4 execute path reevaluates authorization and therefore validates the G6 policy/lease binding before canonical mutation.

The G4 gate + G4 human authorization alone are no longer sufficient to issue a handoff lease.

### Emergency stop

`growth_g6_emergency_stop_outreach_pilot(...)` is human-operated and safety-only. It can only reduce execution eligibility. It:

- revokes the staged G6 authorization;
- forces outreach, provider execution and auto-followup gates OFF;
- revokes linked issued provider execution leases;
- suspends the matching provider runtime binding;
- suspends the matching adapter allowlist;
- revokes matching provider activation approval;
- records a Growth audit event.

`growth_g6_revoke_handoff_pilot_policy(...)` revokes the handoff policy, forces the ServiceOS handoff gate OFF, and revokes any issued linked handoff leases.

Existing G2 event-derived sender health remains an automatic fail-closed layer. The current conservative policy marks any complaint as blocking; blocked/stale/non-healthy sender readiness invalidates G6 authorization and production lease eligibility/consumption even before a human emergency stop is invoked.

**OAT 026 PASS** proved:

- G4 gate + G4 authorization cannot bypass a missing G6 handoff-pilot policy;
- a cap=1 handoff policy can be approved while the gate is OFF without mutating it;
- the first G6-bound G4 lease executes the full existing atomic ServiceOS handoff successfully;
- canonical qualified `service_request` + qualified `opportunity` are created through G4, not through a new G6 lifecycle;
- a second otherwise-valid handoff is blocked by `handoff_pilot_cap_reached`;
- handoff-policy revocation forces the handoff gate OFF;
- outreach emergency stop forces outreach/provider/auto-followup OFF and revokes/suspends provider execution controls;
- all synthetic ServiceOS/Growth state and temporary gate changes roll back.

## 5. Monitoring and go/no-go contract

G6 does not create another analytics engine. G5 dashboard v2 remains the pilot evidence surface. G5 optimization recommendations remain advisory and sample-gated.

The first live manual-email pilot must be reviewed at least daily while active. Immediate STOP conditions inherit G2’s conservative sender-health policy:

- any complaint;
- 3 or more hard bounces in the evaluation window;
- complaint rate >= 0.001;
- hard-bounce rate >= 0.02;
- sender-health status not `healthy` or stale/non-event-derived health;
- legal/suppression/opt-out/reply stop violation;
- provider/runtime/allowlist/activation drift;
- G6 evidence/policy/authorization revocation or expiry;
- execution outside approved quota.

Warnings requiring human review before expansion include any hard bounce or hard-bounce rate >= 0.01.

Pilot review also tracks delivery, replies, positive interest, qualification quality, duplicate/error rate, handoff quality once separately activated, quote/acceptance/conversion and cost/ROAS/contribution only when G5 sample/evidence rules permit valid interpretation.

## 6. Acceptance migration ledger

- `20260828174019_growth_layer_g6_commissioning_readiness_foundation.sql`
- `20260828174128_growth_layer_g6_business_unit_status_hotfix.sql`
- `20260828174232_growth_layer_g6_active_human_approver_hotfix.sql`
- `20260828174425_growth_layer_g6_provider_readiness_alignment_hotfix.sql`
- `20260828181425_growth_layer_g6_staged_activation_quota_provider_lease.sql`
- `20260828181714_growth_layer_g6_provider_lease_uuid_selection_hotfix.sql`
- `20260828182354_growth_layer_g6_emergency_stop_handoff_pilot.sql`

Clean-source consolidated migrations contain final corrected logic; the hotfix-version no-op files preserve the exact Acceptance migration ledger where the fix is already incorporated into the clean migration.

Acceptance proof:

- OAT 024 — commissioning readiness foundation — PASS
- OAT 025 — staged activation/quota/production provider lease — PASS
- OAT 026 — emergency stop/capped G4 handoff pilot — PASS

## 7. Real commissioning state

**BLOCKED AT COMMISSIONING.** No real legal approval, provider selection/credential, approved sender identity, DNS evidence, sender-health history, monitoring signoff, staff-training signoff, live pilot policy or HEMS live-pilot approval was fabricated.

Required before a real manual-email micro-pilot:

1. Applicable Ontario/Canada CASL approval for the exact Canadian pilot scope and/or Arizona/US CAN-SPAM approval for a separately approved US scope.
2. Provider/security review and provider selection.
3. Credentials stored externally, never in repo/database plaintext.
4. Approved sender identity.
5. Current SPF/DKIM/DMARC evidence.
6. Event-derived healthy sender state.
7. Monitoring/alerting operational evidence.
8. Emergency-stop/rollback approval.
9. Staff SOP/training approval.
10. Exact short-lived pilot policy/caps.
11. HEMS live-pilot approval.
12. Current G6 staged authorization while gates are still OFF.
13. Deliberate micro-stage activation of only the approved gates.

A later ServiceOS handoff pilot additionally requires `serviceos_handoff_pilot_ready`, a 1–5 handoff policy, current HEMS approval and the existing G4 human authorization for each candidate.

Auto-followup remains the last stage and stays OFF until manual sequence quality is proven and separately authorized.

## 8. G6 completion meaning

The **engineering foundation is complete** when CI/PR review is green and this branch is merged. That does **not** mean Growth is live.

The live commissioning decision remains a HEMS-controlled operational decision made only after real external evidence exists. If those prerequisites are absent, the correct production status is `BLOCKED AT COMMISSIONING`, not an engineering workaround.
