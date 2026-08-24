create or replace function public.growth_g2_authorization_lifecycle_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'growth_g2: provider authorization records cannot be deleted'; end if;
  if tg_table_name='provider_runtime_binding' then
    if (to_jsonb(new)-'binding_status') is distinct from (to_jsonb(old)-'binding_status') then raise exception 'growth_g2: runtime binding fields are immutable'; end if;
    if not ((old.binding_status='approved_metadata_only' and new.binding_status in ('suspended','revoked')) or (old.binding_status='suspended' and new.binding_status in ('approved_metadata_only','revoked'))) then raise exception 'growth_g2: invalid runtime binding transition'; end if;
  elsif tg_table_name='provider_adapter_allowlist' then
    if (to_jsonb(new)-'allowlist_status') is distinct from (to_jsonb(old)-'allowlist_status') then raise exception 'growth_g2: adapter allowlist fields are immutable'; end if;
    if not ((old.allowlist_status='allowed' and new.allowlist_status in ('suspended','revoked')) or (old.allowlist_status='suspended' and new.allowlist_status in ('allowed','revoked'))) then raise exception 'growth_g2: invalid adapter allowlist transition'; end if;
  elsif tg_table_name='provider_activation_approval' then
    if (to_jsonb(new)-'approval_status') is distinct from (to_jsonb(old)-'approval_status') then raise exception 'growth_g2: activation approval fields are immutable'; end if;
    if not (old.approval_status='approved' and new.approval_status in ('revoked','expired')) then raise exception 'growth_g2: invalid activation approval transition'; end if;
  else
    raise exception 'growth_g2: unsupported authorization lifecycle table';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_growth_g2_runtime_binding_immutable on growth.provider_runtime_binding;
create trigger trg_growth_g2_runtime_binding_immutable before update or delete on growth.provider_runtime_binding for each row execute function public.growth_g2_authorization_lifecycle_guard();
drop trigger if exists trg_growth_g2_adapter_allowlist_immutable on growth.provider_adapter_allowlist;
create trigger trg_growth_g2_adapter_allowlist_immutable before update or delete on growth.provider_adapter_allowlist for each row execute function public.growth_g2_authorization_lifecycle_guard();
drop trigger if exists trg_growth_g2_activation_approval_immutable on growth.provider_activation_approval;
create trigger trg_growth_g2_activation_approval_immutable before update or delete on growth.provider_activation_approval for each row execute function public.growth_g2_authorization_lifecycle_guard();

create or replace function public.growth_g2_set_provider_runtime_binding_status(p_binding_id uuid,p_status text,p_reviewer_app_user_id uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row growth.provider_runtime_binding%rowtype;
begin
  if p_status not in ('approved_metadata_only','suspended','revoked') then raise exception 'growth_g2: invalid runtime binding status'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'growth_g2: lifecycle reason required'; end if;
  select * into v_row from growth.provider_runtime_binding where id=p_binding_id for update;
  if v_row.id is null then raise exception 'growth_g2: runtime binding not found'; end if;
  if v_row.binding_status=p_status then return p_status; end if;
  update growth.provider_runtime_binding set binding_status=p_status where id=p_binding_id;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
  values(v_row.organization_id,v_row.business_unit_id,p_reviewer_app_user_id,'provider_runtime_binding_status_changed','growth_layer_1_0',p_binding_id,jsonb_build_object('provider_code',v_row.provider_code,'environment_name',v_row.environment_name,'adapter_key',v_row.adapter_key,'from_status',v_row.binding_status,'to_status',p_status,'reason',btrim(p_reason)));
  return p_status;
end;
$$;

create or replace function public.growth_g2_set_provider_adapter_allowlist_status(p_allowlist_id uuid,p_status text,p_reviewer_app_user_id uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row growth.provider_adapter_allowlist%rowtype;
begin
  if p_status not in ('allowed','suspended','revoked') then raise exception 'growth_g2: invalid adapter allowlist status'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'growth_g2: lifecycle reason required'; end if;
  select * into v_row from growth.provider_adapter_allowlist where id=p_allowlist_id for update;
  if v_row.id is null then raise exception 'growth_g2: adapter allowlist not found'; end if;
  if v_row.allowlist_status=p_status then return p_status; end if;
  update growth.provider_adapter_allowlist set allowlist_status=p_status where id=p_allowlist_id;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
  values(v_row.organization_id,v_row.business_unit_id,p_reviewer_app_user_id,'provider_adapter_allowlist_status_changed','growth_layer_1_0',p_allowlist_id,jsonb_build_object('provider_code',v_row.provider_code,'environment_name',v_row.environment_name,'adapter_key',v_row.adapter_key,'adapter_version',v_row.adapter_version,'from_status',v_row.allowlist_status,'to_status',p_status,'reason',btrim(p_reason)));
  return p_status;
end;
$$;

create or replace function public.growth_g2_set_provider_activation_approval_status(p_activation_id uuid,p_status text,p_reviewer_app_user_id uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row growth.provider_activation_approval%rowtype;
begin
  if p_status not in ('revoked','expired') then raise exception 'growth_g2: invalid activation approval terminal status'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'growth_g2: lifecycle reason required'; end if;
  select * into v_row from growth.provider_activation_approval where id=p_activation_id for update;
  if v_row.id is null then raise exception 'growth_g2: activation approval not found'; end if;
  if v_row.approval_status=p_status then return p_status; end if;
  update growth.provider_activation_approval set approval_status=p_status where id=p_activation_id;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
  values(v_row.organization_id,v_row.business_unit_id,p_reviewer_app_user_id,'provider_activation_approval_status_changed','growth_layer_1_0',p_activation_id,jsonb_build_object('provider_code',v_row.provider_code,'environment_name',v_row.environment_name,'adapter_key',v_row.adapter_key,'adapter_version',v_row.adapter_version,'from_status',v_row.approval_status,'to_status',p_status,'reason',btrim(p_reason)));
  return p_status;
end;
$$;

create or replace function public.growth_g2_revoke_provider_execution_lease(p_lease_id uuid,p_reviewer_app_user_id uuid,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row growth.provider_execution_lease%rowtype;
begin
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'growth_g2: lifecycle reason required'; end if;
  select * into v_row from growth.provider_execution_lease where id=p_lease_id for update;
  if v_row.id is null then raise exception 'growth_g2: execution lease not found'; end if;
  if v_row.lease_status='revoked' then return 'revoked'; end if;
  if v_row.lease_status<>'issued' then raise exception 'growth_g2: only issued leases can be revoked'; end if;
  update growth.provider_execution_lease set lease_status='revoked' where id=p_lease_id;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
  values(v_row.organization_id,v_row.business_unit_id,p_reviewer_app_user_id,'provider_execution_lease_revoked','growth_layer_1_0',p_lease_id,jsonb_build_object('provider_code',v_row.provider_code,'environment_name',v_row.environment_name,'adapter_key',v_row.adapter_key,'adapter_version',v_row.adapter_version,'reason',btrim(p_reason)));
  return 'revoked';
end;
$$;

revoke execute on function public.growth_g2_authorization_lifecycle_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_set_provider_runtime_binding_status(uuid,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_set_provider_adapter_allowlist_status(uuid,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_set_provider_activation_approval_status(uuid,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_revoke_provider_execution_lease(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g2_set_provider_runtime_binding_status(uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g2_set_provider_adapter_allowlist_status(uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g2_set_provider_activation_approval_status(uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g2_revoke_provider_execution_lease(uuid,uuid,text) to service_role;
