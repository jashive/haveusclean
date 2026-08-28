# Growth Layer 1.0 — G5 Analytics, Attribution & Feedback

## Status

G5 is in progress as a read-only intelligence layer above the canonical ServiceOS lifecycle. This foundation does **not** activate outreach, automatic follow-up, provider execution, or Growth→ServiceOS handoff.

## Architecture Boundary

- HEMS remains governance authority.
- Growth owns prospect sourcing, enrichment, outreach evidence, reply evidence, qualification evidence, and G4 handoff lineage.
- ServiceOS owns canonical customer/service request/opportunity/pricing/quote/conversion/job/finance state after governed handoff.
- G5 reads both sides. It does not copy or re-own either lifecycle.
- Browser clients do not receive direct access to private Growth analytics views. Initial reporting surfaces are service-role only.

## Cohort Contract

The canonical G5 cohort anchor is `growth.prospect.captured_at`.

One derived analytics row represents one Growth prospect and references milestones from existing evidence and canonical ServiceOS records. No separate mutable funnel warehouse is introduced in this slice.

Primary dimensions:

- `source_lane`
- country / subdivision / city
- segment
- facility type
- canonical ServiceOS marketing source
- canonical ServiceOS campaign

## Funnel Milestones

Historical milestone fields answer **ever achieved** while latest-state fields answer **current/latest known state**.

Milestones:

1. Prospect captured
2. Verified
3. Outreach attempted
4. Delivered
5. Reply received
6. Positive interest
7. Qualified
8. Governed handoff completed
9. Canonical ServiceOS opportunity created
10. Quote sent
11. Quote accepted
12. Conversion recorded
13. Operational job created

A later `not_interested`, `nurture`, `disqualified`, or suppressed state does not erase an earlier historical milestone. This prevents retrospective funnel distortion while preserving current operating state.

## Reporting Surfaces

### `growth.prospect_funnel_analytics_v1`

Service-role-only `security_invoker` view joining Growth evidence to canonical ServiceOS lineage.

### `public.growth_g5_funnel_summary(...)`

Cohort summary grouped by source lane, country, subdivision, and segment. Uses historical milestone semantics for positive interest and qualification.

### `growth.prospect_financial_analytics_v1`

Service-role-only finance lineage view. Joins the funnel row to the latest canonical `job_profitability_snapshot` for the linked operational job.

### `public.growth_g5_financial_summary(...)`

Groups finance by invoice currency. CAD and USD are never blended into one unqualified total. Profitability is aggregated only when canonical profitability currency matches invoice currency. Currency mismatch records are surfaced as data-quality exceptions.

ServiceOS additionally enforces invoice/profitability currency consistency at write time; G5 keeps its own read-side guard as defense in depth.

### `public.growth_g5_latency_summary(...)`

Reports average elapsed hours from prospect capture to first outreach, reply, qualification, opportunity, quote, acceptance, and conversion. Impossible negative intervals are excluded rather than contaminating averages.

### `public.growth_g5_dashboard_snapshot(...)`

Versioned service-role-only dashboard contract: `g5-dashboard-v1`.

Returns:

- `funnel`
- `latency`
- `financial`
- cohort/filter metadata
- currency policy

The client is not responsible for reconstructing funnel or finance business logic.

## Currency Policy

- Financial output is grouped by canonical invoice currency.
- CAD and USD must remain separate unless a future governed FX-normalization layer is explicitly introduced.
- G5 does not perform implicit FX conversion.
- Cross-currency invoice/profitability lineage is rejected by ServiceOS and excluded by G5 if encountered.

## Acceptance Proof

### OAT 018 — Funnel analytics

Proves:

- Ontario and Arizona remain distinct cohorts.
- earlier positive interest remains historically achieved after later `not_interested`.
- earlier qualification remains historically achieved after later `nurture`.
- latest state still reflects the later decision.
- captured-at date filtering works.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 019 — Financial analytics

Proves:

- Growth lineage resolves through an existing canonical Acceptance ServiceOS opportunity → conversion → job → invoice → profitability chain.
- CAD invoice and CAD profitability aggregate correctly.
- ServiceOS blocks a synthetic USD profitability snapshot against a CAD invoice.
- rejected mismatch does not alter G5 aggregation.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 020 — Latency analytics

Proves:

- deterministic time-to-reply and time-to-qualification calculations.
- downstream latency stays null until canonical milestones exist.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 021 — Dashboard contract

Proves:

- `g5-dashboard-v1` response contract.
- explicit cohort anchor and currency policy.
- Ontario and Arizona are independently represented.
- finance is empty when no invoice exists instead of inventing revenue.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

## Current Migrations

- `20260828161453_growth_layer_g5_prospect_funnel_analytics.sql`
- `20260828170726_growth_layer_g5_financial_latency_analytics.sql`
- `20260828171137_growth_layer_g5_dashboard_snapshot.sql`

## Remaining G5 Work

1. Add governed campaign/source cost evidence so cost-per-prospect, cost-per-qualified-lead, CAC, and ROI can be calculated without inventing spend.
2. Define optimization/feedback observations as evidence/recommendations only; G5 must not autonomously change outreach/provider execution settings.
3. Add campaign/source/segment/city comparison surfaces using minimum-sample controls so small cohorts are not overinterpreted.
4. Add OAT for cost attribution and optimization evidence.
5. Run security/performance advisors focused only on G5 additions and add targeted indexes if justified by query plans.
6. Complete CI/PR review and merge G5 foundation while all execution gates remain OFF.

## Explicit Non-Goals

- No outbound provider activation.
- No automatic follow-up activation.
- No handoff activation.
- No production ServiceOS mutation.
- No autonomous campaign tuning.
- No implicit currency conversion.
- No replacement of canonical ServiceOS finance or lifecycle state.
