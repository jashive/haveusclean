-- =============================================================================
-- MIGRATION 013 — WAVE 5 RLS CATALOG ATTESTATION
-- Read-only catalog attestation for the Wave 5 finance tables.
-- No retained-data changes. No RLS policy changes.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wave5_rls_catalog_attestation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH wave5_tables(table_name) AS (
    VALUES
      ('billing_readiness_gate'),
      ('invoice_request'),
      ('accounting_sync_outbox'),
      ('payment_observation'),
      ('contractor_compensation_version'),
      ('contractor_payable'),
      ('job_profitability_snapshot')
  ),
  table_catalog AS (
    SELECT
      cls.relname AS table_name,
      cls.relrowsecurity AS rls_enabled,
      cls.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class AS cls
    INNER JOIN pg_catalog.pg_namespace AS nsp
      ON nsp.oid = cls.relnamespace
    INNER JOIN wave5_tables AS w5
      ON w5.table_name = cls.relname
    WHERE nsp.nspname = 'public'
      AND cls.relkind = 'r'
  ),
  authenticated_privileges AS (
    SELECT DISTINCT
      priv.table_name,
      priv.privilege_type
    FROM information_schema.table_privileges AS priv
    INNER JOIN wave5_tables AS w5
      ON w5.table_name = priv.table_name
    WHERE priv.table_schema = 'public'
      AND priv.grantee = 'authenticated'
  ),
  anon_privileges AS (
    SELECT DISTINCT
      priv.table_name,
      priv.privilege_type
    FROM information_schema.table_privileges AS priv
    INNER JOIN wave5_tables AS w5
      ON w5.table_name = priv.table_name
    WHERE priv.table_schema = 'public'
      AND priv.grantee = 'anon'
  ),
  policy_catalog AS (
    SELECT
      pol.tablename AS table_name,
      pol.policyname AS policy_name,
      pol.cmd AS command,
      pol.roles,
      pol.qual,
      pol.with_check
    FROM pg_catalog.pg_policies AS pol
    INNER JOIN wave5_tables AS w5
      ON w5.table_name = pol.tablename
    WHERE pol.schemaname = 'public'
  )
  SELECT jsonb_build_object(
    'contract_version', 'wave5-rls-catalog-v1',
    'tables', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'table_name', tbl.table_name,
            'rls_enabled', tbl.rls_enabled,
            'force_rls', tbl.force_rls
          )
          ORDER BY tbl.table_name
        )
        FROM table_catalog AS tbl
      ),
      '[]'::jsonb
    ),
    'authenticated_privileges', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'table_name', priv.table_name,
            'privilege_type', priv.privilege_type
          )
          ORDER BY priv.table_name, priv.privilege_type
        )
        FROM authenticated_privileges AS priv
      ),
      '[]'::jsonb
    ),
    'anon_privileges', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'table_name', priv.table_name,
            'privilege_type', priv.privilege_type
          )
          ORDER BY priv.table_name, priv.privilege_type
        )
        FROM anon_privileges AS priv
      ),
      '[]'::jsonb
    ),
    'policies', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'table_name', pol.table_name,
            'policy_name', pol.policy_name,
            'command', pol.command,
            'roles', to_jsonb(pol.roles),
            'qual', pol.qual,
            'with_check', pol.with_check
          )
          ORDER BY pol.table_name, pol.policy_name
        )
        FROM policy_catalog AS pol
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.wave5_rls_catalog_attestation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wave5_rls_catalog_attestation() FROM anon;
REVOKE ALL ON FUNCTION public.wave5_rls_catalog_attestation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wave5_rls_catalog_attestation() TO service_role;

COMMIT;
