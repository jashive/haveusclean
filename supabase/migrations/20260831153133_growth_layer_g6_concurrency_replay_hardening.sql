-- G6 review hardening round 2: preserve emergency-stop atomicity under
-- concurrent execution and preserve staged-authorization exact replay.
-- No feature gate is enabled by this migration.

create or replace function public.growth_g6_record_staged_activation_authorization(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text,
  p_approved_by_app_user_id uuid,p_approval_reference text,p_approval_reason text,
  p_valid_until timestamptz,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_ready jsonb; v_snap jsonb; v_existing growth.staged_activation_authorization%rowtype; v_hash text; v_id uuid; v_policy_until timestamptz;
begin
  if not exists(select 1 from public.app_user au where au.id=p_approved_by_app_user_id and au.status='active') then raise exception 'approver must be active app user' using errcode='22023'; end if;

  -- Resolve exact retries before current readiness/gate checks. Execution
  -- eligibility is still independently re-evaluated before lease/consumption.
  select * into v_existing from growth.staged_activation_authorization a
  where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id
    and a.jurisdiction_id=p_jurisdiction_id and a.environment_name=p_environment_name
    and a.idempotency_key=p_idempotency_key;
  if found then
    v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
      'environment_name',p_environment_name,'pilot_policy_id',v_existing.pilot_policy_id::text,
      'pilot_policy_request_hash',v_existing.pilot_policy_request_hash,'runtime_fingerprint',v_existing.runtime_prerequisite_fingerprint,
      'approved_by',p_approved_by_app_user_id,'approval_reference',btrim(p_approval_reference),
      'approval_reason',btrim(p_approval_reason),'valid_until',p_valid_until,'metadata',coalesce(p_metadata,'{}'::jsonb)
    )::text,'UTF8'),'sha256'),'hex');
    if v_existing.request_hash<>v_hash then raise exception 'idempotency collision' using errcode='23505'; end if;
    return jsonb_build_object('status','STAGED_ACTIVATION_AUTHORIZED','authorization_id',v_existing.id,'idempotent_replay',true,'gate_mutation_performed',false);
  end if;

  v_ready:=public.growth_g6_commissioning_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name);
  if v_ready->>'status'<>'READY_FOR_STAGED_ACTIVATION_REQUEST' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_ready->'blockers','policy_version','g6-staged-activation-v1'); end if;
  v_snap:=public.growth_g6_runtime_prerequisite_snapshot(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name);
  if v_snap->>'status'<>'PREREQUISITES_READY' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_snap->'blocking_reasons','policy_version','g6-staged-activation-v1'); end if;
  select valid_until into v_policy_until from growth.pilot_policy where id=(v_snap->>'pilot_policy_id')::uuid;
  if p_valid_until<=now() or p_valid_until>now()+interval '24 hours' or p_valid_until>v_policy_until then raise exception 'authorization validity exceeds allowed window' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
    'environment_name',p_environment_name,'pilot_policy_id',v_snap->>'pilot_policy_id','pilot_policy_request_hash',v_snap->>'pilot_policy_request_hash',
    'runtime_fingerprint',v_snap->>'runtime_prerequisite_fingerprint','approved_by',p_approved_by_app_user_id,
    'approval_reference',btrim(p_approval_reference),'approval_reason',btrim(p_approval_reason),'valid_until',p_valid_until,
    'metadata',coalesce(p_metadata,'{}'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');
  insert into growth.staged_activation_authorization(
    organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_policy_id,pilot_policy_request_hash,
    provider_code,adapter_key,adapter_version,sender_email,evidence_snapshot,runtime_prerequisite_fingerprint,
    approved_by_app_user_id,approval_reference,approval_reason,valid_until,idempotency_key,request_hash,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name,(v_snap->>'pilot_policy_id')::uuid,v_snap->>'pilot_policy_request_hash',
    v_snap->>'provider_code',v_snap->>'adapter_key',v_snap->>'adapter_version',v_snap->>'sender_email',v_snap->'evidence_snapshot',v_snap->>'runtime_prerequisite_fingerprint',
    p_approved_by_app_user_id,btrim(p_approval_reference),btrim(p_approval_reason),p_valid_until,p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return jsonb_build_object('status','STAGED_ACTIVATION_AUTHORIZED','authorization_id',v_id,'idempotent_replay',false,'gate_mutation_performed',false,'runtime_prerequisite_fingerprint',v_snap->>'runtime_prerequisite_fingerprint');
end $$;

create or replace function public.growth_g6_emergency_stop_outreach_pilot(p_staged_activation_authorization_id uuid,p_actor_app_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_a growth.staged_activation_authorization%rowtype; v_l record; v_binding uuid; v_allow uuid; v_activation uuid;
begin
  select * into v_a from growth.staged_activation_authorization where id=p_staged_activation_authorization_id for update;
  if not found then raise exception 'staged activation authorization not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user u where u.id=p_actor_app_user_id and u.status='active') then raise exception 'active human actor required' using errcode='22023'; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception 'emergency stop reason required' using errcode='22023'; end if;

  -- Match provider execution lock order: lease(s) before feature gate(s).
  for v_l in select id from growth.provider_execution_lease
    where g6_staged_activation_authorization_id=v_a.id and lease_status='issued'
    order by id for update loop null; end loop;

  if not exists(select 1 from growth.staged_activation_authorization_revocation r where r.authorization_id=v_a.id) then
    insert into growth.staged_activation_authorization_revocation(authorization_id,revoked_by_app_user_id,revocation_reason)
    values(v_a.id,p_actor_app_user_id,'EMERGENCY STOP: '||btrim(p_reason));
  end if;
  perform 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled')
    order by gate_code for update;
  update growth.feature_gate set enabled=false,updated_at=now()
    where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled') and enabled=true;

  -- Direct conditional update tolerates leases consumed before lock acquisition.
  for v_l in update growth.provider_execution_lease set lease_status='revoked'
    where g6_staged_activation_authorization_id=v_a.id and lease_status='issued'
    returning id,organization_id,business_unit_id,provider_code,environment_name,adapter_key,adapter_version loop
    insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
    values(v_l.organization_id,v_l.business_unit_id,p_actor_app_user_id,'provider_execution_lease_revoked','growth_layer_1_0',v_l.id,
      jsonb_build_object('provider_code',v_l.provider_code,'environment_name',v_l.environment_name,'adapter_key',v_l.adapter_key,'adapter_version',v_l.adapter_version,'reason','G6 emergency stop: '||btrim(p_reason)));
  end loop;

  select id into v_binding from growth.provider_runtime_binding where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and binding_status='approved_metadata_only' order by created_at desc limit 1;
  if v_binding is not null then perform public.growth_g2_set_provider_runtime_binding_status(v_binding,'suspended',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  select id into v_allow from growth.provider_adapter_allowlist where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and adapter_version=v_a.adapter_version and allowlist_status='allowed' order by created_at desc limit 1;
  if v_allow is not null then perform public.growth_g2_set_provider_adapter_allowlist_status(v_allow,'suspended',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  select id into v_activation from growth.provider_activation_approval where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and adapter_version=v_a.adapter_version and approval_status='approved' order by created_at desc limit 1;
  if v_activation is not null then perform public.growth_g2_set_provider_activation_approval_status(v_activation,'revoked',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload)
  values(v_a.organization_id,v_a.business_unit_id,p_actor_app_user_id,'g6_outreach_pilot_emergency_stopped','growth_g6',v_a.id,
    jsonb_build_object('reason',btrim(p_reason),'provider_code',v_a.provider_code,'adapter_key',v_a.adapter_key,'adapter_version',v_a.adapter_version,'gates_forced_off',jsonb_build_array('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled')));
  return jsonb_build_object('status','EMERGENCY_STOPPED','authorization_id',v_a.id,'outreach_gate_enabled',false,'provider_execution_gate_enabled',false,'auto_followup_gate_enabled',false,'policy_version','g6-emergency-stop-v1');
end $$;

create or replace function public.growth_g6_revoke_handoff_pilot_policy(p_handoff_pilot_policy_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_p growth.handoff_pilot_policy%rowtype; v_r growth.handoff_pilot_policy_revocation%rowtype; v_l record;
begin
  select * into v_p from growth.handoff_pilot_policy where id=p_handoff_pilot_policy_id for update;
  if not found then raise exception 'handoff pilot policy not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user u where u.id=p_revoked_by_app_user_id and u.status='active') then raise exception 'active human revoker required' using errcode='22023'; end if;
  if btrim(coalesce(p_revocation_reason,''))='' then raise exception 'revocation reason required' using errcode='22023'; end if;

  -- Match G4 execution lock order: lease(s) before the handoff feature gate.
  for v_l in select id from growth.serviceos_handoff_execution_lease
    where g6_handoff_pilot_policy_id=v_p.id and lease_status='issued'
    order by id for update loop null; end loop;

  select * into v_r from growth.handoff_pilot_policy_revocation where handoff_pilot_policy_id=v_p.id;
  if not found then insert into growth.handoff_pilot_policy_revocation(handoff_pilot_policy_id,revoked_by_app_user_id,revocation_reason)
    values(v_p.id,p_revoked_by_app_user_id,btrim(p_revocation_reason)) returning * into v_r; end if;
  perform 1 from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled' for update;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_serviceos_handoff_enabled' and enabled=true;
  for v_l in select l.id,l.organization_id,l.business_unit_id,l.jurisdiction_id from growth.serviceos_handoff_execution_lease l
    where l.g6_handoff_pilot_policy_id=v_p.id and l.lease_status='issued' order by l.id loop
    perform public.growth_g4_revoke_serviceos_handoff_execution_lease(v_l.organization_id,v_l.business_unit_id,v_l.jurisdiction_id,v_l.id,'G6 handoff pilot policy revoked: '||btrim(p_revocation_reason));
  end loop;
  return jsonb_build_object('status','HANDOFF_PILOT_REVOKED','revocation_id',v_r.id,'handoff_gate_forced_off',true,'policy_version','g6-handoff-pilot-v1');
end $$;