-- G6 review hardening: quota continuity across replacement staged authorizations
-- and handoff-pilot policy idempotent replay ordering. No feature gate is enabled.

create index if not exists pilot_send_policy_quota_idx
  on growth.pilot_send_reservation(pilot_policy_id, quota_day, created_at);

create or replace function public.growth_g6_reserve_pilot_send_for_provider_lease(
  p_authorization_id uuid,
  p_outreach_submission_reservation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_a growth.staged_activation_authorization%rowtype;
  v_p growth.pilot_policy%rowtype;
  v_r growth.outreach_submission_reservation%rowtype;
  v_sender growth.sender_identity%rowtype;
  v_eval jsonb;
  v_existing growth.pilot_send_reservation%rowtype;
  v_tz text;
  v_day date;
  v_daily int;
  v_total int;
  v_id uuid;
begin
  select * into v_a
  from growth.staged_activation_authorization
  where id=p_authorization_id
  for update;
  if v_a.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_not_found'),'policy_version','g6-pilot-quota-v1');
  end if;

  v_eval:=public.growth_g6_evaluate_staged_activation_authorization(v_a.id);
  if v_eval->>'status'<>'AUTHORIZED_FOR_STAGED_ACTIVATION' then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',v_eval->'blocking_reasons','policy_version','g6-pilot-quota-v1');
  end if;

  -- Serialize quota decisions at the shared pilot-policy boundary so replacing
  -- a staged authorization cannot reset the policy's daily or total counters.
  select * into v_p
  from growth.pilot_policy
  where id=v_a.pilot_policy_id
  for update;
  if v_p.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_policy_not_found'),'policy_version','g6-pilot-quota-v1');
  end if;

  select * into v_r
  from growth.outreach_submission_reservation
  where id=p_outreach_submission_reservation_id;
  if v_r.id is null
     or v_r.organization_id<>v_a.organization_id
     or v_r.business_unit_id<>v_a.business_unit_id
     or v_r.jurisdiction_id<>v_a.jurisdiction_id
     or v_r.provider_code<>v_a.provider_code
     or v_r.reservation_status<>'reserved'
     or coalesce((v_r.metadata->>'non_sending')::boolean,false) is not true then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('submission_reservation_context_mismatch'),'policy_version','g6-pilot-quota-v1');
  end if;

  select * into v_sender from growth.sender_identity where id=v_r.sender_identity_id;
  if v_sender.id is null or v_sender.email_address<>v_a.sender_email then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_sender_mismatch'),'policy_version','g6-pilot-quota-v1');
  end if;

  select * into v_existing
  from growth.pilot_send_reservation
  where outreach_submission_reservation_id=v_r.id;
  if found then
    if v_existing.staged_activation_authorization_id=v_a.id then
      return jsonb_build_object('status','PILOT_SEND_RESERVED','pilot_send_reservation_id',v_existing.id,'idempotent_replay',true,'quota_day',v_existing.quota_day);
    end if;
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_already_bound_to_other_authorization'),'policy_version','g6-pilot-quota-v1');
  end if;

  select timezone into v_tz from public.jurisdiction where id=v_a.jurisdiction_id;
  if v_tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_tz) then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('invalid_quota_timezone'),'policy_version','g6-pilot-quota-v1');
  end if;
  v_day:=(now() at time zone v_tz)::date;

  select count(*) into v_total
  from growth.pilot_send_reservation
  where pilot_policy_id=v_p.id;

  select count(*) into v_daily
  from growth.pilot_send_reservation
  where pilot_policy_id=v_p.id and quota_day=v_day;

  if v_total>=v_p.total_send_cap then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_total_send_cap_reached'),'policy_version','g6-pilot-quota-v1');
  end if;
  if v_daily>=v_p.daily_send_cap then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_daily_send_cap_reached'),'policy_version','g6-pilot-quota-v1');
  end if;

  insert into growth.pilot_send_reservation(
    organization_id,business_unit_id,jurisdiction_id,
    staged_activation_authorization_id,pilot_policy_id,
    outreach_submission_reservation_id,quota_timezone,quota_day
  ) values(
    v_a.organization_id,v_a.business_unit_id,v_a.jurisdiction_id,
    v_a.id,v_a.pilot_policy_id,v_r.id,v_tz,v_day
  ) returning id into v_id;

  return jsonb_build_object(
    'status','PILOT_SEND_RESERVED',
    'pilot_send_reservation_id',v_id,
    'idempotent_replay',false,
    'quota_day',v_day,
    'quota_timezone',v_tz,
    'daily_reserved_after',v_daily+1,
    'total_reserved_after',v_total+1,
    'daily_send_cap',v_p.daily_send_cap,
    'total_send_cap',v_p.total_send_cap
  );
end $$;

create or replace function public.growth_g6_record_handoff_pilot_policy(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_handoff_cap integer,
  p_approved_by_app_user_id uuid,
  p_approval_reference text,
  p_approval_reason text,
  p_valid_until timestamptz,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ev jsonb;
  v_hash text;
  v_existing growth.handoff_pilot_policy%rowtype;
  v_id uuid;
begin
  if p_handoff_cap<1 or p_handoff_cap>5 then
    raise exception 'handoff cap must be between 1 and 5' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_user u where u.id=p_approved_by_app_user_id and u.status='active') then
    raise exception 'active human approver required' using errcode='22023';
  end if;

  -- Preserve exact replay behavior while the original policy is still current.
  -- The original immutable evidence snapshot participates in the hash so later
  -- evidence drift cannot make an exact retry look like a changed payload.
  select * into v_existing
  from growth.handoff_pilot_policy p
  where p.organization_id=p_organization_id
    and p.business_unit_id=p_business_unit_id
    and p.jurisdiction_id=p_jurisdiction_id
    and p.idempotency_key=p_idempotency_key;

  if found then
    v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'organization_id',p_organization_id,
      'business_unit_id',p_business_unit_id,
      'jurisdiction_id',p_jurisdiction_id,
      'handoff_cap',p_handoff_cap,
      'evidence_snapshot',v_existing.evidence_snapshot,
      'approved_by',p_approved_by_app_user_id,
      'approval_reference',btrim(p_approval_reference),
      'approval_reason',btrim(p_approval_reason),
      'valid_until',p_valid_until,
      'metadata',coalesce(p_metadata,'{}'::jsonb)
    )::text,'UTF8'),'sha256'),'hex');
    if v_existing.request_hash<>v_hash then
      raise exception 'idempotency collision' using errcode='23505';
    end if;
    return jsonb_build_object(
      'status','HANDOFF_PILOT_POLICY_APPROVED',
      'handoff_pilot_policy_id',v_existing.id,
      'idempotent_replay',true,
      'gate_mutation_performed',false
    );
  end if;

  if exists(select 1 from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled' and g.enabled=true) then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_gate_must_be_off_for_policy_approval'),'policy_version','g6-handoff-pilot-v1');
  end if;
  if exists(
    select 1 from growth.handoff_pilot_policy p
    where p.organization_id=p_organization_id
      and p.business_unit_id=p_business_unit_id
      and p.jurisdiction_id=p_jurisdiction_id
      and p.valid_until>now()
      and not exists(select 1 from growth.handoff_pilot_policy_revocation r where r.handoff_pilot_policy_id=p.id)
  ) then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('current_handoff_pilot_policy_already_exists'),'policy_version','g6-handoff-pilot-v1');
  end if;

  v_ev:=public.growth_g6_handoff_pilot_evidence_snapshot(p_organization_id,p_business_unit_id,p_jurisdiction_id);
  if v_ev->>'status'<>'HANDOFF_EVIDENCE_READY' then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',v_ev->'blocking_reasons','policy_version','g6-handoff-pilot-v1');
  end if;
  if p_valid_until<=now() or p_valid_until>now()+interval '24 hours' then
    raise exception 'invalid handoff pilot validity window' using errcode='22023';
  end if;

  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,
    'business_unit_id',p_business_unit_id,
    'jurisdiction_id',p_jurisdiction_id,
    'handoff_cap',p_handoff_cap,
    'evidence_snapshot',v_ev->'evidence_snapshot',
    'approved_by',p_approved_by_app_user_id,
    'approval_reference',btrim(p_approval_reference),
    'approval_reason',btrim(p_approval_reason),
    'valid_until',p_valid_until,
    'metadata',coalesce(p_metadata,'{}'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');

  insert into growth.handoff_pilot_policy(
    organization_id,business_unit_id,jurisdiction_id,handoff_cap,evidence_snapshot,
    approved_by_app_user_id,approval_reference,approval_reason,valid_until,
    idempotency_key,request_hash,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_handoff_cap,v_ev->'evidence_snapshot',
    p_approved_by_app_user_id,btrim(p_approval_reference),btrim(p_approval_reason),p_valid_until,
    p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object(
    'status','HANDOFF_PILOT_POLICY_APPROVED',
    'handoff_pilot_policy_id',v_id,
    'idempotent_replay',false,
    'gate_mutation_performed',false,
    'handoff_cap',p_handoff_cap
  );
end $$;