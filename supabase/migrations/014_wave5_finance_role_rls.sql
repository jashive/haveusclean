-- =============================================================================
-- MIGRATION 014 — WAVE 5 FINANCE ROLE-SCOPED RLS
-- =============================================================================
-- Adds canonical finance-role access to Wave 5 finance tables only.
-- Does not enable the Finance UI or any Production feature flag.
-- QuickBooks/payment-provider write paths remain server/provider controlled.
-- =============================================================================

BEGIN;

CREATE POLICY pol_brg_finance_select ON public.billing_readiness_gate
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_brg_finance_insert ON public.billing_readiness_gate
FOR INSERT TO authenticated
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_brg_finance_update ON public.billing_readiness_gate
FOR UPDATE TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]))
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

CREATE POLICY pol_ir_finance_select ON public.invoice_request
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_ir_finance_insert ON public.invoice_request
FOR INSERT TO authenticated
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_ir_finance_update ON public.invoice_request
FOR UPDATE TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]))
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

-- Provider-bound tables remain read-only to the browser Finance role.
CREATE POLICY pol_aso_finance_select ON public.accounting_sync_outbox
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_po_finance_select ON public.payment_observation
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

-- Compensation contracts are owner-admin controlled; Finance may read them.
CREATE POLICY pol_ccv_finance_select ON public.contractor_compensation_version
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

CREATE POLICY pol_cp_finance_select ON public.contractor_payable
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_cp_finance_insert ON public.contractor_payable
FOR INSERT TO authenticated
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_cp_finance_update ON public.contractor_payable
FOR UPDATE TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]))
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

-- Profitability snapshots are append-only at the trigger layer.
CREATE POLICY pol_jps_finance_select ON public.job_profitability_snapshot
FOR SELECT TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));
CREATE POLICY pol_jps_finance_insert ON public.job_profitability_snapshot
FOR INSERT TO authenticated
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['finance']::text[]));

COMMIT;
