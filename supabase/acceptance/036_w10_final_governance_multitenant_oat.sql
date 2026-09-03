-- W10 final governance / multitenant verification.
-- Production-safe: read-only assertions; no fixtures.
DO $$
DECLARE
  v_audit jsonb;
  v_unindexed integer;
  v_active_huc_units integer;
BEGIN
  v_audit:=hems_hr.production_readiness_audit();
  IF (v_audit#>>'{browser_boundary,hems_table_grants}')::integer<>0 OR
     (v_audit#>>'{browser_boundary,hems_routine_grants}')::integer<>0 OR
     (v_audit#>>'{browser_boundary,worker_insert_delete_policies}')::integer<>0 OR
     (v_audit#>>'{legacy_sources,direct_worker_references}')::integer<>0 OR
     (v_audit#>>'{activation_integrity,successful_activations_without_authorization}')::integer<>0 OR
     (v_audit#>>'{activation_integrity,hems_linked_workers_without_successful_activation}')::integer<>0 OR
     (v_audit#>>'{tenant_integrity,authorization_scope_mismatches}')::integer<>0 OR
     (v_audit#>>'{tenant_integrity,assignment_scope_mismatches}')::integer<>0 OR
     (v_audit#>>'{tenant_integrity,active_assignments_without_available_authorization}')::integer<>0 OR
     (v_audit->>'restricted_operational_columns')::integer<>0 THEN
    RAISE EXCEPTION 'OAT036: production readiness audit contains a governance failure: %',v_audit;
  END IF;

  SELECT count(*) INTO v_active_huc_units
  FROM hems_hr.business_unit_workforce_config cfg
  JOIN public.business_unit bu ON bu.id=cfg.business_unit_id
  WHERE cfg.status='active' AND bu.status='active'
    AND ((bu.code='HUC-ON' AND cfg.jurisdiction_code='ON') OR (bu.code='HUC-AZ' AND cfg.jurisdiction_code='AZ'));
  IF v_active_huc_units<>2 THEN RAISE EXCEPTION 'OAT036: canonical HUC jurisdiction configuration missing'; END IF;

  WITH fks AS (
    SELECT con.conrelid,con.conkey
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE con.contype='f' AND (n.nspname='hems_hr' OR (n.nspname='public' AND cl.relname IN ('worker_business_unit_authorization','work_order_standard_snapshot')))
  )
  SELECT count(*) INTO v_unindexed FROM fks
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid=fks.conrelid AND i.indisvalid AND i.indisready
      AND (i.indkey::smallint[])[0:cardinality(fks.conkey)-1]=fks.conkey
  );
  IF v_unindexed<>0 THEN RAISE EXCEPTION 'OAT036: % Workforce foreign keys lack covering indexes',v_unindexed; END IF;

  IF NOT public.operational_jsonb_has_restricted_hr_key('{"bank_account":"x"}'::jsonb)
     OR public.operational_jsonb_has_restricted_hr_key('{"service_note":"clean"}'::jsonb) THEN
    RAISE EXCEPTION 'OAT036: restricted operational metadata guard invalid';
  END IF;
END $$;
SELECT 'OAT 036 PASS' AS result;
