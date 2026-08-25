# Growth Layer 1.0 — G3 Completion Checklist

## Boundary

G3 remains a Growth-layer milestone above ServiceOS. It may classify replies, preserve reply evidence, support human qualification decisions, maintain suppression/terminal Growth states, and create only draft Growth handoff candidates for later G4 review. G3 must not create or mutate canonical ServiceOS Revenue, job, delivery, finance, or customer lifecycle objects.

A G3 `handoff_candidate` is preparation only. It must always carry `g4_required=true` and `serviceos_handoff_authorized=false` until the separately governed G4 milestone exists and passes.

## Required Completion Evidence

- [ ] Deterministic reply classifier covers positive_interest, request_information, timing_later, not_interested, wrong_contact, referral, opt_out, and unclear.
- [ ] Explicit opt-out has highest precedence and always resolves to suppression controls.
- [ ] Every reply stops automated sequencing; auto-followup remains OFF.
- [ ] Reply-classification evidence is immutable and bound to the canonical G2 email reply event plus exact organization/business-unit/jurisdiction/prospect/contact scope.
- [ ] AI/model output cannot independently establish verified intent, legal basis, human qualification, or ServiceOS handoff eligibility.
- [ ] Qualification requires a human reviewer and a recorded reason.
- [ ] Qualified handoff-candidate preparation requires verified service need, supported geography, verified reachable contact, and an allowed positive/request-information/referral reply classification.
- [ ] A qualified G3 result creates only a draft Growth handoff candidate; it does not create ServiceOS objects and does not authorize ServiceOS handoff.
- [ ] Pending qualification work is visible through the service-role-only human review queue.
- [ ] The review queue excludes opt-outs, already reviewed evidence, and terminal nurture/disqualified/suppressed prospects.
- [ ] Later opt-out cancels any still-draft Growth handoff candidate and creates/reuses active opt-out suppression.
- [ ] Later nurture cancels any still-draft Growth handoff candidate and moves the prospect to nurture.
- [ ] Later disqualified cancels any still-draft Growth handoff candidate and moves the prospect to disqualified.
- [ ] Later suppressed cancels any still-draft Growth handoff candidate and moves the prospect to suppressed.
- [ ] Terminal Growth decisions are monotonic: nurture cannot reopen to qualified/pending; disqualified cannot reopen to nurture/qualified/pending; suppressed cannot reopen to any non-suppressed state.
- [ ] Terminal decisions may only move toward equal-or-more-terminal outcomes: nurture → nurture/disqualified/suppressed; disqualified → disqualified/suppressed; suppressed → suppressed.
- [ ] No stale draft Growth handoff candidate can survive a later terminal G3 decision.
- [ ] G3 mutation/read RPCs are service-role-only; anon/authenticated EXECUTE remains denied.
- [ ] G3 SECURITY DEFINER RPCs use explicit empty `search_path` and fully qualified object references.
- [ ] G3 private tables retain the private Growth RLS/no-client-policy architecture.
- [ ] Acceptance rollback OAT 010 passes qualification/suppression/scope/immutability controls.
- [ ] Acceptance rollback OAT 011 passes later opt-out cancellation and suppression controls.
- [ ] Acceptance rollback OAT 012 passes human review queue, terminal transition monotonicity, stale-handoff cancellation, and zero-persistence cleanup.
- [ ] After OAT, synthetic G3 prospects/classifications/reviews/handoff candidates are zero.
- [ ] `growth_outreach_enabled=false`.
- [ ] `growth_auto_followup_enabled=false`.
- [ ] `growth_provider_execution_enabled=false`.
- [ ] `growth_serviceos_handoff_enabled=false`.
- [ ] No provider credential is introduced and no real message is sent.
- [ ] Production Growth is untouched.
- [ ] Exact Acceptance G3 migration lineage is source-controlled.
- [ ] Fresh Supabase security/performance advisors are reviewed with G3-specific findings separated from pre-existing ServiceOS/Auth technical debt.
- [ ] Fresh exact-head Growth and PR Acceptance CI succeed.
- [ ] PR remains draft/unmerged during technical closure review unless separately authorized.

## Completion Decision

G3 may be called `COMPLETE / MERGE-READY AS FOUNDATION ONLY` only when every applicable item above passes and the formal closure review finds no unresolved G3 blocker.

That decision still does **not** authorize:

- provider credentials or provider execution;
- outbound email, SMS, or phone;
- automatic follow-up;
- ServiceOS handoff;
- Production Growth activation;
- automatic PR merge; or
- automatic start of G4.

## Next Milestone After Separate Merge Authorization

G4 is the separately governed Growth-to-ServiceOS handoff boundary. G4 must implement idempotent, audited creation/linkage of canonical ServiceOS objects only after the exact G3 Growth candidate remains current, suppression-cleared, jurisdiction-resolved, human-qualified, and explicitly authorized for handoff.
