-- READ-ONLY schema extraction manifest for BOOTSTRAP-001.
-- Run only through a read-only PostgreSQL role against the production-like project.
-- This file contains SELECT statements only and never reads application table rows.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- The repeated VALUES relation is an in-memory name allowlist; no object is created.
-- Identity, ownership, RLS flags, persistence and comments.
SELECT 'relation' AS section, n.nspname AS schema_name, c.relname AS object_name,
       jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
         'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity,
         'persistence',c.relpersistence,'comment',obj_description(c.oid,'pg_class')) AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname
WHERE n.nspname='public' ORDER BY c.relname;

-- Columns, exact types/defaults, identity/generated markers and nullability.
SELECT 'column' AS section, n.nspname AS schema_name, c.relname AS object_name,
       jsonb_build_object('ordinal',a.attnum,'name',a.attname,
         'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
         'identity',a.attidentity,'generated',a.attgenerated,
         'default',pg_get_expr(ad.adbin,ad.adrelid),
         'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE co.collname END,
         'comment',col_description(c.oid,a.attnum)) AS definition
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname
LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
LEFT JOIN pg_collation co ON co.oid=a.attcollation
WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum;

-- PK, FK, UNIQUE, CHECK and exclusion constraints.
SELECT 'constraint' AS section, n.nspname AS schema_name, c.relname AS object_name,
       jsonb_build_object('name',con.conname,'type',con.contype,
         'definition',pg_get_constraintdef(con.oid,true),'validated',con.convalidated,
         'deferrable',con.condeferrable,'deferred',con.condeferred) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname
WHERE n.nspname='public' ORDER BY c.relname,con.conname;

SELECT 'index' AS section, schemaname AS schema_name, tablename AS object_name,
       jsonb_build_object('name',indexname,'definition',indexdef) AS definition
FROM pg_indexes i JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=i.tablename
WHERE schemaname='public' ORDER BY tablename,indexname;

SELECT 'policy' AS section, schemaname AS schema_name, tablename AS object_name,
       jsonb_build_object('name',policyname,'permissive',permissive,'roles',roles,
         'command',cmd,'using',qual,'check',with_check) AS definition
FROM pg_policies p JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=p.tablename
WHERE schemaname='public' ORDER BY tablename,policyname;

-- Explicit relation grants, including grantor and grant option.
SELECT 'grant' AS section, table_schema AS schema_name, table_name AS object_name,
       jsonb_build_object('grantor',grantor,'grantee',grantee,'privilege',privilege_type,
         'grantable',is_grantable) AS definition
FROM information_schema.role_table_grants g
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=g.table_name
WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type;

-- Non-internal triggers and exact trigger definitions.
SELECT 'trigger' AS section, n.nspname AS schema_name, c.relname AS object_name,
       jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),
         'function_oid',t.tgfoid::regprocedure::text,'enabled',t.tgenabled) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;

-- Exact definitions/security attributes for trigger functions and functions whose
-- dependency graph references a foundation relation.
WITH function_oids AS (
 SELECT DISTINCT t.tgfoid oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname WHERE NOT t.tgisinternal
 UNION
 SELECT DISTINCT d.objid FROM pg_depend d JOIN pg_class c ON c.oid=d.refobjid
 JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=c.relname
 WHERE d.classid='pg_proc'::regclass
)
SELECT 'function' AS section, n.nspname AS schema_name, p.proname AS object_name,
       jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
         'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
         'configuration',p.proconfig,'definition',pg_get_functiondef(p.oid)) AS definition
FROM function_oids x JOIN pg_proc p ON p.oid=x.oid JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY p.oid::regprocedure::text;

-- Views directly dependent on foundation relations.
SELECT DISTINCT 'view' AS section, nv.nspname AS schema_name, v.relname AS object_name,
       jsonb_build_object('owner',pg_get_userbyid(v.relowner),'definition',pg_get_viewdef(v.oid,true)) AS definition
FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class
JOIN pg_namespace nv ON nv.oid=v.relnamespace JOIN pg_class base ON base.oid=d.refobjid
JOIN (VALUES ('organization'),('jurisdiction'),('business_unit'),('app_user'),('app_role'),('user_membership'),('customer'),('contact'),('service_location'),('worker'),('marketing_source'),('campaign'),('configuration_version'),('external_reference'),('idempotency_key'),('audit_event'),('migration_lineage'),('service_request'),('opportunity'),('estimate'),('pricing_snapshot'),('quote'),('quote_version'),('quote_response'),('conversion_record'),('job_handoff')) AS f(name) ON f.name=base.relname
WHERE d.classid='pg_rewrite'::regclass AND nv.nspname='public' AND v.relkind IN ('v','m')
ORDER BY v.relname;

ROLLBACK;
