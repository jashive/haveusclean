# Growth Layer 1.0 — G1 Completion Checklist

## Architecture boundary
- [x] Growth sits above ServiceOS and is not part of the canonical ServiceOS lifecycle.
- [x] ServiceOS remains canonical for service requests, opportunities, customers/contacts when appropriate, estimates, pricing snapshots, quotes/versions/responses, conversions, jobs/handoffs, operations, QA and finance.
- [x] Growth remains canonical only for pre-qualification prospect discovery, normalization, enrichment, deterministic scoring, duplicate handling, contact research, provenance and human review.
- [x] No quote/won/lost/job/invoice/payment lifecycle is duplicated in Growth.
- [x] No Growth pricing authority exists.
- [x] Wave 6 remains out of scope.

## Source and security
- [x] Private `growth` schema exists only in acceptance.
- [x] Browser roles do not directly query Growth tables.
- [x] Governed service-role/JWT Edge boundary exists.
- [x] Growth feature gates are independent from ServiceOS core.
- [x] Source migration numeric versions are unique.
- [x] Growth-to-ServiceOS handoff is OFF.
- [x] Outbound outreach is OFF.
- [x] Automatic follow-up is OFF.

## G1 functional controls
- [x] Legacy Lead Mining workbook mapped rather than replaced.
- [x] Deterministic normalization and `g1-rules-v1` scoring implemented.
- [x] AI-inferred intent cannot count as verified intent.
- [x] Duplicate classifications implemented: exact, probable, review-required, unique.
- [x] Duplicate review persistence/API boundary implemented.
- [x] Contact candidate normalization and review implemented.
- [x] Field-level provenance and inference restrictions implemented.
- [x] Human review actions implemented.
- [x] Successful G1 review stops at `review_ready`; it never creates outreach eligibility.
- [x] 24-record synthetic dual-market fixture exists and is marked NOT FOR OUTREACH.
- [x] Fail-closed dry-run pilot load planner exists and performs zero writes.

## Repository compatibility
- [x] Growth/ServiceOS ownership boundary documented.
- [x] Current ServiceOS drift inspected before integration.
- [x] Isolated compatibility branch created; real Growth and ServiceOS main remain untouched by compatibility testing.
- [ ] Compatibility branch cleanly integrates current `main` without dropping ServiceOS changes or Growth gates.
- [ ] ServiceOS core test suite passes on the compatibility result.
- [ ] Growth G1 contract suite passes on the compatibility result.
- [ ] Latest Vercel preview/deployment state is independently verified for the compatibility result.
- [ ] GitHub Actions runtime is observed or explicitly documented as unavailable/unobserved.

## Acceptance prerequisites
- [ ] Exactly one active Ontario canonical acceptance scope exists: CA / ON / CAD.
- [ ] Exactly one active Arizona canonical acceptance scope exists: US / AZ / USD.
- [ ] Both scopes belong to the same canonical organization.
- [ ] Ontario and Arizona business units are distinct.
- [ ] Ontario and Arizona jurisdictions are distinct.
- [ ] Live `growth_g1_scope_readiness` returns `READY` and `may_load_pilot=true`.
- [ ] Growth core gate is ON in acceptance only.
- [ ] Outreach, automatic follow-up and ServiceOS handoff gates remain OFF.

## Controlled dual-market OAT
- [ ] Dry-run planner returns READY_TO_LOAD for exactly 24 synthetic fixture records.
- [ ] Pilot executes only in acceptance using a governed server-side/JWT path.
- [ ] 12 Ontario and 12 Arizona records resolve to their correct canonical scopes.
- [ ] Deliberate exact/probable duplicate scenarios behave as designed.
- [ ] Enrichment evidence and field provenance are preserved.
- [ ] Contact review and human review are enforced.
- [ ] Every successful terminal prospect stops at `review_ready`.
- [ ] No outbound send occurs.
- [ ] No automatic follow-up occurs.
- [ ] No ServiceOS handoff occurs.
- [ ] No canonical ServiceOS Revenue/customer/quote/job records are created by the G1 pilot.
- [ ] Audit trail is complete.
- [ ] Pilot data cleanup/rollback is completed unless governance explicitly approves retention.
- [ ] Post-OAT security/advisor checks show no new Growth access regression.

## G1 completion decision
G1 may be marked **COMPLETE / PASS** only when every unchecked item above is satisfied or explicitly waived by HEMS governance with a recorded reason. Until then, G1 remains **IN PROGRESS / BLOCKED** and G2 scaled outreach must not begin.
