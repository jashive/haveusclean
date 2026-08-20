-- NON-PRODUCTION synthetic seed template. Run only after the canonical replay and OAT mutation preflight.
-- Required protected psql variables: owner_auth_id, office_auth_id, worker_auth_id, qa_auth_id.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_setting('serviceos.acceptance_approved',true) <> 'true' THEN RAISE EXCEPTION 'acceptance approval setting required'; END IF; END $$;
WITH j AS (INSERT INTO jurisdiction(code,country_code,currency_code,timezone,metadata) VALUES ('TEST-W6-JUR','US','USD','UTC','{"acceptance":true}'::jsonb) RETURNING id),
o AS (INSERT INTO organization(code,name) VALUES ('TEST-W6-ORG','TEST-W6 Synthetic Organization') RETURNING id)
INSERT INTO business_unit(organization_id,jurisdiction_id,code,name,metadata) SELECT o.id,j.id,'TEST-W6-BU','TEST-W6 Synthetic Business Unit','{"acceptance":true}'::jsonb FROM o,j;
INSERT INTO app_role(code,name) VALUES ('owner_admin','Owner Administrator'),('office_ops','Office Operations'),('worker','Worker'),('qa','Quality Assurance') ON CONFLICT(code) DO NOTHING;
INSERT INTO app_user(auth_user_id,display_name,status) VALUES
 (:'owner_auth_id','TEST-W6 Owner','active'),(:'office_auth_id','TEST-W6 Office','active'),(:'worker_auth_id','TEST-W6 Worker','active'),(:'qa_auth_id','TEST-W6 QA','active');
WITH scope AS (SELECT o.id org_id,b.id bu_id FROM organization o JOIN business_unit b ON b.organization_id=o.id WHERE o.code='TEST-W6-ORG' AND b.code='TEST-W6-BU')
INSERT INTO user_membership(app_user_id,organization_id,business_unit_id,role_id,status)
SELECT u.id,s.org_id,s.bu_id,r.id,'active' FROM scope s JOIN app_user u ON u.auth_user_id IN (:'owner_auth_id',:'office_auth_id',:'worker_auth_id',:'qa_auth_id') JOIN app_role r ON r.code=CASE u.auth_user_id WHEN :'owner_auth_id' THEN 'owner_admin' WHEN :'office_auth_id' THEN 'office_ops' WHEN :'worker_auth_id' THEN 'worker' ELSE 'qa' END;
WITH scope AS (SELECT o.id org_id,b.id bu_id FROM organization o JOIN business_unit b ON b.organization_id=o.id WHERE o.code='TEST-W6-ORG' AND b.code='TEST-W6-BU')
INSERT INTO worker(organization_id,business_unit_id,app_user_id,worker_type,display_name,status,metadata) SELECT s.org_id,s.bu_id,u.id,'contractor','TEST-W6 Worker','active','{"acceptance":true}'::jsonb FROM scope s JOIN app_user u ON u.auth_user_id=:'worker_auth_id';
COMMIT;
