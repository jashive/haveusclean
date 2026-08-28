-- G6 migration-history reconciliation.
-- Acceptance OAT 025 caught that PostgreSQL does not support min(uuid) for selecting
-- the one matching staged-activation authorization. The clean-source migration
-- 20260828181425 already contains the corrected count + deterministic UUID lookup.
-- This no-op preserves the exact Acceptance migration ledger.
select 1;
