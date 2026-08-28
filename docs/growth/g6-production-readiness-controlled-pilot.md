# Growth Layer G6 — Production Readiness & Controlled Pilot Commissioning

Status: **IN PROGRESS — engineering readiness foundation implemented in Acceptance; commissioning remains BLOCKED; no Growth execution gate activated.**

Branch: `growth/g6-production-readiness-pilot`
Base: G5 merge/main `4a343e638d28aa88a64bd790db241a654afb256e`
Acceptance project: `HEMS_Growth_Dev` (`hqeamecwdsrjfjybrsox`)
Production ServiceOS is out of scope for this slice and was not modified.

## 1. Purpose

G6 is the commissioning and controlled-pilot layer for Growth Layer 1.0. It does not create another outreach system or another operational lifecycle. It governs whether the already-built G2 outreach/provider controls and G4 ServiceOS handoff controls have enough approved evidence to request a tightly scoped activation.

HEMS remains the governance authority. ServiceOS remains the canonical operational system of record after a governed handoff.

## 2. Protected starting state

The following persistent execution gates remain OFF:

- `growth_outreach_enabled=false`
- `growth_auto_followup_enabled=false`
- `growth_provider_execution_enabled=false`
- `growth_serviceos_handoff_enabled=false`

`growth_layer_enabled=true` remains the non-execution layer gate.

At G6 start, Acceptance contained zero sender identities, sender-auth evidence, sender-health snapshots, provider adapter contracts, provider adapter allowlist records, provider runtime bindings, provider activation approvals, and provider execution leases. G6 therefore starts from a deliberately non-commissioned state.

## 3. Reuse of existing controls

G6 reuses G2 rather than duplicating it. G2 remains authoritative for:

- sender identity and approval;
- SPF/DKIM/DMARC evidence;
- event-derived sender health;
- provider adapter contract metadata;
- adapter allowlisting;
- runtime binding and external credential state;
- human provider activation approval;
- short-lived provider execution leases;
- suppression, reply stops, cooldown, frequency, bounce and complaint controls;
- provider emergency suspension/revocation.

G6 also reuses G4 rather than duplicating the handoff path. G4 remains authoritative for qualified Growth→ServiceOS handoff authorization, short-lived execution leases, deterministic idempotency, canonical dedupe and atomic ServiceOS mutation.

## 4. First G6 engineering slice

### 4.1 Immutable commissioning evidence

Private table: `growth.commissioning_evidence`

Allowed evidence types:

1. `legal_compliance_approval`
2. `provider_security_review`
3. `sender_domain_readiness`
4. `monitoring_alerting_readiness`
5. `rollback_emergency_stop_readiness`
6. `staff_sop_training_ready`
7. `serviceos_handoff_pilot_ready`
8. `hems_pilot_approval`

Evidence is scoped to organization, business unit, jurisdiction and environment. It is time-bounded, idempotent, SHA-256 request-hashed, human-approved and append-only. Revocation is recorded separately in `growth.commissioning_evidence_revocation`.

The first manual-email stage requires all evidence above except `serviceos_handoff_pilot_ready`; handoff is intentionally disabled in this stage.

### 4.2 Bounded pilot policy

Private table: `growth.pilot_policy`

Version: `g6-pilot-policy-v1`

The first policy stage is deliberately narrow:

- `pilot_stage=manual_email_outreach`
- email only;
- daily send cap: 1–25;
- total send cap: 1–100;
- `handoff_cap=0`;
- `auto_followup_allowed=false`;
- `sms_allowed=false`;
- `phone_allowed=false`;
- `kill_on_any_complaint=true`;
- sender-health policy bound to `g2-sender-health-2026-08-23`;
- maximum policy validity: 7 days.

Policy revocation is separately immutable in `growth.pilot_policy_revocation`.

### 4.3 Service-role write/read boundary

Service-role-only RPCs:

- `public.growth_g6_record_commissioning_evidence(...)`
- `public.growth_g6_revoke_commissioning_evidence(...)`
- `public.growth_g6_record_pilot_policy(...)`
- `public.growth_g6_revoke_pilot_policy(...)`
- `public.growth_g6_commissioning_readiness(...)`

All G6 evidence/policy tables have RLS enabled and intentionally have no anon/authenticated browser policies. SECURITY DEFINER RPCs use empty `search_path`; SHA-256 hashing is explicitly schema-qualified through `extensions.digest(...)`.

### 4.4 Read-only commissioning readiness

Readiness version: `g6-commissioning-readiness-v1`

`public.growth_g6_commissioning_readiness(...)` checks:

- exact active organization/business-unit/jurisdiction scope;
- environment (`acceptance` or `production`);
- current unrevoked required commissioning evidence;
- current unrevoked pilot policy;
- existing G2 sender readiness;
- approved matching G2 provider runtime binding;
- matching G2 adapter allowlist including adapter version;
- matching G2 provider activation approval;
- in production, runtime credentials must be externally configured;
- all protected Growth execution gates are still OFF before a staged activation request.

It returns either `BLOCKED` or `READY_FOR_STAGED_ACTIVATION_REQUEST`.

Crucially, this first slice always returns:

- `execution_authorized=false`
- `gate_mutation_performed=false`

It does not activate or mutate a gate.

## 5. Current real readiness

Representative Ontario and Arizona Acceptance scopes both correctly return `BLOCKED`.

Current blockers are:

- missing/inactive legal-compliance approval;
- missing/inactive provider-security review;
- missing/inactive sender-domain readiness;
- missing/inactive monitoring/alerting readiness;
- missing/inactive rollback/emergency-stop readiness;
- missing/inactive staff SOP/training readiness;
- missing/inactive HEMS pilot approval;
- missing/inactive pilot policy.

No real commissioning evidence or provider/sender approval was fabricated to make the result green.

## 6. OAT 024 — commissioning foundation

Acceptance rollback-only test: `supabase/tests/growth-g6-commissioning-foundation-oat.sql`

Final result: **PASS**.

OAT 024 proves:

- empty readiness fails closed;
- commissioning evidence is idempotent;
- exact replay returns the same ID;
- changed payload under an existing idempotency key is blocked;
- evidence and policy tables are append-only;
- pilot policy is idempotent and collision-protected;
- even with synthetic commissioning evidence and a synthetic pilot policy, missing G2 sender/provider readiness keeps G6 BLOCKED;
- expected blockers include sender not ready, runtime binding missing, adapter not allowlisted and provider activation approval missing;
- first-stage policy enforces handoff cap zero and prohibits auto-followup, SMS and phone;
- revoking required evidence immediately invalidates readiness;
- no readiness call authorizes execution or mutates a gate;
- all protected execution gates remain OFF.

All synthetic OAT rows were rolled back. Post-test residue for G6-OAT evidence, revocations and pilot policy is zero.

## 7. Acceptance integration corrections discovered during OAT

Acceptance-first validation caught and corrected three schema assumptions before any activation path existed:

1. `public.business_unit` uses `status='active'`, not `is_active`.
2. `public.app_user` does not carry `organization_id`; active-human approval follows the existing ServiceOS/Growth pattern while org/BU/jurisdiction scope is enforced independently.
3. `growth.provider_runtime_binding` does not store `adapter_version`; adapter version belongs to allowlist/activation records, and provider activation uses `approval_status`.

The clean-source migration contains the corrected final state. Three no-op migration-history reconciliation files retain the exact Acceptance migration ledger so future Supabase migration tooling can reconcile cleanly.

## 8. What G6 does not yet authorize

G6 is not complete and production commissioning is not approved.

This slice does **not** authorize:

- real outbound provider execution;
- persistent outreach gate activation;
- automatic follow-up;
- SMS or phone outreach;
- Growth→ServiceOS handoff activation;
- production ServiceOS mutation;
- bypassing G2 sender-health, legal-basis, suppression or provider controls;
- bypassing G4 qualification/handoff controls.

## 9. Next engineering slice — staged activation authorization

The next G6 boundary must bind a human commissioning authorization to an exact, current readiness state and pilot policy. It must not expose a generic all-gates toggle.

Required design:

1. Immutable staged-activation authorization bound to exact org/BU/jurisdiction/environment, pilot policy, sender/provider scope and readiness evidence.
2. Authorization invalidation when policy/evidence/sender/provider readiness changes or is revoked.
3. Existing G2 provider-execution lease issuance hardened so a production/live-provider lease cannot be issued without current G6 pilot authorization.
4. Pilot caps enforced server-side, not only documented.
5. Existing G2 sender-health emergency stop reused so complaint/bounce/health triggers can suspend/revoke execution eligibility immediately.
6. Provider/outreach micro-pilot first; ServiceOS handoff remains OFF.
7. Separate later handoff-pilot readiness must require `serviceos_handoff_pilot_ready`, a tiny explicit handoff cap and the existing G4 authorization/lease path.
8. Auto-followup remains the last activation stage and requires separate approval after manual sequence quality is proven.

## 10. Pilot monitoring and go/no-go

G5 dashboard v2 remains the read-only measurement surface for funnel, latency, finance, campaign outcomes and sample-gated optimization observations. G5 recommendations remain advisory only.

Before expansion, G6 must define and operate a review cadence covering:

- delivery;
- hard bounce rate;
- complaints;
- sender-health state;
- reply/positive-interest rate;
- qualification quality;
- suppression/opt-out handling;
- duplicate/error rate;
- handoff quality once separately authorized;
- quote/acceptance/conversion outcomes when enough sample exists;
- CAC/ROAS/contribution ROI only where valid evidence and sample size exist.

The existing conservative G2 rule—any complaint is blocking—remains in force for the first pilot.

## 11. Commissioning exit criteria

G6 can only move from engineering-ready to controlled live pilot when all of the following are true:

- applicable CASL/CAN-SPAM/legal-basis operating approval is documented for the pilot scope;
- provider/security review is documented;
- live provider selected and credentials provisioned outside repo/database plaintext;
- sender identity is approved;
- SPF, DKIM and DMARC evidence is current;
- event-derived sender health is acceptable;
- monitoring and alerting are operational;
- emergency stop/rollback runbook is approved;
- staff SOP/training is approved;
- exact micro-pilot policy is approved;
- HEMS pilot approval is current;
- staged activation authorization passes server-side readiness;
- all relevant OAT and CI checks are green;
- production ServiceOS remains protected until the separately governed handoff stage.

Until then, the correct state is **BLOCKED AT COMMISSIONING**, not bypassed.
