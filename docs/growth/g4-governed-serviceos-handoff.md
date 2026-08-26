# Growth Layer 1.0 — G4 Governed Growth → ServiceOS Handoff

## Purpose

G4 is the only authorized architectural doorway from Growth into canonical ServiceOS Revenue.

Growth remains a separate layer above ServiceOS. Repository co-location does not change system ownership. Growth owns prospecting, enrichment, outreach evidence, qualification evidence, and the pre-handoff candidate. ServiceOS remains the canonical system of record once a governed handoff succeeds. HEMS remains the governance authority.

## Canonical ownership

Growth owns the qualified pre-handoff candidate and its evidence.

ServiceOS owns all canonical operating records after handoff, including:

- customer
- contact
- service location
- service request
- opportunity
- estimate / pricing snapshot
- quote / quote version / quote response
- conversion
- job handoff / operational job
- finance and accounting

Growth may retain references to canonical ServiceOS IDs after a successful handoff, but those references never become competing lifecycle authority.

## G4 entry condition

A Growth candidate may enter G4 preflight only when all of the following remain true at evaluation time:

1. exact organization / business unit / jurisdiction scope resolves,
2. Growth prospect lifecycle is `handoff_ready`,
3. the handoff candidate is current and has not already succeeded or been terminally cancelled,
4. the latest human qualification review remains `qualified`,
5. verified service need is true,
6. supported geography is true,
7. verified reachable contact is true,
8. contact candidate is accepted and verified,
9. no active suppression exists,
10. latest reply is not opt-out,
11. no later terminal Growth state exists,
12. G3 candidate still carries `g4_required=true`,
13. G3 candidate still carries `serviceos_handoff_authorized=false`,
14. no canonical ServiceOS IDs are already attached unexpectedly,
15. a deterministic Growth idempotency identity exists,
16. source attribution and jurisdiction resolve to canonical ServiceOS records,
17. canonical external-reference and idempotency checks are conflict-free.

A score, scrape, open, click, AI inference, stale qualification, historical positive reply, or disabled suppression record is never sufficient.

## Foundation implemented

### 1. Deterministic application preflight

`src/growth/g4ServiceOSHandoffPreflight.js` evaluates Growth eligibility and canonical boundary conflicts without writing ServiceOS objects.

With the handoff gate OFF, the application preflight returns `READY_EXCEPT_HANDOFF_GATE` and mutation authorization remains false.

### 2. Authoritative immutable reservation

`growth.serviceos_handoff_reservation` provides a service-role-only database reservation that rechecks authoritative Growth state and canonical duplicate/idempotency evidence. The reservation is immutable and carries deterministic canonical identities for the handoff candidate, ServiceOS service request, and opportunity.

### 3. Canonical dry-run plan

`growth.serviceos_handoff_plan` and `public.growth_g4_build_serviceos_handoff_dry_run_plan(...)` resolve, without mutation:

- canonical marketing source and optional campaign,
- same-business-unit customer identity reuse versus create-new identity,
- cross-business-unit and ambiguous identity blockers,
- customer/contact/service-location create/reuse/omit actions,
- qualified ServiceOS service-request and opportunity payloads,
- canonical external-reference identities,
- canonical idempotency collisions,
- deterministic SHA-256 `object_plan_hash`.

A valid dry run returns `READY_EXCEPT_HANDOFF_AUTHORIZATION`; it never creates a canonical ServiceOS object.

### 4. Human/governance authorization and revocation

`growth.serviceos_handoff_authorization` is an immutable approval bound to the exact organization, business unit, jurisdiction, reservation, plan, handoff candidate, prospect, reservation request hash, and `object_plan_hash`.

Authorization requires an active human `app_user`, a reason/reference, and an expiry no later than 24 hours. The authorization RPC re-evaluates the live dry-run state so a later suppression, opt-out, terminal qualification state, canonical identity change, source drift, or plan-hash drift invalidates the authorization.

Revocation is represented by a separate immutable `growth.serviceos_handoff_authorization_revocation` record.

With `growth_serviceos_handoff_enabled=false`, a valid authorization remains `AUTHORIZED_EXCEPT_HANDOFF_GATE` and cannot be executed.

### 5. Short-lived single-use execution lease

`growth.serviceos_handoff_execution_lease` can be issued only when the handoff gate is ON at that exact evaluation time and the authorization remains current.

The lease:

- is bound to the exact authorization/reservation/plan/candidate/hash,
- expires in no more than 10 minutes and never beyond authorization expiry,
- returns a cryptographically random raw token once,
- stores only the SHA-256 token hash,
- permits only an `issued` → `consumed|expired|revoked` transition,
- cannot be duplicated for the same authorization/plan/reservation/candidate.

### 6. Atomic canonical ServiceOS execution

`public.growth_g4_execute_serviceos_handoff(...)` is service-role-only, `SECURITY DEFINER`, and uses an empty `search_path`.

Immediately before mutation it locks and validates the execution lease, execution-token hash, feature gate, authorization, dry-run plan, reservation lineage, current Growth eligibility, and canonical idempotency record.

Inside one database transaction it follows the immutable dry-run plan to create or reuse the canonical identity set and then creates the canonical qualified ServiceOS entry point:

- customer — create or reuse,
- contact — create or reuse,
- service location — create, reuse, or omit as planned,
- service request — canonical `qualified`,
- opportunity — canonical `qualified`,
- canonical external references,
- canonical idempotency response.

After the canonical records exist, Growth stores only by-reference acknowledgement IDs on the handoff candidate, marks the candidate succeeded, consumes the lease, and records an immutable Growth audit event. ServiceOS owns the downstream lifecycle from that point forward.

Any exception rolls back the canonical writes, Growth acknowledgement, lease consumption, and idempotency response together.

## Idempotency contract

G4 uses the canonical ServiceOS idempotency scope `growth_g4_serviceos_handoff` and deterministic key `handoff_candidate:<candidate_uuid>`.

A completed handoff persists its response in `public.idempotency_key`. Replaying the same consumed lease with the same valid token returns the stored canonical result with `idempotent_replay=true`; it does not create duplicate customer, service request, or opportunity records. A mismatched request hash blocks fail-closed.

## Fail-closed rules

G4 blocks when any protected condition drifts, including:

- organization / business unit / jurisdiction scope,
- contact verification/acceptance,
- suppression or opt-out state,
- latest qualification state,
- human approval validity or revocation,
- authorization expiry,
- reservation/plan/candidate/prospect lineage,
- object-plan hash,
- canonical source/campaign resolution,
- canonical identity ambiguity or cross-business-unit conflict,
- canonical external-reference or idempotency collision,
- execution-token mismatch,
- lease expiry/revocation/consumption inconsistency,
- disabled ServiceOS handoff gate.

## Security boundary

Growth handoff tables are private/RLS-enabled and are not exposed for browser mutation. Controlled RPCs are revoked from `public`, `anon`, and `authenticated` and granted to `service_role` where required. Trigger-only guard functions are also explicitly revoked from RPC execution by anon/authenticated roles. New G4 SECURITY DEFINER functions use `search_path=''`.

## Acceptance proof

Acceptance OAT coverage:

- OAT 013 — authoritative reservation, replay, immutability, collision, suppression, missing-candidate and zero-ServiceOS-mutation proof,
- OAT 014 — canonical dry-run plan, attribution/identity blockers, deterministic replay, suppression re-block, zero canonical mutation,
- OAT 015 — human authorization, hash mismatch, replay, stale suppression invalidation, revocation and zero canonical mutation,
- OAT 016 — gate-OFF lease refusal; rollback-only gate-ON single-use lease issue, hash-only token storage, duplicate refusal and revocation,
- OAT 017 — rollback-only atomic canonical handoff, canonical lineage assertions, Growth acknowledgement, consumed lease, external references, canonical idempotency and duplicate-free replay.

All Acceptance scenarios finish with rollback-zero synthetic artifacts and the persistent handoff gate OFF.

GitHub PR CI remains a separate regression layer: application tests and build run without privileged Acceptance database credentials. Database OAT is executed against the connected Acceptance project rather than embedding service credentials in pull-request CI.

## Activation state

G4 is **foundation complete but not activated** once merged.

The persistent execution controls remain OFF unless a later governed production-readiness milestone explicitly changes them:

- `growth_outreach_enabled=false`
- `growth_auto_followup_enabled=false`
- `growth_provider_execution_enabled=false`
- `growth_serviceos_handoff_enabled=false`

Merging G4 does not authorize production handoff, outreach, provider execution, automatic follow-up, or any ServiceOS production mutation.

## Next milestone

After G4 merge/closure, G5 may build analytics, attribution, feedback loops, campaign optimization, and an operating dashboard across the source → prospect → outreach → reply → qualification → governed handoff → canonical ServiceOS opportunity/quote/acceptance/revenue chain without moving canonical ServiceOS ownership into Growth.
