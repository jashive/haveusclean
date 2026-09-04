-- PostgREST-visible Workforce compliance pipeline wrapper.
-- HEMS remains the governance authority. Browser roles do not execute this RPC directly;
-- the authenticated Owner/Admin Workforce API calls it server-side with service_role.

create or replace function public.get_workforce_compliance_pipeline(
  p_actor_app_user_id uuid,
  p_business_unit_id uuid,
  p_organization_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select hems_hr.get_workforce_compliance_pipeline(
    p_organization_id,
    p_business_unit_id,
    p_actor_app_user_id
  );
$$;

revoke all on function public.get_workforce_compliance_pipeline(uuid,uuid,uuid) from public;
revoke all on function public.get_workforce_compliance_pipeline(uuid,uuid,uuid) from anon;
revoke all on function public.get_workforce_compliance_pipeline(uuid,uuid,uuid) from authenticated;
grant execute on function public.get_workforce_compliance_pipeline(uuid,uuid,uuid) to service_role;

comment on function public.get_workforce_compliance_pipeline(uuid,uuid,uuid) is
  'PostgREST-visible service-role wrapper for the governed HEMS Workforce compliance pipeline.';

notify pgrst, 'reload schema';
