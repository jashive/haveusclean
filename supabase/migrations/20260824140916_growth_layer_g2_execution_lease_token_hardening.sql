create or replace function public.growth_g2_issue_provider_execution_lease(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_reservation_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_auth jsonb;
  v_binding uuid;
  v_allow uuid;
  v_activation uuid;
  v_existing growth.provider_execution_lease%rowtype;
  v_raw_token text;
  v_token_hash text;
  v_id uuid;
  v_exp timestamptz;
begin
  v_auth:=public.growth_g2_evaluate_provider_execution_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,p_provider_code,p_environment_name,p_adapter_key,p_adapter_version);
  if v_auth->>'status'<>'AUTHORIZED_FOR_LEASE' then return v_auth; end if;
  v_binding:=(v_auth->>'runtime_binding_id')::uuid;
  v_allow:=(v_auth->>'allowlist_id')::uuid;
  v_activation:=(v_auth->>'activation_approval_id')::uuid;
  select * into v_existing from growth.provider_execution_lease l where l.outreach_submission_reservation_id=p_reservation_id;
  if v_existing.id is not null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_lease_already_exists'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_exp:=least(now()+interval '10 minutes',(select a.valid_until from growth.provider_activation_approval a where a.id=v_activation));
  if v_exp<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('activation_expired'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_raw_token:=pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token,'UTF8'),'sha256'),'hex');
  insert into growth.provider_execution_lease(organization_id,business_unit_id,jurisdiction_id,outreach_submission_reservation_id,provider_runtime_binding_id,provider_adapter_allowlist_id,provider_activation_approval_id,provider_code,environment_name,adapter_key,adapter_version,lease_token_hash,lease_status,issued_at,expires_at,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,v_binding,v_allow,v_activation,lower(btrim(p_provider_code)),p_environment_name,btrim(p_adapter_key),btrim(p_adapter_version),v_token_hash,'issued',now(),v_exp,jsonb_build_object('single_use',true,'credentials_external_only',true,'policy_version','g2-provider-execution-auth-2026-08-24')) returning id into v_id;
  return jsonb_build_object('status','LEASE_ISSUED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_id,'expires_at',v_exp,'execution_token',v_raw_token);
end;
$$;

create or replace function public.growth_g2_consume_provider_execution_lease(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_lease_id uuid,p_execution_token text,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_lease growth.provider_execution_lease%rowtype;
  v_token_hash text;
  v_activation growth.provider_activation_approval%rowtype;
  v_binding growth.provider_runtime_binding%rowtype;
  v_allow growth.provider_adapter_allowlist%rowtype;
begin
  if nullif(btrim(coalesce(p_execution_token,'')),'') is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('execution_token_missing'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_lease from growth.provider_execution_lease l where l.id=p_lease_id for update;
  if v_lease.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_found'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.organization_id<>p_organization_id or v_lease.business_unit_id<>p_business_unit_id or v_lease.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_scope_mismatch'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.provider_code<>lower(btrim(coalesce(p_provider_code,''))) or v_lease.environment_name<>p_environment_name or v_lease.adapter_key<>btrim(coalesce(p_adapter_key,'')) or v_lease.adapter_version<>btrim(coalesce(p_adapter_version,'')) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_adapter_context_mismatch'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.lease_status<>'issued' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_issued'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.expires_at<=now() then update growth.provider_execution_lease set lease_status='expired' where id=v_lease.id; return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_expired'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('growth_layer_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('outreach_gate_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_provider_execution_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('provider_execution_gate_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_binding from growth.provider_runtime_binding b where b.id=v_lease.provider_runtime_binding_id;
  if v_binding.id is null or v_binding.binding_status<>'approved_metadata_only' or v_binding.valid_until<=now() or v_binding.credential_state<>'configured_external' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('runtime_binding_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_allow from growth.provider_adapter_allowlist a where a.id=v_lease.provider_adapter_allowlist_id;
  if v_allow.id is null or v_allow.allowlist_status<>'allowed' or v_allow.valid_until<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('adapter_allowlist_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_activation from growth.provider_activation_approval a where a.id=v_lease.provider_activation_approval_id;
  if v_activation.id is null or v_activation.approval_status<>'approved' or v_activation.valid_from>now() or v_activation.valid_until<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('human_activation_approval_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(btrim(p_execution_token),'UTF8'),'sha256'),'hex');
  if v_token_hash<>v_lease.lease_token_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('execution_token_invalid'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  update growth.provider_execution_lease set lease_status='consumed',consumed_at=now() where id=v_lease.id;
  return jsonb_build_object('status','LEASE_CONSUMED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_lease.id,'reservation_id',v_lease.outreach_submission_reservation_id,'provider_code',v_lease.provider_code,'environment_name',v_lease.environment_name,'adapter_key',v_lease.adapter_key,'adapter_version',v_lease.adapter_version);
end;
$$;

revoke execute on function public.growth_g2_consume_provider_execution_lease(uuid,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.growth_g2_consume_provider_execution_lease(uuid,uuid,uuid,uuid,text,text,text,text,text) to service_role;
