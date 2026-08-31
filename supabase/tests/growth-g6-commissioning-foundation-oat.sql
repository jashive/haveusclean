begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_user uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_from timestamptz := now()-interval '1 minute';
  v_until timestamptz := now()+interval '1 day';
  v_types text[] := array['legal_compliance_approval','provider_security_review','sender_domain_readiness','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval'];
  v_type text; v_first jsonb; v_replay jsonb; v_evidence_id uuid; v_policy jsonb; v_readiness jsonb; v_gate record;
begin
  v_readiness := public.growth_g6_commissioning_readiness(v_org,v_bu,v_jur,'acceptance');
  if v_readiness->>'status'<>'BLOCKED' or coalesce((v_readiness->>'execution_authorized')::boolean,true) then raise exception 'G6 OAT: empty readiness did not fail closed'; end if;

  foreach v_type in array v_types loop
    v_first:=public.growth_g6_record_commissioning_evidence(v_org,v_bu,v_jur,'acceptance',v_type,'G6-OAT synthetic evidence '||v_type,v_user,v_from,v_until,'G6-OAT-'||v_type,jsonb_build_object('synthetic',true));
    v_replay:=public.growth_g6_record_commissioning_evidence(v_org,v_bu,v_jur,'acceptance',v_type,'G6-OAT synthetic evidence '||v_type,v_user,v_from,v_until,'G6-OAT-'||v_type,jsonb_build_object('synthetic',true));
    if coalesce((v_first->>'idempotent_replay')::boolean,true) or not coalesce((v_replay->>'idempotent_replay')::boolean,false) or v_first->>'evidence_id'<>v_replay->>'evidence_id' then raise exception 'G6 OAT: evidence replay failed for %',v_type; end if;
  end loop;

  begin
    perform public.growth_g6_record_commissioning_evidence(v_org,v_bu,v_jur,'acceptance','legal_compliance_approval','G6-OAT changed payload',v_user,v_from,v_until,'G6-OAT-legal_compliance_approval',jsonb_build_object('synthetic',true));
    raise exception 'G6 OAT: changed evidence payload reused idempotency key';
  exception when unique_violation then null; end;

  select id into v_evidence_id from growth.commissioning_evidence where organization_id=v_org and business_unit_id=v_bu and jurisdiction_id=v_jur and evidence_type='legal_compliance_approval' and idempotency_key='G6-OAT-legal_compliance_approval';
  begin
    update growth.commissioning_evidence set evidence_reference='mutated' where id=v_evidence_id;
    raise exception 'G6 OAT: append-only evidence UPDATE unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null; end;

  v_policy:=public.growth_g6_record_pilot_policy(v_org,v_bu,v_jur,'acceptance','g6-oat-provider','g6-oat-adapter','v1','g6-oat@example.invalid',5,10,v_user,'G6-OAT-APPROVAL','Synthetic rollback-only pilot policy',v_from,v_until,'G6-OAT-PILOT',jsonb_build_object('synthetic',true));
  v_replay:=public.growth_g6_record_pilot_policy(v_org,v_bu,v_jur,'acceptance','g6-oat-provider','g6-oat-adapter','v1','g6-oat@example.invalid',5,10,v_user,'G6-OAT-APPROVAL','Synthetic rollback-only pilot policy',v_from,v_until,'G6-OAT-PILOT',jsonb_build_object('synthetic',true));
  if coalesce((v_policy->>'idempotent_replay')::boolean,true) or not coalesce((v_replay->>'idempotent_replay')::boolean,false) or v_policy->>'pilot_policy_id'<>v_replay->>'pilot_policy_id' then raise exception 'G6 OAT: pilot policy replay failed'; end if;

  begin
    perform public.growth_g6_record_pilot_policy(v_org,v_bu,v_jur,'acceptance','g6-oat-provider','g6-oat-adapter','v1','g6-oat@example.invalid',6,10,v_user,'G6-OAT-APPROVAL','Synthetic rollback-only pilot policy',v_from,v_until,'G6-OAT-PILOT',jsonb_build_object('synthetic',true));
    raise exception 'G6 OAT: changed pilot payload reused idempotency key';
  exception when unique_violation then null; end;

  v_readiness:=public.growth_g6_commissioning_readiness(v_org,v_bu,v_jur,'acceptance');
  if v_readiness->>'status'<>'BLOCKED' then raise exception 'G6 OAT: commissioning unexpectedly ready without sender/provider controls'; end if;
  if not (v_readiness->'blockers' ? 'sender_not_ready') then raise exception 'G6 OAT: sender readiness blocker absent'; end if;
  if not (v_readiness->'blockers' ? 'provider_runtime_binding_not_ready') then raise exception 'G6 OAT: provider runtime blocker absent'; end if;
  if not (v_readiness->'blockers' ? 'provider_adapter_not_allowlisted') then raise exception 'G6 OAT: provider allowlist blocker absent'; end if;
  if not (v_readiness->'blockers' ? 'provider_activation_approval_missing') then raise exception 'G6 OAT: provider activation blocker absent'; end if;
  if coalesce((v_readiness->>'execution_authorized')::boolean,true) or coalesce((v_readiness->>'gate_mutation_performed')::boolean,true) then raise exception 'G6 OAT: readiness authorized execution or mutated a gate'; end if;
  if (v_readiness->>'handoff_cap')::int<>0 or coalesce((v_readiness->>'auto_followup_allowed')::boolean,true) or coalesce((v_readiness->>'sms_allowed')::boolean,true) or coalesce((v_readiness->>'phone_allowed')::boolean,true) then raise exception 'G6 OAT: first-stage policy violated channel/handoff restrictions'; end if;

  perform public.growth_g6_revoke_commissioning_evidence(v_evidence_id,v_user,'G6-OAT revocation proof');
  v_readiness:=public.growth_g6_commissioning_readiness(v_org,v_bu,v_jur,'acceptance');
  if not (v_readiness->'blockers' ? 'missing_or_inactive_evidence:legal_compliance_approval') then raise exception 'G6 OAT: evidence revocation did not invalidate readiness'; end if;

  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then raise exception 'G6 OAT: protected gate enabled: %',v_gate.gate_code; end if; end loop;
end $$;

select 'PASS' as g6_oat_024_commissioning_foundation,
       (select count(*) from growth.commissioning_evidence where idempotency_key like 'G6-OAT-%') as synthetic_evidence_rows_inside_tx,
       (select count(*) from growth.pilot_policy where idempotency_key='G6-OAT-PILOT') as synthetic_policy_rows_inside_tx;
rollback;
