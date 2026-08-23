# Have Us Clean — Growth Layer 1.0 Architecture & Equivalence Map

Status: BASELINE DRAFT — architecture only
Owner: Growth workstream
Governance authority: HEMS / Google Drive
Operational system of record: ServiceOS 1.0

## 1. Non-negotiable boundary

Growth Layer 1.0 sits above ServiceOS 1.0. It does not replace, fork, or redesign ServiceOS Revenue, Operations, QA, Finance, Auth, permissions, governance, or production cutover semantics.

Growth may hold cold and unqualified prospects. Once a prospect reaches the governed qualification/handoff threshold, Growth must create or update the canonical ServiceOS Revenue records rather than continue as a parallel CRM.

Wave 6 Intelligence is explicitly out of scope and remains inactive.

## 2. Target flow

Lead Mining -> Prospect Database/Queue -> Enrichment/Scoring -> Prospecting Agent -> Cold Outreach -> Follow-up Engine -> Response Classification -> Sales Copilot -> Governed ServiceOS Revenue Handoff

## 3. Existing asset equivalence

| Existing HUC artifact/system | Growth Layer 1.0 role | Disposition |
| --- | --- | --- |
| AI Lead Mining System + Workbook + Manual | Lead Mining + raw prospect intake | Reuse after field/schema audit |
| Prospecting Agent System Blueprint | Prospect research, normalization, drafting, review workflow | Reuse concept and prompts; replace old pipeline ownership assumptions |
| Prospecting Agent Prompt Library | AI prompt source for normalization, enrichment, drafting, reply triage | Reuse with versioning, evidence boundaries, and jurisdiction controls |
| Prospecting Agent v3 n8n Build Sheet | Orchestration reference | Reuse node-map concepts; adapter must target Growth-owned records until governed handoff |
| AI Outreach Machine + Workbook + Manual | Cold Outreach + cadence | Reuse seven-touch/human-review model; add suppression, consent/compliance, dedupe, deliverability controls |
| Outbound Stack Expansion | Channel expansion and operating cadence | Reuse selectively after compliance and canonical handoff audit |
| AI Sales Copilot Blueprint + Tracker | Sales assist, reply summaries, walkthrough/qualification support | Reuse; must not own quotes, estimates, pricing snapshots, or canonical opportunity state |
| Previous n8n/OpenAI workflows | Automation implementation assets | Reuse only after connector, secret, duplicate, idempotency, audit, and handoff review |

## 4. Ownership map

### Growth-owned until governed handoff
- prospect
- prospect_account / organization target
- prospect_contact candidate
- enrichment evidence
- ICP/segment score
- territory / jurisdiction classification
- outreach eligibility and suppression state
- outreach sequence enrollment
- outreach message draft / approved message / send event
- follow-up task/event
- inbound response capture
- response classification
- sales-copilot recommendation
- handoff candidate
- Growth audit trail

### ServiceOS-owned after handoff
- marketing_source
- campaign
- customer / contact when appropriate
- service_location when appropriate
- service_request
- opportunity
- estimate
- pricing_snapshot
- quote
- quote_version
- quote_response
- conversion_record
- job_handoff

## 5. Canonical ServiceOS handoff target

The current ServiceOS 1.0 foundation contains canonical Revenue tables for service_request, opportunity, estimate, pricing_snapshot, quote, quote_version, quote_response, conversion_record, and job_handoff, plus customer/contact/service_location, marketing_source, campaign, external_reference, idempotency_key, and audit_event.

Growth must hand off through a narrow adapter. The adapter should create/update the minimum canonical Revenue entities required by the governed qualification state. Growth records remain linked by external_reference and a stable Growth prospect/handoff ID. Idempotency must prevent duplicate ServiceOS creation from retries or repeated inbound events.

Initial adapter design:
1. Growth prospect reaches `handoff_ready` only after qualification policy passes.
2. Adapter resolves jurisdiction/business unit and marketing_source/campaign.
3. Adapter performs duplicate/contact/account checks.
4. Adapter obtains an idempotency key scoped to the Growth handoff event.
5. Adapter creates or updates the ServiceOS customer/contact/service_location only when the qualification policy requires those records.
6. Adapter creates the canonical service_request and its one-to-one opportunity using ServiceOS lifecycle semantics.
7. Adapter writes external_reference(s) linking Growth IDs to ServiceOS IDs.
8. Adapter writes ServiceOS audit_event with source_system=`growth_layer_1_0` and a correlation ID.
9. Growth stores only the returned canonical IDs and becomes read-mostly for Revenue state after handoff.

No estimate, pricing_snapshot, quote, quote_version, quote_response, conversion_record, or job_handoff may be originated in Growth.

## 6. Proposed Growth lifecycle

`discovered` -> `normalized` -> `enriched` -> `scored` -> `review_ready` -> `outreach_eligible` -> `sequenced` -> `engaged` -> `qualification_pending` -> (`handoff_ready` | `nurture` | `suppressed` | `disqualified`)

This lifecycle is intentionally different from ServiceOS Revenue lifecycle statuses and must not be reused as ServiceOS state.

## 7. Qualification / handoff threshold v0.1

A prospect may become `handoff_ready` only when all required fields below are known or explicitly marked unknown by policy:
- jurisdiction and business unit
- company/person identity sufficient for dedupe
- reachable contact channel or verified inbound response
- target service family / service need
- target geography/service location at least to city/market level
- evidence of buyer intent or salesperson-confirmed qualification
- source/campaign attribution
- suppression/opt-out check passed
- duplicate check passed

Recommended initial handoff triggers:
- positive reply requesting pricing, walkthrough, proposal, availability, or service discussion;
- live call confirming a service need and next sales step;
- salesperson manually marks qualified after review.

Cold-list membership, enrichment score alone, email open, link click, or AI inference alone must not create a ServiceOS Revenue record.

## 8. Jurisdiction separation

Every Growth prospect and campaign must carry an explicit jurisdiction/market dimension before outbound eligibility.

Ontario/GTA:
- country: CA
- province: ON
- currency: CAD
- service modules and future pricing references must remain Ontario-specific

Arizona:
- country: US
- state: AZ
- currency: USD
- service modules and future pricing references must remain Arizona-specific

No pricing should be generated inside Growth; sales-assist may reference governed ServiceOS configuration only after canonical handoff or through an approved read-only interface.

## 9. Compliance and deliverability gates before scale

Large-scale outreach is blocked until these controls exist:
- suppression list and global opt-out
- duplicate account/contact prevention
- channel-specific consent/legal policy by jurisdiction
- bounce/complaint handling
- sender/domain health monitoring
- frequency caps
- sequence stop-on-reply
- human approval policy for initial pilot
- immutable send/response audit trail
- secrets excluded from prompts, workbooks, logs, and client-side code

## 10. Feature gating

Growth Layer must be independently feature-gated from ServiceOS 1.0. Minimum gates:
- GROWTH_LAYER_ENABLED
- GROWTH_OUTREACH_ENABLED
- GROWTH_AUTO_FOLLOWUP_ENABLED
- GROWTH_SERVICEOS_HANDOFF_ENABLED

Default state for implementation should be OFF except in an approved non-production environment.

## 11. Parallel-work ownership rule

ServiceOS stabilization chat owns Auth, permissions, Revenue core, Operations, QA, Finance, governance, cutover, production stabilization.

Growth chat owns prospecting, enrichment, outbound, follow-up, sales automation, and the Growth-to-ServiceOS integration adapter.

Growth changes must be isolated to Growth-owned files, tables, APIs, workflows, docs, and adapters. Any required change to a ServiceOS core file or canonical lifecycle requires explicit governance review before modification.

## 12. Implementation sequence

1. Recover and audit existing Drive assets.
2. Freeze Growth architecture/equivalence map.
3. Define Growth data model and compliance controls.
4. Implement Lead Mining.
5. Implement Prospect Database/Queue.
6. Implement Enrichment/Scoring.
7. Implement Prospecting Agent.
8. Implement Cold Outreach.
9. Implement Follow-up Engine.
10. Implement Response Classification.
11. Implement Sales Copilot.
12. Implement governed ServiceOS Revenue handoff adapter.
13. Run acceptance tests in non-production.
14. Pilot 20-30 prospects with human approval.
15. Scale only after deliverability, suppression, duplicate, and handoff controls pass.

## 13. Current status

PASS: existing Growth artifacts recovered from Drive.
PASS: canonical ServiceOS Revenue target independently verified in the ServiceOS 1.0 acceptance database.
PASS: no Growth/prospect/outreach tables currently exist in the ServiceOS acceptance public schema, reducing parallel-CRM collision risk.
PASS: isolated Git branch `growth/growth-layer-1.0` created from current `main`.
BLOCKER: Growth schema, compliance policy, and adapter contract are not yet implemented.
NEXT ACTION: audit the Lead Mining workbook/manual and Prospecting Agent/Outreach workbooks at field level, then define the Growth-owned schema and adapter contract before any database write.