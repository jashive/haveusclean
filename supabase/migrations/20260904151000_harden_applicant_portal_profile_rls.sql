-- Defense in depth for the private applicant token/profile table.
-- Only the backend service role may access it; browser roles receive no grants
-- and no RLS policies.
begin;

alter table hems_hr.applicant_portal_profile enable row level security;

revoke all privileges on table hems_hr.applicant_portal_profile
  from public, anon, authenticated;

grant select, insert, update, delete on table hems_hr.applicant_portal_profile
  to service_role;

commit;
