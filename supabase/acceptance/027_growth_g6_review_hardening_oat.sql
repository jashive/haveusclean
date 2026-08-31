-- G6 review-hardening OAT: quota-policy continuity contract + active handoff-policy replay.
-- Acceptance-only / synthetic / rollback-only.
begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_user uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_type text;
  v_until timestamptz := now()+interval '20 minutes';
  v_first jsonb;
  v_replay jsonb;
  v_collision_blocked boolean := false;
  v_fn text;
begin
  if exists(
    select 1 from growth.feature_gate
    where gate_code in (
      'growth_outreach_enabled',
      'growth_auto_followup_enabled',
      'growth_provider_execution_enabled',
      'growth_serviceos_handoff_enabled'
    ) and enabled=true
  ) then
    raise exception 'G6 OAT 027 requires all protected execution gates OFF at start';
  end if;

  -- P1 regression contract: quota is serialized/counts at the immutable pilot
  -- policy boundary, so replacing a staged authorization cannot reset caps.
  v_fn := pg_get_functiondef('public.growth_g6_reserve_pilot_send_for_provider_lease(uuid,uuid)'::regprocedure);
  if position('from growth.pilot_policy' in v_fn)=0 or position('for update' in v_fn)=0 then
    raise exception 'G6 OAT 027: shared pilot policy is not locked for quota serialization';
  end if;
  if position('where pilot_policy_id=v_p.id' in v_fn)=0 then
    raise exception 'G6 OAT 027: total quota is not scoped to pilot policy';
  end if;
  if position('where pilot_policy_id=v_p.id and quota_day=v_day' in v_fn)=0 then
    raise exception 'G6 OAT 027: daily quota is not scoped to pilot policy/day';
  end if;
  if not exists(
    select 1 from pg_indexes
    where schemaname='growth'
      and tablename='pilot_send_reservation'
      and indexname='pilot_send_policy_quota_idx'
  ) then
    raise exception 'G6 OAT 027: pilot policy quota index missing';
  end if;

  -- P2 regression: exact retry of an active handoff pilot policy must replay,
  -- while changed payload under the same idempotency key remains a collision.
  foreach v_type in array array[
    'serviceos_handoff_pilot_ready',
    'monitoring_alerting_readiness',
    'rollback_emergency_stop_readiness',
    'staff_sop_training_ready',
    'hems_pilot_approval'
  ] loop
    perform public.growth_g6_record_commissioning_evidence(
      v_org,v_bu,v_jur,'production',v_type,
      'G6-OAT-027 evidence '||v_type,
      v_user,now()-interval '1 minute',now()+interval '1 hour',
      'G6-OAT-027-'||v_type,
      jsonb_build_object('synthetic',true,'g6_oat',27,'acceptance_db_only',true)
    );
  end loop;

  v_first := public.growth_g6_record_handoff_pilot_policy(
    v_org,v_bu,v_jur,1,v_user,
    'G6-OAT-027-HANDOFF','Idempotency regression',v_until,
    'G6-OAT-027-HANDOFF',
    jsonb_build_object('synthetic',true,'g6_oat',27,'acceptance_db_only',true)
  );

  v_replay := public.growth_g6_record_handoff_pilot_policy(
    v_org,v_bu,v_jur,1,v_user,
    'G6-OAT-027-HANDOFF','Idempotency regression',v_until,
    'G6-OAT-027-HANDOFF',
    jsonb_build_object('synthetic',true,'g6_oat',27,'acceptance_db_only',true)
  );

  if v_first->>'status'<>'HANDOFF_PILOT_POLICY_APPROVED'
     or coalesce((v_first->>'idempotent_replay')::boolean,true) then
    raise exception 'G6 OAT 027: first handoff pilot policy create failed: %',v_first;
  end if;

  if v_replay->>'status'<>'HANDOFF_PILOT_POLICY_APPROVED'
     or not coalesce((v_replay->>'idempotent_replay')::boolean,false)
     or v_replay->>'handoff_pilot_policy_id'<>v_first->>'handoff_pilot_policy_id' then
    raise exception 'G6 OAT 027: active exact replay failed: first %, replay %',v_first,v_replay;
  end if;

  begin
    perform public.growth_g6_record_handoff_pilot_policy(
      v_org,v_bu,v_jur,2,v_user,
      'G6-OAT-027-HANDOFF','Idempotency regression',v_until,
      'G6-OAT-027-HANDOFF',
      jsonb_build_object('synthetic',true,'g6_oat',27,'acceptance_db_only',true)
    );
  exception when unique_violation then
    v_collision_blocked := true;
  end;

  if not v_collision_blocked then
    raise exception 'G6 OAT 027: changed-payload idempotency collision was not blocked';
  end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in (
      'growth_outreach_enabled',
      'growth_auto_followup_enabled',
      'growth_provider_execution_enabled',
      'growth_serviceos_handoff_enabled'
    ) and enabled=true
  ) then
    raise exception 'G6 OAT 027 mutated a protected execution gate';
  end if;
end $$;

rollback;

-- Post-rollback proof.
select
  (select count(*) from growth.handoff_pilot_policy where idempotency_key like 'G6-OAT-027-%') as persisted_handoff_policies,
  (select count(*) from growth.commissioning_evidence where idempotency_key like 'G6-OAT-027-%') as persisted_evidence,
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_auto_followup_enabled') as auto_followup_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_execution_enabled,
  (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as serviceos_handoff_enabled;