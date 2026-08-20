# Canonical foundation recovery status

## Repository-history result

All fetched remote branches, pull-request heads, reachable commits, deleted paths, SQL files,
documentation, tests and scripts were searched before defining this extractor. The search included
`agent/wave1---auth---rls`, both `copilotagentwave1-auth-rls-v2` branches,
`copilot/agentwave1-auth-rls-v2`, PR heads, and full commit history. No commit contains DDL that
creates the Wave 1/2 foundation. Historical source first introduces database DDL at
`145d41161f3427054e10e08b7a9765340ac962f8` in `supabase/migrations/007_wave3_operations.sql`.
That file is incomplete as a blank-database foundation because it references pre-existing identity,
organization, revenue, worker, configuration and handoff objects.

## Read-only extraction required

An authorized control plane must run the checked-in extractor with a PostgreSQL role that has only
catalog visibility and read-only transaction rights:

```sh
psql "$READ_ONLY_PRODUCTION_DATABASE_URL" -X --set=ON_ERROR_STOP=1 \
  --file supabase/introspection/serviceos_foundation_schema_extract.sql \
  > serviceos-foundation-schema.txt
```

The URL is a protected runtime secret and must never be pasted into chat, logs, commits, or test
fixtures. The extractor starts a read-only transaction, reads only PostgreSQL/information-schema
catalogs, and rolls back. It emits relation flags, columns/defaults, constraints, indexes, RLS
policies, grants, triggers, dependent functions and dependent views. It reads no application rows.

The output must be reviewed for structure only, converted to deterministic new-environment DDL,
and compared back to a second extraction before `001_serviceos_foundation_baseline.sql` may be
created. Until that evidence exists, creating a baseline would invent contracts and is prohibited.

## Canonical replay after extraction

1. `001_serviceos_foundation_baseline.sql` (to be produced only from reviewed extraction)
2. `007_wave3_operations.sql`
3. `009_wave4_delivery_quality_gaps.sql`
4. `012_wave5_finance.sql`
5. `20260817003507_wave5_harden_authenticated_table_grants.sql`
6. `013_wave5_rls_catalog_attestation.sql`
7. `014_wave6_intelligence_governance_continuity.sql`
8. `015_wave6_live_acceptance_hardening.sql`
9. `20260818040000_serviceos_role_workflow_hardening.sql`

The live timestamped Wave 5 catalog and Wave 6 history entries are historical equivalents or
predecessors, not additional new-environment files. They must be reconciled by structural parity;
they are not replayed in addition to numbered 013–015.

## Evidence handoff gate

The control-plane extraction output must be normalized to the extractor row contract as a JSON
array and validated before baseline DDL is authored:

```sh
node scripts/validate-serviceos-foundation-evidence.mjs serviceos-foundation-schema.json
```

The gate requires all 26 relations with RLS enabled, structural evidence sections, exactly 16
foundation triggers, and all five SECURITY DEFINER membership helpers with explicit search paths.
It rejects possible credential material. The extracted definitions themselves are still required;
summary counts cannot establish exact columns, constraints, policies, functions, or lifecycle DDL.
