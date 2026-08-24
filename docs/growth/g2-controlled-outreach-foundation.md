# Growth Layer 1.0 — G2 Controlled Outreach Foundation

Status: ENGINEERING FOUNDATION COMPLETE — NO OUTREACH ACTIVATION

## Purpose
G2 adds controlled outbound capability above ServiceOS without changing ServiceOS ownership or canonical lifecycle. This document defines the implemented boundary for compliance, deliverability, suppression, consent evidence, send eligibility, human approval, immutable auditing, provider preflight, no-send application execution, provider authorization, and emergency revocation.

## Locked architectural boundary
- Growth remains separate from ServiceOS.
- Growth may prepare controlled outreach only after G2 eligibility passes.
- A future real provider execution requires a separate provider-execution authorization chain in addition to outreach eligibility.
- Growth may not create canonical ServiceOS Revenue objects from opens, clicks, scores, scraped data, inferred intent or campaign activity.
- ServiceOS handoff remains a later governed milestone.
- Production ServiceOS and Wave 6 are out of scope for this G2 foundation.
- Merge of the G2 foundation does not authorize provider credentials, outbound activation, or a real message send.

## Jurisdiction policy split
### Ontario / Canada
Commercial electronic messages are fail-closed unless the record contains a documented CASL basis that the business has explicitly classified as valid for the intended message. The system stores the consent/basis type, source, evidence reference, captured/observed date, expiry/reassessment where applicable, and human review state.

### Arizona / United States
Commercial email may be eligible without prior opt-in only if the message satisfies applicable CAN-SPAM controls and all HUC suppression/deliverability rules. Marketing texts and automated/telemarketing calls are not authorized by this foundation; those channels remain disabled pending channel-specific consent and telemarketing controls.

## Implemented G2 control chain
1. Canonical organization / business-unit / jurisdiction scope validation.
2. Verified and accepted reachable email contact.
3. Jurisdiction-aware legal-basis evidence and human legal-basis review.
4. Human outreach approval with approved subject/body, sender identity, postal-address confirmation, unsubscribe confirmation, and expiry.
5. Global suppression, unsubscribe, hard-bounce, complaint, reply, cooldown, and frequency-cap checks.
6. Sender identity registry bound to exact scope.
7. SPF, DKIM, and DMARC evidence review.
8. Sender health derived from immutable delivery-feedback events with conservative internal thresholds and cold-start handling.
9. Non-sending outreach attempt with first-class sender linkage.
10. Immutable provider-neutral delivery-event ingestion and suppression side effects.
11. Provider adapter capability contract.
12. Immutable submission reservation with deterministic sender, recipient, content, envelope, and submission hashes.
13. Application-level NO-SEND provider adapter harness with no provider SDK, no HTTP client, no credentials, and explicit network-I/O refusal.
14. Provider runtime binding metadata that stores only an external credential reference and state, never the provider secret itself.
15. Exact provider adapter allowlist by scope, environment, adapter key, and adapter version.
16. Human provider activation approval with a maximum 24-hour lifetime.
17. Independent `growth_provider_execution_enabled` gate in addition to `growth_outreach_enabled`.
18. Short-lived single-use provider execution lease, maximum 10 minutes and no longer than the human activation approval.
19. One-time opaque execution token: only its SHA-256 hash is stored; the raw token is returned once and burned on successful consumption.
20. Emergency lifecycle controls for provider runtime bindings, adapter allowlists, activation approvals, and execution leases, with human reviewer, reason, terminal revocation semantics, and audit events.
21. Service-role-only guarded RPC mutation boundaries with pinned empty `search_path`; Growth authorization tables are service-role SELECT-only and have no anon/authenticated table access.
22. Rollback-only Acceptance OAT using synthetic/non-contactable data and no provider/network send path.

## Fail-closed decision examples
- Ontario email without documented accepted CASL basis => BLOCKED.
- Any active suppression => BLOCKED.
- Any SMS or automated marketing call under this foundation => BLOCKED.
- Contact inferred but not verified/reachable => BLOCKED.
- Outreach feature gate false => BLOCKED.
- Provider-execution feature gate false => BLOCKED for any execution lease or lease consumption.
- Provider credentials absent => BLOCKED for execution authorization.
- Provider adapter not allowlisted/current => BLOCKED.
- Human provider activation missing/expired/revoked => BLOCKED.
- Runtime binding or adapter allowlist suspended/revoked => BLOCKED.
- Prior unsubscribe, hard bounce, complaint, or reply state => sequencing/outreach blocked according to policy.
- Expired, revoked, consumed, or wrong-token execution lease => BLOCKED.

## Acceptance evidence
- Deterministic jurisdiction-aware eligibility code and unit tests: PASS.
- Legal-basis, suppression, outreach approval, attempt, event, sender, provider-preflight, and authorization schemas: PASS.
- Service-role mutation guards and exact organization/business-unit/jurisdiction scope checks: PASS.
- Synthetic non-contactable Acceptance fixtures only: PASS.
- Rollback/cleanup OAT in Acceptance: PASS across OAT 003 through OAT 009.
- Ontario and Arizona positive/negative control coverage: PASS.
- Unsubscribe, hard bounce, complaint, reply, cross-scope, cooldown, and attempt-cap fail-closed coverage: PASS.
- Human legal-basis and outreach approval lifecycle: PASS.
- Sender SPF/DKIM/DMARC and health readiness boundary: PASS.
- Immutable provider-neutral delivery feedback and derived health: PASS.
- Provider preflight reservation and deterministic hash boundary: PASS.
- Application NO-SEND adapter and explicit network-I/O refusal: PASS.
- Provider runtime binding, adapter allowlist, human activation approval, independent execution gate, single-use lease/token, and emergency revocation lifecycle: PASS.
- Required G2 tests explicitly executed by both Growth and PR Acceptance CI: PASS.
- HEMS progress checkpoints maintained: PASS.

## Feature-gate state at engineering closure
- `growth_layer_enabled`: true in Acceptance.
- `growth_outreach_enabled`: false.
- `growth_auto_followup_enabled`: false.
- `growth_serviceos_handoff_enabled`: false.
- `growth_provider_execution_enabled`: false.

These persistent OFF states are part of the safety boundary. Foundation merge must not change them.

## Provider / credential state at engineering closure
- No real provider adapter is connected.
- No provider secret is stored in Growth.
- Acceptance structurally rejects `configured_external` credential state.
- No real email has been sent.
- SMS and phone remain unauthorized.
- Production ServiceOS and Wave 6 were not modified by G2 development.

## External compliance baseline used for this foundation
- U.S. commercial email: FTC CAN-SPAM requirements, including accurate routing/header information, non-deceptive subject lines, ad identification where required, a valid physical postal address, a clear opt-out mechanism, and timely honoring of opt-outs.
- Canada: CASL commercial electronic message controls requiring an applicable consent/basis plus sender identification and unsubscribe requirements.
- U.S. marketing texts/automated calls: channel-specific TCPA/FCC controls are stricter than ordinary email, so those channels remain disabled at this stage.

This is an engineering/compliance control baseline, not legal advice. HUC should obtain appropriate legal review before scaled outbound activation.

## Merge boundary
The G2 foundation is eligible for merge only when the exact PR head has passing required CI, Acceptance migration history matches source control, no unresolved review blocker remains, all outbound/provider execution gates are confirmed OFF, persistent authorization tables contain no live provider configuration, and Production remains untouched.

A G2 foundation merge is not an activation event. Provider selection, credential provisioning, real-adapter implementation, activation approvals, controlled pilot authorization, and any gate change require separate later work and explicit authorization.
