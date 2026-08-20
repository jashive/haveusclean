-- =============================================================================
-- WAVE 5 AUTHENTICATED TABLE GRANTS HARDENING
-- source mirror of already-applied live migration
-- do not manually rerun
-- no RLS policy changes
-- no retained-data changes
-- =============================================================================

BEGIN;

revoke all privileges on table public.billing_readiness_gate from authenticated;
revoke all privileges on table public.invoice_request from authenticated;
revoke all privileges on table public.accounting_sync_outbox from authenticated;
revoke all privileges on table public.payment_observation from authenticated;
revoke all privileges on table public.contractor_compensation_version from authenticated;
revoke all privileges on table public.contractor_payable from authenticated;
revoke all privileges on table public.job_profitability_snapshot from authenticated;

grant select, insert, update on table public.billing_readiness_gate to authenticated;
grant select, insert, update on table public.invoice_request to authenticated;
grant select on table public.accounting_sync_outbox to authenticated;
grant select on table public.payment_observation to authenticated;
grant select, insert, update on table public.contractor_compensation_version to authenticated;
grant select, insert, update on table public.contractor_payable to authenticated;
grant select, insert, update on table public.job_profitability_snapshot to authenticated;

revoke all privileges on table public.billing_readiness_gate from anon;
revoke all privileges on table public.invoice_request from anon;
revoke all privileges on table public.accounting_sync_outbox from anon;
revoke all privileges on table public.payment_observation from anon;
revoke all privileges on table public.contractor_compensation_version from anon;
revoke all privileges on table public.contractor_payable from anon;
revoke all privileges on table public.job_profitability_snapshot from anon;

COMMIT;
