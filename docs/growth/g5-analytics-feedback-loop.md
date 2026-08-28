# Growth Layer 1.0 — G5 Analytics, Attribution & Feedback

## Status

G5 is functionally complete as an **analytics and feedback foundation** pending final CI / PR / merge closure.

This milestone is read/analysis infrastructure above the canonical ServiceOS lifecycle. It does **not** activate outreach, automatic follow-up, provider execution, or Growth→ServiceOS handoff.

## Architecture Boundary

- HEMS remains governance authority.
- Growth owns prospect sourcing, enrichment, outreach evidence, reply evidence, qualification evidence, acquisition-cost evidence, and G4 handoff lineage.
- ServiceOS owns canonical customer / service request / opportunity / pricing / quote / conversion / job / invoice / payment / profitability state after governed handoff.
- G5 reads both sides and preserves lineage. It does not copy or re-own either lifecycle.
- Browser clients do not receive direct access to private Growth analytics views or evidence tables.
- Initial reporting and evidence-write surfaces are service-role-only.
- G5 recommendations are advisory only. No G5 function can enable an execution gate or autonomously alter outreach/provider behavior.

## Cohort Contract

The canonical G5 cohort anchor is `growth.prospect.captured_at`.

One derived analytics row represents one Growth prospect and references milestones from existing evidence and canonical ServiceOS records. No separate mutable funnel warehouse is introduced.

Primary dimensions:

- `source_lane`
- country / subdivision / city
- segment
- facility type
- canonical ServiceOS marketing source
- canonical ServiceOS campaign after handoff

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

## Reporting & Evidence Surfaces

### `growth.prospect_funnel_analytics_v1`

Service-role-only `security_invoker` view joining Growth evidence to canonical ServiceOS lineage.

### `public.growth_g5_funnel_summary(...)`

Cohort summary grouped by source lane, country, subdivision, and segment. Uses historical milestone semantics for positive interest and qualification.

### `growth.prospect_financial_analytics_v1`

Service-role-only finance-lineage view. Joins the funnel row to the latest canonical `job_profitability_snapshot` for the linked operational job.

### `public.growth_g5_financial_summary(...)`

Groups finance by invoice currency. CAD and USD are never blended into one unqualified total. Profitability is aggregated only when canonical profitability currency matches invoice currency. Currency mismatch records are surfaced as data-quality exceptions.

ServiceOS additionally enforces invoice/profitability currency consistency at write time; G5 retains its own read-side check as defense in depth.

### `public.growth_g5_latency_summary(...)`

Reports average elapsed hours from prospect capture to first outreach, reply, qualification, opportunity, quote, acceptance, and conversion. Impossible negative intervals are excluded rather than contaminating averages.

### `growth.acquisition_cost_evidence`

Private, immutable, RLS-enabled Growth evidence table for approved acquisition spend.

Evidence is bound to:

- organization / business unit / jurisdiction
- Growth `source_lane`
- exact reporting period
- currency
- amount
- evidence reference
- active human approver
- approval reason
- idempotency key / deterministic request hash

The table intentionally has no browser client policy. Service-role is the only approved access boundary.

### `public.growth_g5_record_acquisition_cost_evidence(...)`

Service-role-only, `SECURITY DEFINER`, empty-search-path write boundary.

Controls:

- validates active organization / BU / jurisdiction scope
- requires an active human approver
- requires positive approved spend and evidence reference
- exact replay is idempotent
- same idempotency key with a changed payload is blocked
- direct UPDATE / DELETE of recorded evidence is blocked
- SHA-256 hashing uses explicit `extensions.digest(...)` schema qualification

### `public.growth_g5_unit_economics_summary(...)`

Calculates source-lane unit economics only when cost evidence exactly matches the requested cohort period.

Metrics:

- spend
- prospects
- qualified leads
- converted customers
- invoiced prospects
- recognized revenue
- gross contribution
- cost per prospect
- cost per qualified lead
- customer acquisition cost
- ROAS
- contribution ROI

Partial-period spend is **not** allocated or guessed.

### `public.growth_g5_campaign_outcome_summary(...)`

Reports canonical downstream campaign outcomes only after a governed handoff has created canonical ServiceOS campaign lineage.

Metrics:

- handed-off prospects
- opportunities
- quotes sent
- quotes accepted
- conversions
- quote acceptance rate
- handoff-to-conversion rate

G5 does not pretend a pre-handoff prospect had a ServiceOS campaign assignment. If no canonical campaign lineage exists, the campaign result set is correctly empty.

### `public.growth_g5_optimization_observations(...)`

Read-only, recommendation-only feedback layer with minimum-sample controls.

Default thresholds:

- 20 prospects
- 5 replies
- 3 qualified prospects
- 20% quote-acceptance threshold

Sample states:

- `insufficient_sample`
- `limited_reply_sample`
- `limited_qualification_sample`
- `decision_ready`

Possible recommendations:

- `collect_more_data`
- `review_sender_health_and_compliance`
- `review_deliverability`
- `review_targeting_and_message`
- `review_targeting_or_qualification`
- `review_handoff_process`
- `review_handoff_to_quote_process`
- `review_offer_pricing_or_scope`
- `continue_monitoring`

These are observations only. No optimization function writes campaign settings, provider configuration, or feature gates.

### Dashboard Contracts

`public.growth_g5_dashboard_snapshot(...)` remains available as `g5-dashboard-v1` for compatibility.

`public.growth_g5_dashboard_snapshot_v2(...)` is the current versioned service-role-only dashboard contract.

`g5-dashboard-v2` returns:

- funnel
- latency
- financial
- unit economics when exact BU / jurisdiction / period inputs are present
- canonical campaign outcomes
- sample-gated optimization observations
- cohort/filter metadata
- explicit no-implicit-FX currency policy
- explicit recommendation-only optimization policy

The client is not responsible for reconstructing funnel, finance, attribution, or recommendation business logic.

## Currency Policy

- Financial output is grouped by canonical invoice currency.
- Approved acquisition spend is recorded in its evidence currency.
- Unit economics only join canonical financial outcomes where currencies align.
- CAD and USD must remain separate unless a future governed FX-normalization layer is explicitly introduced.
- G5 performs no implicit FX conversion.
- Cross-currency invoice/profitability lineage is rejected by ServiceOS and excluded by G5 if encountered.

## Acceptance Proof

### OAT 018 — Funnel analytics — PASS

Proves:

- Ontario and Arizona remain distinct cohorts.
- earlier positive interest remains historically achieved after later `not_interested`.
- earlier qualification remains historically achieved after later `nurture`.
- latest state still reflects the later decision.
- captured-at date filtering works.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 019 — Financial analytics — PASS

Proves:

- Growth lineage resolves through an existing canonical Acceptance ServiceOS opportunity → conversion → job → invoice → profitability chain.
- CAD invoice and CAD profitability aggregate correctly.
- ServiceOS blocks a synthetic USD profitability snapshot against a CAD invoice.
- rejected mismatch does not alter G5 aggregation.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 020 — Latency analytics — PASS

Proves:

- deterministic 48-hour time-to-reply and 54-hour time-to-qualification calculations.
- downstream latency stays null until canonical milestones exist.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 021 — Dashboard v1 — PASS

Proves:

- `g5-dashboard-v1` response contract.
- explicit cohort anchor and currency policy.
- Ontario and Arizona are independently represented.
- finance is empty when no invoice exists instead of inventing revenue.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

### OAT 022 — Cost Evidence & Unit Economics — PASS

Proves:

- approved cost evidence is immutable.
- exact replay is idempotent.
- changed payload under the same idempotency key is blocked.
- exact-period cost attribution only; partial-period spend is not allocated.
- with synthetic approved spend of CAD 100 against the existing canonical CAD 300 revenue / CAD 200 contribution chain:
  - CPL = CAD 100
  - CPQL = CAD 100
  - CAC = CAD 100
  - ROAS = 3.0000
  - contribution ROI = 1.0000
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

OAT 022 also identified the empty-search-path `digest()` resolution issue. The production function was hardened to call `extensions.digest(...)` explicitly before the OAT was accepted as passing.

### OAT 023 — Optimization & Dashboard v2 — PASS

Proves:

- two prospects remain `insufficient_sample` under the default minimum of 20.
- recommendation is `collect_more_data`, not a fabricated optimization decision.
- `g5-dashboard-v2` exposes the recommendation-only policy.
- campaign outcomes remain empty without canonical ServiceOS campaign lineage.
- unit economics remain empty without approved cost evidence.
- rollback leaves no synthetic artifacts.
- Growth execution gates remain OFF.

## Current G5 Migrations

- `20260828161453_growth_layer_g5_prospect_funnel_analytics.sql`
- `20260828170726_growth_layer_g5_financial_latency_analytics.sql`
- `20260828171137_growth_layer_g5_dashboard_snapshot.sql`
- `20260828171419_growth_layer_g5_acquisition_cost_unit_economics.sql`
- `20260828171551_growth_layer_g5_cost_hash_schema_hardening.sql`
- `20260828171817_growth_layer_g5_optimization_campaign_dashboard_v2.sql`
- `20260828172053_growth_layer_g5_acquisition_cost_indexes.sql`

## Hardening Status

Security / performance review was scoped to G5 additions instead of sweeping unrelated ServiceOS technical debt into this milestone.

G5 hardening completed:

- private Growth evidence table with RLS and no client policy by design
- service-role-only analytics/evidence RPC grants
- empty search paths on G5 RPCs
- immutable cost evidence guard with client EXECUTE revoked
- explicit schema-qualified SHA-256 function
- cost-evidence FK indexes for business unit, jurisdiction, and human approver
- exact-period reporting composite index on organization / BU / jurisdiction / period / source / currency
- zero persisted `G5-OAT-%` synthetic prospects after rollback OATs
- zero persisted `G5-OAT-%` cost-evidence records
- all four protected Growth execution gates remain OFF

Any remaining advisor warnings belong to pre-existing ServiceOS/Auth technical debt or intentional private-Growth RLS configuration and are not G5 activation blockers.

## Known Data Limitation

Acceptance currently has no canonical `service_request.campaign_id` population for the G5 test cohort. Therefore campaign-outcome reporting is implemented and contract-tested, but real campaign rows correctly remain empty until governed live/Acceptance handoffs carry canonical campaign attribution.

Source-lane acquisition-cost evidence is intentionally used for pre-handoff unit-economics denominators. G5 does **not** invent campaign-level spend or campaign-level pre-handoff prospect counts.

## G5 Completion Criteria

G5 is complete as a foundation when:

1. funnel, finance, latency, acquisition-cost, unit-economics, canonical campaign-outcome, recommendation, and dashboard surfaces are implemented;
2. OAT 018–023 pass;
3. G5 security/performance hardening is complete;
4. source and Acceptance migrations match;
5. CI / review / PR merge complete;
6. post-merge proof shows zero synthetic OAT residue and all protected execution gates still OFF.

At that point G6 is the next milestone.

## Explicit Non-Goals

- No outbound provider activation.
- No automatic follow-up activation.
- No handoff activation.
- No production ServiceOS mutation.
- No autonomous campaign tuning.
- No implicit currency conversion.
- No replacement of canonical ServiceOS finance or lifecycle state.

## Next Milestone — G6

G6 is controlled production readiness / commissioning, including legal/compliance review, provider and credential commissioning, sender-domain readiness, tiny pilot controls, daily caps, bounce/complaint kill thresholds, emergency stop, monitoring/rollback, staff SOP/training, governed handoff pilot, KPI thresholds, and HEMS approval.

Only G6 should deliberately change persistent Growth execution gates.
