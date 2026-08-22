-- Wave 5 Finance upstream visibility: corrective actions are read-only to Finance.
-- Required so the Finance UI can present the same blocking state enforced by
-- the billing_readiness_gate database trigger. No write privilege is added.

BEGIN;

CREATE POLICY pol_ca_finance_select
ON public.corrective_action
FOR SELECT TO authenticated
USING (
  public.has_bu_role(
    organization_id,
    business_unit_id,
    ARRAY['finance']::text[]
  )
);

COMMIT;
