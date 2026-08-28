-- G6 migration-history reconciliation.
-- Acceptance confirmed public.app_user has no organization_id column; existing ServiceOS/Growth
-- human-approval patterns require an active app_user while scope remains bound by organization,
-- business_unit, and jurisdiction. The clean-source 20260828174019 migration already contains
-- that corrected rule. This no-op preserves the exact Acceptance migration ledger.
select 1;
