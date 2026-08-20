# ServiceOS control-plane acceptance bootstrap

This package is for the isolated acceptance project only. Never run it against production.

## Preflight

1. Confirm the target project ref is `hqeamecwdsrjfjybrsox`, migration history is empty, and no business rows exist.
2. Export protected `SUPABASE_URL`, database connection, anon and service-role variables; never print values.
3. Run `SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED=true npm run oat:preflight:mutation`.
4. Apply `supabase/introspection/serviceos_canonical_migration_manifest.json` in order with stop-on-error.

## Expected foundation checkpoint

After 001 and before 007, verify 26 allowlisted relations, 16 non-internal triggers, RLS on all 26,
and helper functions `current_app_user_id`, `is_org_member`, `is_business_unit_member`,
`has_org_role`, and `has_bu_role`. Canonical roles are `owner_admin`, `office_ops`, `worker`, `qa`.
Query `pg_class`, `pg_trigger`, `pg_policy`, `pg_proc`, and `information_schema.role_*_grants`; do not
query application rows for structural verification.

## Seed order

Provision four synthetic Auth UUIDs through the protected control plane, set
`serviceos.acceptance_approved=true` for the seed session, and invoke
`supabase/acceptance/001_serviceos_acceptance_seed.sql` with the four protected psql UUID variables.
The seed creates jurisdiction, organization, BU, roles, app users, one membership per user, and
exactly one active worker link. It contains no passwords or fixed UUIDs.

## Failure handling

Stop at the first error. Because the project is dedicated and contains no business data, discard
and recreate the acceptance project (or reset it using the approved Supabase control plane) rather
than patching between migrations. Re-run from an empty migration ledger. Never point rollback or
cleanup at production, and never broad-delete from a shared database.
