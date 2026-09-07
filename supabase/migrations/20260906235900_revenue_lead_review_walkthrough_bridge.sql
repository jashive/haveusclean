-- Governed commercial walkthrough scheduling boundary for the Revenue lead drawer.
-- This qualifies the intake for proposal work only. It never creates pricing,
-- customer acceptance, a handoff, an operational job, or a worker assignment.

begin;

create or replace function public.schedule_commercial_walkthrough(
  p_service_request_id uuid,
  p_scheduled_at timestamptz,
  p_timezone text,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.service_request%rowtype;
  v_opportunity public.opportunity%rowtype;
  v_actor uuid;
begin
  if p_service_request_id is null or p_scheduled_at is null then
    raise exception 'Walkthrough service request and scheduled time are required';
  end if;
  if p_scheduled_at <= now() then raise exception 'Walkthrough must be scheduled in the future'; end if;
  if btrim(coalesce(p_timezone, '')) not in ('America/Toronto', 'America/Phoenix') then
    raise exception 'Walkthrough timezone must match an active HUC market';
  end if;

  select * into v_request from public.service_request where id = p_service_request_id for update;
  if not found then raise exception 'Commercial walkthrough lead was not found'; end if;
  if v_request.service_category <> 'commercial' or v_request.lifecycle_status <> 'walkthrough_requested' then
    raise exception 'Only a pending commercial walkthrough may be scheduled';
  end if;
  if not public.has_bu_role(v_request.organization_id, v_request.business_unit_id, array['owner_admin','office_ops']::text[]) then
    raise exception 'Walkthrough scheduling requires Owner/Admin or Office Operations access';
  end if;

  select * into v_opportunity
    from public.opportunity
   where service_request_id = v_request.id
     and organization_id = v_request.organization_id
     and business_unit_id = v_request.business_unit_id
     and stage = 'open'
   order by created_at asc limit 1 for update;
  if not found then raise exception 'Open scoped Revenue opportunity was not found'; end if;

  v_actor := public.current_app_user_id();
  update public.service_request
     set lifecycle_status = 'qualified',
         requirements = coalesce(requirements, '{}'::jsonb) || jsonb_build_object(
           'scheduled_walkthrough_at', p_scheduled_at,
           'scheduled_walkthrough_timezone', btrim(p_timezone),
           'walkthrough_internal_notes', nullif(btrim(coalesce(p_notes, '')), '')
         ),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'walkthrough_scheduled', true,
           'walkthrough_scheduled_at', p_scheduled_at,
           'walkthrough_scheduled_by_app_user_id', v_actor
         ),
         updated_by_app_user_id = v_actor
   where id = v_request.id;

  update public.opportunity
     set stage = 'qualified',
         summary = 'Commercial walkthrough scheduled; prepare a governed custom proposal after the site review.',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'walkthrough_scheduled', true,
           'walkthrough_scheduled_at', p_scheduled_at,
           'walkthrough_timezone', btrim(p_timezone)
         ),
         updated_by_app_user_id = v_actor
   where id = v_opportunity.id;

  return jsonb_build_object(
    'service_request_id', v_request.id, 'opportunity_id', v_opportunity.id,
    'service_request_status', 'qualified', 'opportunity_stage', 'qualified',
    'scheduled_at', p_scheduled_at, 'timezone', btrim(p_timezone)
  );
end;
$$;

revoke all on function public.schedule_commercial_walkthrough(uuid,timestamptz,text,text) from public, anon;
grant execute on function public.schedule_commercial_walkthrough(uuid,timestamptz,text,text) to authenticated;

comment on function public.schedule_commercial_walkthrough(uuid,timestamptz,text,text) is
  'RLS-respecting Owner/Admin or Office Ops transition from pending commercial walkthrough to qualified proposal work. No pricing, acceptance, handoff, job, or assignment side effects.';

commit;
