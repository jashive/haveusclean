# Growth Layer 1.0 — G2 Controlled Outreach Foundation

Status: FOUNDATION ONLY — NO OUTREACH ACTIVATION

## Purpose
G2 adds controlled outbound capability above ServiceOS without changing ServiceOS ownership or canonical lifecycle. This document defines the first implementation boundary for compliance, deliverability, suppression, consent evidence, send eligibility, human approval and immutable auditing.

## Locked architectural boundary
- Growth remains separate from ServiceOS.
- Growth may prepare and send controlled outreach only after G2 eligibility passes.
- Growth may not create canonical ServiceOS Revenue objects from opens, clicks, scores, scraped data, inferred intent or campaign activity.
- ServiceOS handoff remains a later governed milestone.
- Production ServiceOS and Wave 6 are out of scope.

## Jurisdiction policy split
### Ontario / Canada
Commercial electronic messages are fail-closed unless the record contains a documented CASL basis that the business has explicitly classified as valid for the intended message. The system must store the consent/basis type, source, evidence reference, captured/observed date, any expiry/reassessment date, and reviewer when human judgment is required.

### Arizona / United States
Commercial email may be eligible without prior opt-in only if the message satisfies applicable CAN-SPAM controls and all HUC suppression/deliverability rules. Marketing texts and automated/telemarketing calls are not authorized by this foundation; those channels remain disabled pending channel-specific consent and telemarketing controls.

## Mandatory G2 controls before any send
1. Global suppression check across email/phone/domain/contact/org identifiers where available.
2. Per-channel eligibility. Email, SMS and phone are separate decisions.
3. Jurisdiction policy check using canonical Growth scope.
4. Consent/legal-basis evidence where required.
5. Verified/reachable contact requirement; inferred identity alone is not enough.
6. Sender identity and postal-address configuration.
7. Unsubscribe mechanism for commercial email and immediate internal suppression on request.
8. Bounce and complaint suppression.
9. Frequency caps and campaign cooldowns.
10. Stop-on-reply and stop-on-opt-out.
11. Human approval for pilot sends.
12. Immutable send-attempt, approval, delivery-event and suppression audit records.
13. Feature gate `GROWTH_OUTREACH_ENABLED` must remain false until G2 acceptance passes and explicit activation is approved.
14. `GROWTH_AUTO_FOLLOWUP_ENABLED` and `GROWTH_SERVICEOS_HANDOFF_ENABLED` remain false throughout G2 foundation work.

## Initial channel policy
- Email: design/acceptance work allowed; sending remains gated OFF.
- SMS: prohibited by this foundation; no send eligibility.
- Automated/telemarketing phone: prohibited by this foundation; no send eligibility.
- Manual sales calls: future policy work required before being represented as system-authorized outreach.
- LinkedIn/social messaging: future platform-policy and compliance review required before automated use.

## Minimum data contract for outreach eligibility
A future G2 eligibility evaluator must consume at least:
- organization_id
- business_unit_id
- jurisdiction_id
- country_code
- subdivision_code
- channel
- contact candidate identity and verification state
- suppression state
- consent/legal-basis record when required
- campaign_id
- most recent outbound time
- reply state
- bounce/complaint state
- human approval state
- feature-gate state

It must return a deterministic decision:
- `eligible: true|false`
- `decision_code`
- `blocking_reasons[]`
- `policy_version`
- `requires_human_approval`

## Fail-closed decision examples
- Ontario email without documented CASL basis => BLOCKED.
- Any suppressed contact => BLOCKED.
- Any SMS or automated marketing call under this foundation => BLOCKED.
- Contact inferred but not verified/reachable => BLOCKED.
- Outreach feature gate false => BLOCKED.
- Prior unsubscribe, hard bounce or complaint => BLOCKED.
- Reply received => BLOCKED from automated follow-up.

## Acceptance criteria before outreach can be enabled
- Deterministic jurisdiction-aware eligibility code and unit tests.
- Database schema for legal-basis/consent evidence, suppressions, send approvals and send audit.
- Service-role mutation guards and exact organization/business-unit scope checks.
- Pilot fixture uses synthetic non-contactable addresses only.
- Rollback/cleanup OAT in Acceptance.
- Ontario and Arizona test matrices include positive and negative cases.
- Unsubscribe, bounce, complaint, duplicate, cross-BU and cross-jurisdiction fail-closed tests.
- Human-approval workflow proven.
- Sender-domain/authentication and deliverability checklist completed before real sending.
- HEMS checkpoint and explicit activation approval.

## Feature-gate state during this milestone
- `GROWTH_LAYER_ENABLED`: may remain enabled in Acceptance.
- `GROWTH_OUTREACH_ENABLED`: MUST remain false.
- `GROWTH_AUTO_FOLLOWUP_ENABLED`: MUST remain false.
- `GROWTH_SERVICEOS_HANDOFF_ENABLED`: MUST remain false.

## External compliance baseline used for this foundation
- U.S. commercial email: FTC CAN-SPAM requirements, including accurate routing/header information, non-deceptive subject lines, ad identification where required, a valid physical postal address, a clear opt-out mechanism, and timely honoring of opt-outs.
- Canada: CASL commercial electronic message controls requiring an applicable consent/basis plus sender identification and unsubscribe requirements.
- U.S. marketing texts/automated calls: channel-specific TCPA/FCC controls are stricter than ordinary email, so those channels remain disabled at this stage.

This is an engineering/compliance control baseline, not legal advice. HUC should obtain counsel review before scaled outbound activation.
