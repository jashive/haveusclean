alter table growth.feature_gate drop constraint growth_feature_gate_code_ck;
alter table growth.feature_gate add constraint growth_feature_gate_code_ck check (gate_code = any (array['growth_layer_enabled'::text,'growth_outreach_enabled'::text,'growth_auto_followup_enabled'::text,'growth_serviceos_handoff_enabled'::text,'growth_provider_execution_enabled'::text]));

insert into growth.feature_gate(gate_code,enabled,description,metadata)
values('growth_provider_execution_enabled',false,'Controls issuance of provider execution leases; default OFF and separately governed from outreach eligibility.',jsonb_build_object('owner','HEMS','scope','provider execution authorization','default','off'))
on conflict (gate_code) do nothing;

create or replace function public.growth_g2_evaluate_provider_execution_authorization(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_reservation_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_res growth.outreach_submission_reservation%rowtype;
  v_binding growth.provider_runtime_binding%rowtype;
  v_allow growth.provider_adapter_allowlist%rowtype;
  v_activation growth.provider_activation_approval%rowtype;
  v_blockers text[]:=array[]::text[];
begin
  select * into v_res from growth.outreach_submission_reservation r where r.id=p_reservation_id;
  if v_res.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_not_found'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_res.organization_id<>p_organization_id or v_res.business_unit_id<>p_business_unit_id or v_res.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'reservation_scope_mismatch'); end if;
  if v_res.reservation_status<>'reserved' then v_blockers:=array_append(v_blockers,'reservation_not_reserved'); end if;
  if v_res.provider_code<>lower(btrim(coalesce(p_provider_code,''))) then v_blockers:=array_append(v_blockers,'reservation_provider_mismatch'); end if;
  if coalesce((v_res.metadata->>'non_sending')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'reservation_not_non_sending'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'growth_layer_disabled'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'outreach_gate_disabled'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_provider_execution_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'provider_execution_gate_disabled'); end if;
  select * into v_binding from growth.provider_runtime_binding b where b.organization_id=p_organization_id and b.business_unit_id=p_business_unit_id and b.jurisdiction_id=p_jurisdiction_id and b.provider_code=lower(btrim(p_provider_code)) and b.channel='email' and b.environment_name=p_environment_name and b.adapter_key=btrim(p_adapter_key) order by b.created_at desc limit 1;
  if v_binding.id is null then v_blockers:=array_append(v_blockers,'runtime_binding_missing'); else
    if v_binding.binding_status<>'approved_metadata_only' or v_binding.valid_until<=now() then v_blockers:=array_append(v_blockers,'runtime_binding_not_current'); end if;
    if v_binding.credential_state<>'configured_external' then v_blockers:=array_append(v_blockers,'provider_credentials_absent'); end if;
  end if;
  select * into v_allow from growth.provider_adapter_allowlist a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version) order by a.created_at desc limit 1;
  if v_allow.id is null then v_blockers:=array_append(v_blockers,'adapter_not_allowlisted'); else if v_allow.allowlist_status<>'allowed' or v_allow.valid_until<=now() then v_blockers:=array_append(v_blockers,'adapter_allowlist_not_current'); end if; end if;
  select * into v_activation from growth.provider_activation_approval a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version) and a.approval_status='approved' and a.valid_from<=now() and a.valid_until>now() order by a.created_at desc limit 1;
  if v_activation.id is null then v_blockers:=array_append(v_blockers,'human_activation_approval_missing'); end if;
  return jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'AUTHORIZED_FOR_LEASE' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-provider-execution-auth-2026-08-24','reservation_id',v_res.id,'runtime_binding_id',v_binding.id,'allowlist_id',v_allow.id,'activation_approval_id',v_activation.id,'credential_reference_name',v_binding.credential_reference_name);
end;
$$;

revoke execute on function public.growth_g2_evaluate_provider_execution_authorization(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.growth_g2_evaluate_provider_execution_authorization(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
