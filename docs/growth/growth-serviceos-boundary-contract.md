# Growth Layer 1.0 — ServiceOS Boundary Contract

## Architectural position

Growth Layer 1.0 sits **above** ServiceOS 1.0. It is not a ServiceOS lifecycle module and must not be folded into the canonical operating-system core.

The fact that Growth and ServiceOS may share the same GitHub repository does **not** make them the same system. Repository co-location is an implementation convenience; ownership, data, lifecycle, permissions, deployment controls, and system-of-record authority remain separated.

## ServiceOS owns the operating company record

ServiceOS remains the canonical system of record for:

- canonical customer and contact records after governed qualification/handoff
- service requests / operational leads
- opportunities
- estimates
- pricing snapshots
- quotes and quote versions
- quote responses
- conversions
- jobs and job handoffs
- operations / delivery / QA
- finance and accounting workflow

Growth must not re-create or become authoritative for those objects or lifecycle states.

## Growth owns pre-qualification acquisition

Growth owns only the acquisition work that happens before a prospect becomes a governed ServiceOS Revenue record:

- prospect discovery / lead mining
- research and enrichment
- ICP and deterministic scoring
- contact-candidate discovery
- duplicate review
- source and inference provenance
- prospecting queue
- future controlled outbound sequencing and follow-up
- response classification and sales assistance
- qualification preparation

Cold, scraped, unverified, suppressed, duplicate, nurture, and otherwise unqualified prospects remain in Growth and do not enter canonical ServiceOS Revenue.

## The integration doorway

The only intended Growth-to-ServiceOS transition is a governed handoff of a qualified prospect.

A handoff must eventually require, at minimum:

1. canonical organization / business unit / jurisdiction resolution,
2. duplicate and suppression clearance,
3. a verified reachable contact or verified inbound response,
4. a real service need,
5. supported geography / jurisdiction,
6. verified buyer intent or human salesperson qualification,
7. source / campaign attribution,
8. idempotent canonical object creation,
9. audit logging.

A score, scrape, email open, click, AI inference, or enriched profile alone is never sufficient to create a canonical ServiceOS Revenue record.

## Technical isolation

Growth currently preserves separation through:

- private `growth` database schema,
- Growth-specific lifecycle states,
- service-role-only database RPC boundaries,
- acceptance-only `growth-g1` Supabase Edge Function,
- independent Growth feature gates,
- independent Growth contract tests and CI workflow,
- no Growth pricing or quote generation,
- no Growth job / invoice / payment lifecycle,
- no direct browser access to private Growth tables,
- no production activation during G1.

## Feature-gate rule

Growth controls remain independent of ServiceOS controls:

- `GROWTH_LAYER_ENABLED`
- `GROWTH_OUTREACH_ENABLED`
- `GROWTH_AUTO_FOLLOWUP_ENABLED`
- `GROWTH_SERVICEOS_HANDOFF_ENABLED`

Turning on ServiceOS does not turn on Growth. Turning on Growth core does not authorize outreach or ServiceOS handoff.

## Non-negotiable rule

**Do not redesign Growth as part of the ServiceOS canonical lifecycle. Do not redesign ServiceOS around Growth.**

ServiceOS operates the company. Growth acquires and qualifies potential business above it. The systems integrate only at a governed boundary.
