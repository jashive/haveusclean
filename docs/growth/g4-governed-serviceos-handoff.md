# Growth Layer 1.0 — G4 Governed Growth → ServiceOS Handoff

## Purpose

G4 is the only authorized architectural doorway from Growth into canonical ServiceOS Revenue.

G4 does **not** make Growth a ServiceOS subsystem and does not allow Growth to own canonical customer, service request, opportunity, estimate, quote, job, finance, or accounting lifecycle state.

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

## G4 entry condition

A Growth candidate may enter G4 preflight only when all of the following remain true at evaluation time:

1. exact organization / business unit / jurisdiction scope resolves,
2. Growth prospect lifecycle is `handoff_ready`,
3. Growth handoff candidate is current (`draft` or future governed `ready`),
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
14. no canonical ServiceOS IDs are already attached to the Growth candidate,
15. a Growth idempotency key exists,
16. source attribution is resolved,
17. canonical external-reference and idempotency checks are conflict-free.

A score, scrape, open, click, AI inference, stale qualification, historical positive reply, or disabled suppression record is never sufficient.

## Gate behavior

`growth_serviceos_handoff_enabled` is independent from every other Growth gate.

With every other precondition satisfied and the handoff gate OFF, preflight returns:

`READY_EXCEPT_HANDOFF_GATE`

This is explicitly non-mutating and does not authorize creation of any ServiceOS object.

If all preconditions pass and the handoff gate is later separately authorized, the application policy may return:

`READY_FOR_GOVERNED_HANDOFF`

That state means only that a separately implemented G4 execution boundary may proceed. It is not itself a mutation.

## Idempotency contract

Future governed execution must use ServiceOS-owned canonical controls:

- `public.external_reference`
- `public.idempotency_key`
- `public.audit_event`

The canonical handoff must be replay-safe. A duplicate Growth candidate or repeated request must return/reuse the same canonical ServiceOS record set rather than creating duplicate customers, service requests, or opportunities.

## Fail-closed rules

G4 must block if:

- scope drifts,
- contact becomes unverified/unaccepted,
- suppression appears,
- opt-out appears,
- qualification becomes nurture/disqualified/suppressed,
- human qualification evidence is absent,
- source/jurisdiction becomes unresolved,
- Growth candidate already contains canonical IDs unexpectedly,
- external-reference or idempotency collision occurs,
- pre-G4 payload claims ServiceOS handoff is already authorized.

## Current implementation state

The initial G4 slice contains only a deterministic application-level preflight policy and tests.

It performs **no database mutation**, **no ServiceOS object creation**, **no provider execution**, and **no network outreach**.

The ServiceOS handoff gate remains OFF in Acceptance and Production Growth remains untouched.

## Next implementation slice

Add the Acceptance-only, service-role-only database preflight/reservation boundary that re-checks authoritative G3 state and canonical ServiceOS duplicate/idempotency evidence at transaction time while the ServiceOS handoff gate remains OFF.

No canonical ServiceOS mutation is authorized until that database boundary is independently proven and a later execution slice is separately approved.
