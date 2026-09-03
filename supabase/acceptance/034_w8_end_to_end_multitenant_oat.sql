-- W8 end-to-end / multi-tenant boundary verification.
-- Production-safe: read-only assertions; creates no fixtures.
DO $$
DECLARE
  v_huc_platform_scope integer;
  v_hems_browser_grants integer;
  v_hems_rls_failures integer;
BEGIN
  SELECT count(*) INTO v_huc_platform_scope
  FROM hems_hr.training_catalog_scope scope
  JOIN hems_hr.training_module module ON module.id=scope.training_module_id
  WHERE module.module_code IN ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS')
    AND scope.scope_kind='platform';
  IF v_huc_platform_scope<>0 THEN RAISE EXCEPTION 'OAT034: HUC training leaked to platform scope'; END IF;

  IF NOT has_table_privilege('authenticated','public.work_order_standard_snapshot','SELECT')
     OR has_table_privilege('authenticated','public.work_order_standard_snapshot','INSERT')
     OR has_table_privilege('authenticated','public.work_order_standard_snapshot','UPDATE')
     OR has_table_privilege('authenticated','public.work_order_standard_snapshot','DELETE') THEN
    RAISE EXCEPTION 'OAT034: work-order standard snapshot privileges are invalid';
  END IF;

  SELECT count(*) INTO v_hems_browser_grants
  FROM information_schema.role_table_grants
  WHERE table_schema='hems_hr' AND grantee IN ('anon','authenticated');
  IF v_hems_browser_grants<>0 THEN RAISE EXCEPTION 'OAT034: browser table grants exist in hems_hr'; END IF;

  SELECT count(*) INTO v_hems_rls_failures
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='hems_hr' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF v_hems_rls_failures<>0 THEN RAISE EXCEPTION 'OAT034: hems_hr table missing enabled/forced RLS'; END IF;
END $$;
SELECT 'OAT 034 PASS' AS result;
