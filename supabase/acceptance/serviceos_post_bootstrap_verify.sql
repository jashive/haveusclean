\set ON_ERROR_STOP on
DO $$
DECLARE foundation text[]:=ARRAY['organization','jurisdiction','app_role','app_user','business_unit','user_membership','customer','contact','service_location','worker','marketing_source','campaign','configuration_version','external_reference','idempotency_key','audit_event','migration_lineage','service_request','opportunity','estimate','pricing_snapshot','quote','quote_version','quote_response','conversion_record','job_handoff']; n text;
BEGIN
 FOREACH n IN ARRAY foundation LOOP
  IF to_regclass('public.'||n) IS NULL THEN RAISE EXCEPTION 'missing foundation relation %',n; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||n) AND c.relrowsecurity) THEN RAISE EXCEPTION 'RLS disabled on %',n; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM app_role WHERE code NOT IN ('owner_admin','office_ops','worker','qa')) THEN RAISE EXCEPTION 'unsupported role present'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='huc_enforce_serviceos_work_order_actor' AND grantee IN ('PUBLIC','anon','authenticated')) THEN RAISE EXCEPTION 'internal hardening function executable'; END IF;
END $$;
SELECT 'SERVICEOS_POST_BOOTSTRAP_PASS' result;
