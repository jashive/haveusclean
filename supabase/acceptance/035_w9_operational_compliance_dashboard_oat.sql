-- W9 Operational Compliance Dashboard verification.
-- Production-safe: read-only assertions using canonical HUC units and an existing Owner/Admin actor.
DO $$
DECLARE
  v_org uuid;
  v_actor uuid;
  v_on uuid;
  v_az uuid;
  v_pipeline jsonb;
  v_browser_exec integer;
BEGIN
  SELECT membership.organization_id,membership.app_user_id INTO v_org,v_actor
  FROM public.user_membership membership
  JOIN public.app_role role_row ON role_row.id=membership.role_id
  JOIN public.app_user app_user ON app_user.id=membership.app_user_id
  WHERE role_row.code='owner_admin' AND membership.status='active' AND app_user.status='active'
  ORDER BY membership.created_at LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'OAT035: active Owner/Admin actor unavailable'; END IF;

  SELECT id INTO v_on FROM public.business_unit WHERE organization_id=v_org AND code='HUC-ON' AND status='active';
  SELECT id INTO v_az FROM public.business_unit WHERE organization_id=v_org AND code='HUC-AZ' AND status='active';
  IF v_on IS NULL OR v_az IS NULL THEN RAISE EXCEPTION 'OAT035: literal HUC-ON/HUC-AZ units unavailable'; END IF;

  SELECT count(*) INTO v_browser_exec
  FROM information_schema.routine_privileges
  WHERE specific_schema='hems_hr'
    AND routine_name IN ('get_workforce_compliance_pipeline','get_worker_compliance_inspector','get_worker_evidence_access_locator','activate_worker_from_dashboard')
    AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type='EXECUTE';
  IF v_browser_exec<>0 THEN RAISE EXCEPTION 'OAT035: browser can execute HEMS dashboard routines'; END IF;
  IF NOT has_function_privilege('service_role','hems_hr.get_workforce_compliance_pipeline(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'OAT035: service_role cannot execute pipeline RPC'; END IF;

  v_pipeline:=hems_hr.get_workforce_compliance_pipeline(v_org,v_on,v_actor);
  IF v_pipeline->'stages'<>jsonb_build_array('Applicant','Screening','Documents Pending','Training / Standards','Compliance Approved','ServiceOS Ready') THEN RAISE EXCEPTION 'OAT035: Ontario pipeline stages invalid'; END IF;
  IF lower(v_pipeline::text) ~ '(secure_file_reference|object_path|ssn|social_security|bank_account|routing_number|tax_form|background_report|access_token_hash)' THEN RAISE EXCEPTION 'OAT035: restricted value leaked from Ontario pipeline'; END IF;

  v_pipeline:=hems_hr.get_workforce_compliance_pipeline(v_org,v_az,v_actor);
  IF v_pipeline->'stages'<>jsonb_build_array('Applicant','Screening','Documents Pending','Training / Standards','Compliance Approved','ServiceOS Ready') THEN RAISE EXCEPTION 'OAT035: Arizona pipeline stages invalid'; END IF;
  IF lower(v_pipeline::text) ~ '(secure_file_reference|object_path|ssn|social_security|bank_account|routing_number|tax_form|background_report|access_token_hash)' THEN RAISE EXCEPTION 'OAT035: restricted value leaked from Arizona pipeline'; END IF;
END $$;
SELECT 'OAT 035 PASS' AS result;
