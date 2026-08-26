drop function if exists public.growth_g4_build_serviceos_handoff_dry_run_plan(uuid,uuid,uuid,uuid);
alter function public.growth_g4_create_serviceos_handoff_plan(uuid,uuid,uuid,uuid) rename to growth_g4_build_serviceos_handoff_dry_run_plan;
revoke execute on function public.growth_g4_build_serviceos_handoff_dry_run_plan(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g4_build_serviceos_handoff_dry_run_plan(uuid,uuid,uuid,uuid) to service_role;
