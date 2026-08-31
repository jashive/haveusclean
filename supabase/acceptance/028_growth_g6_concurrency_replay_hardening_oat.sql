-- G6 concurrency/replay hardening OAT.
-- Acceptance-only / synthetic / rollback-only.
begin;

do $$
declare
  v_org uuid:='411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid:='03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid:='09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_user uuid:='ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_policy uuid:=gen_random_uuid();
  v_auth uuid:=gen_random_uuid();
  v_until timestamptz:=now()+interval '30 minutes';
  v_meta jsonb:=jsonb_build_object('synthetic',true,'g6_oat',28,'acceptance_db_only',true);
  v_hash text;
  v_replay jsonb;
  v_collision boolean:=false;
  v_provider_stop_fn text;
  v_handoff_stop_fn text;
begin
  if exists(select 1 from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) then
    raise exception 'G6 OAT 028 requires protected gates OFF at start';
  end if;

  -- Review race-condition contract: both stop paths acquire execution-lease
  -- locks before their feature-gate locks, matching the execution paths.
  v_provider_stop_fn:=pg_get_functiondef('public.growth_g6_emergency_stop_outreach_pilot(uuid,uuid,text)'::regprocedure);
  if position('from growth.provider_execution_lease' in v_provider_stop_fn)=0
     or position('from growth.feature_gate' in v_provider_stop_fn)=0
     or position('from growth.provider_execution_lease' in v_provider_stop_fn) >= position('from growth.feature_gate' in v_provider_stop_fn) then
    raise exception 'G6 OAT 028 provider emergency-stop lock order regressed';
  end if;
  if position('update growth.provider_execution_lease' in v_provider_stop_fn)=0 then
    raise exception 'G6 OAT 028 provider emergency stop is not tolerant of pre-lock consumption';
  end if;

  v_handoff_stop_fn:=pg_get_functiondef('public.growth_g6_revoke_handoff_pilot_policy(uuid,uuid,text)'::regprocedure);
  if position('from growth.serviceos_handoff_execution_lease' in v_handoff_stop_fn)=0
     or position('from growth.feature_gate' in v_handoff_stop_fn)=0
     or position('from growth.serviceos_handoff_execution_lease' in v_handoff_stop_fn) >= position('from growth.feature_gate' in v_handoff_stop_fn) then
    raise exception 'G6 OAT 028 handoff stop lock order regressed';
  end if;

  -- Staged-authorization replay fixture. It is deliberately inserted directly
  -- so current commissioning readiness can be made false after the original
  -- response, proving replay happens before new-authorization readiness checks.
  insert into growth.pilot_policy(
    id,organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_stage,
    provider_code,adapter_key,adapter_version,sender_email,daily_send_cap,total_send_cap,
    approved_by_app_user_id,approval_reference,approval_reason,valid_from,valid_until,
    idempotency_key,request_hash,metadata
  ) values(
    v_policy,v_org,v_bu,v_jur,'production','manual_email_outreach',
    'g6-oat-028-provider','g6-oat-028-adapter','1.0.0','g6-oat-028@example.invalid',1,1,
    v_user,'G6-OAT-028-POLICY','Synthetic replay fixture',now()-interval '1 minute',now()+interval '1 hour',
    'G6-OAT-028-POLICY',repeat('a',64),v_meta
  );

  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',v_org,'business_unit_id',v_bu,'jurisdiction_id',v_jur,
    'environment_name','production','pilot_policy_id',v_policy::text,
    'pilot_policy_request_hash',repeat('a',64),'runtime_fingerprint',repeat('b',64),
    'approved_by',v_user,'approval_reference','G6-OAT-028-AUTH',
    'approval_reason','Synthetic staged authorization replay','valid_until',v_until,'metadata',v_meta
  )::text,'UTF8'),'sha256'),'hex');

  insert into growth.staged_activation_authorization(
    id,organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_policy_id,
    pilot_policy_request_hash,provider_code,adapter_key,adapter_version,sender_email,
    evidence_snapshot,runtime_prerequisite_fingerprint,approved_by_app_user_id,
    approval_reference,approval_reason,valid_until,idempotency_key,request_hash,metadata
  ) values(
    v_auth,v_org,v_bu,v_jur,'production',v_policy,repeat('a',64),
    'g6-oat-028-provider','g6-oat-028-adapter','1.0.0','g6-oat-028@example.invalid',
    '{}'::jsonb,repeat('b',64),v_user,'G6-OAT-028-AUTH','Synthetic staged authorization replay',
    v_until,'G6-OAT-028-AUTH',v_hash,v_meta
  );

  -- Current readiness is now false. An exact lost-response retry must still be
  -- recoverable; this does not make the authorization currently executable.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_replay:=public.growth_g6_record_staged_activation_authorization(
    v_org,v_bu,v_jur,'production',v_user,'G6-OAT-028-AUTH',
    'Synthetic staged authorization replay',v_until,'G6-OAT-028-AUTH',v_meta
  );
  if v_replay->>'status'<>'STAGED_ACTIVATION_AUTHORIZED'
     or not coalesce((v_replay->>'idempotent_replay')::boolean,false)
     or v_replay->>'authorization_id'<>v_auth::text then
    raise exception 'G6 OAT 028 staged replay failed with gate on: %',v_replay;
  end if;

  begin
    perform public.growth_g6_record_staged_activation_authorization(
      v_org,v_bu,v_jur,'production',v_user,'G6-OAT-028-AUTH',
      'CHANGED PAYLOAD',v_until,'G6-OAT-028-AUTH',v_meta
    );
  exception when unique_violation then v_collision:=true; end;
  if not v_collision then raise exception 'G6 OAT 028 changed staged-authorization payload did not collide'; end if;
end $$;

rollback;

select
  (select count(*) from growth.pilot_policy where idempotency_key like 'G6-OAT-028-%') as persisted_policies,
  (select count(*) from growth.staged_activation_authorization where idempotency_key like 'G6-OAT-028-%') as persisted_authorizations,
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_auto_followup_enabled') as auto_followup_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_execution_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as serviceos_handoff_enabled;