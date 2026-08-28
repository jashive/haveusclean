-- G6 migration-history reconciliation.
-- Acceptance discovered that public.business_unit uses status='active', not an is_active column.
-- The clean-source migration 20260828174019_growth_layer_g6_commissioning_readiness_foundation.sql
-- already contains the corrected status='active' checks. This intentionally no-op file preserves
-- the exact Acceptance migration ledger so Supabase migration history remains reconcilable.
select 1;
