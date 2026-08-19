# ServiceOS blank-database bootstrap inventory

## Safety boundary

The only approved acceptance project is `hqeamecwdsrjfjybrsox`. The production project
`opazwghrohmfykzxxsjk` is prohibited. Secrets and Auth users are never stored here.

## Inventory and dependency order

The repository currently contains this ordered, source-backed chain:

1. **Missing canonical foundation (blocking):** organization, jurisdiction, business_unit,
   app_user, app_role, user_membership, worker, and the Wave 1/2 revenue tables. No migration
   that creates these objects exists in repository history.
2. `007_wave3_operations.sql` — operations tables, functions, lifecycle triggers, RLS and grants;
   assumes the missing foundation and revenue/handoff objects.
3. `009_wave4_delivery_quality_gaps.sql` — delivery/quality tables and guards; depends on 007
   plus configuration/version objects absent from the repository migration chain.
4. `012_wave5_finance.sql` — finance tables and guards; depends on Waves 1–4.
5. `20260817003507_wave5_harden_authenticated_table_grants.sql` — grant correction for 012.
6. `013_wave5_rls_catalog_attestation.sql` — catalog attestation for the Wave 5 state.
7. `014_wave6_intelligence_governance_continuity.sql` — KPI, management, release and continuity.
8. `015_wave6_live_acceptance_hardening.sql` — additive Wave 6 gate hardening.
9. `20260818040000_serviceos_role_workflow_hardening.sql` — additive actor/workflow hardening.

Numbered 014/015 are the repository equivalents of the reported timestamped Wave 6 migrations;
the timestamped files are not present. `013` overlaps the purpose of the reported timestamped
Wave 5 catalog attestation, which is also absent. These must not both be replayed by name without
migration-history reconciliation.

## Replay conclusion

A trustworthy blank-database bootstrap cannot yet be produced from the repository. Migration 007
begins with foreign keys and functions referencing foundational objects that source history never
creates. Inventing those definitions would risk changing lifecycle, RLS, grants, and production
contracts. The authoritative fix is to obtain a reviewed schema-only dump of the mature canonical
ServiceOS foundation (no data, Auth users, credentials, or environment IDs), review it into a new
fresh-environment baseline migration, then replay steps 2–9 above on disposable PostgreSQL.

Until that baseline is reviewed and clean replay passes, no migration in this chain may be applied
to the acceptance project and no acceptance seed may run.
