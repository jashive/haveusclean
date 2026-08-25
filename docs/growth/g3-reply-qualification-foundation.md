# Growth Layer 1.0 — G3 Reply Classification, Qualification, Suppression & Compliance

## Boundary

G3 remains a Growth-layer milestone above ServiceOS. It does not create or mutate canonical ServiceOS Revenue objects. The only future transition into ServiceOS remains the separately governed G4 qualified-prospect handoff.

G3 builds on the merged G2 foundation and reuses G2 immutable outreach attempts, immutable outreach events, suppression controls, legal-basis evidence, human approvals, sender controls, and feature gates.

Persistent controls remain unchanged:

- `growth_outreach_enabled = false`
- `growth_auto_followup_enabled = false`
- `growth_provider_execution_enabled = false`
- `growth_serviceos_handoff_enabled = false`

No provider credentials or real sends are part of G3.

## Reply Classification Contract

Reply classification categories:

- `positive_interest`
- `request_information`
- `timing_later`
- `not_interested`
- `wrong_contact`
- `referral`
- `opt_out`
- `unclear`

The deterministic pre-classifier is conservative and fail-closed. Priority order:

1. explicit opt-out
2. wrong contact
3. not interested
4. referral
5. timing later
6. request information
7. positive interest
8. unclear

Higher-priority compliance and negative signals win over positive-language matches. Every reply stops automated sequencing regardless of classification.

## Qualification Contract

Growth qualification outcomes are:

- `qualification_pending`
- `handoff_candidate`
- `nurture`
- `suppressed`
- `disqualified`

Rules are fail-closed:

1. An opt-out or unsubscribe always resolves to suppression controls.
2. A complaint or hard bounce remains suppression-controlled by G2 and cannot be overridden by classification.
3. A positive reply alone never creates a ServiceOS object.
4. `handoff_candidate` requires verified service need, supported geography, verified reachable contact, and human qualification.
5. AI/model classification may assist, but cannot independently establish verified intent, human qualification, legal basis, or ServiceOS handoff eligibility.
6. Ambiguous messages remain `unclear` / `qualification_pending` until reviewed.
7. A G3 handoff candidate is Growth preparation only: it is `draft`, carries `g4_required=true`, and carries `serviceos_handoff_authorized=false`.

## Persistence Boundary

Acceptance G3 persists:

- immutable `growth.reply_classification_evidence` bound to the canonical G2 email reply event and exact organization/business-unit/jurisdiction/prospect/contact scope;
- immutable `growth.qualification_review` evidence for human decisions; and
- draft `growth.handoff_candidate` records only after human qualification passes all required evidence checks.

G3 mutation and review-queue RPCs are service-role-only. Anonymous and normal authenticated roles cannot execute them. SECURITY DEFINER functions use an explicit empty `search_path` with schema-qualified object references.

## Human Qualification Review Queue

`public.growth_g3_list_qualification_review_queue(...)` exposes pending human-review work through the private server boundary only.

Queue behavior:

- exact organization scope, with optional business-unit filter;
- canonical email reply events only;
- latest classification per reply event, preferring human classification when available;
- opt-outs excluded because suppression is immediate;
- already reviewed classification evidence excluded;
- terminal nurture, disqualified, and suppressed prospects excluded;
- oldest reply first;
- `requires_human_review=true` and `serviceos_handoff_authorized=false` are explicit in the returned contract.

## Terminal-State Consistency

Later G3 decisions must invalidate stale pre-G4 qualification state.

- later opt-out → active opt-out suppression + prospect `suppressed` + cancel any still-draft Growth handoff candidate;
- later `nurture` → prospect `nurture` + cancel any still-draft Growth handoff candidate;
- later `disqualified` → prospect `disqualified` + cancel any still-draft Growth handoff candidate;
- later `suppressed` → prospect `suppressed` + cancel any still-draft Growth handoff candidate.

Terminal decisions are monotonic and cannot be reopened by the same G3 workflow:

- `nurture` may remain `nurture` or move to `disqualified` / `suppressed`;
- `disqualified` may remain `disqualified` or move to `suppressed`;
- `suppressed` may only remain `suppressed`.

A terminal Growth prospect therefore cannot later be re-qualified into a fresh G3 handoff candidate. G4 must always receive a current, non-terminal, suppression-cleared candidate.

## Acceptance Evidence

G3 Acceptance coverage is source-controlled as:

- `010_growth_g3_reply_qualification_oat.sql` — qualification, opt-out precedence, scope and immutability;
- `011_growth_g3_terminal_reply_hardening_oat.sql` — later opt-out cancels a prior draft candidate and suppresses the prospect;
- `012_growth_g3_transition_queue_completion_oat.sql` — pending review queue behavior, nurture/disqualified/suppressed monotonic transitions, stale-candidate cancellation, blocked terminal reopening, ServiceOS-handoff non-authorization, and rollback cleanup.

## Completion Rule

The formal checklist is `docs/growth/g3-completion-checklist.md`.

G3 may be marked `COMPLETE / MERGE-READY AS FOUNDATION ONLY` only after:

- all applicable checklist items pass;
- exact Acceptance migration lineage is source-controlled;
- rollback OAT 010–012 pass;
- service-role grants/search-path controls are verified;
- fresh security/performance advisor output is reviewed;
- exact-head CI is green; and
- the formal closure review finds no unresolved G3 blocker.

Even a completed/merged G3 foundation does **not** authorize provider execution, real outbound, automatic follow-up, ServiceOS handoff, Production Growth activation, or automatic start of G4.
