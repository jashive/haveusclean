-- Growth Layer G2 sender identity + deliverability acceptance OAT.
-- SYNTHETIC / NON-PRODUCTION / ROLLBACK ONLY. No DNS, provider API, or real send.
begin;
do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_on_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_on_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_az_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_az_jur uuid := '7288ca65-5d0f-4e21-a200-1d47cf527e29';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_on_sender uuid; v_az_sender uuid; v_stale_sender uuid; v_readiness jsonb;
  v_cross_scope_rejected boolean := false; v_gate_blocked boolean := false;
  v_prospect uuid := gen_random_uuid(); v_contact uuid := gen_random_uuid();
  v_basis uuid; v_approval uuid; v_attempt uuid;
begin
  begin
    perform public.growth_g2_register_sender_identity(v_org,v_on_bu,v_az_jur,'cross-scope@example.invalid','Synthetic Cross Scope',jsonb_build_object('synthetic',true));
  exception when others then
    if position('sender scope mismatch' in sqlerrm)>0 then v_cross_scope_rejected:=true; else raise; end if;
  end;
  if not v_cross_scope_rejected then raise exception 'G2 sender OAT failed: cross-scope sender accepted'; end if;

  v_on_sender := public.growth_g2_register_sender_identity(v_org,v_on_bu,v_on_jur,'g2-on-sender@example.invalid','Synthetic Ontario Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_on_sender,'approved',v_reviewer,now()+interval '30 days','synthetic OAT');
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-on-sender@example.invalid');
  if (v_readiness->>'ready')::boolean or not (v_readiness->'blocking_reasons' ? 'sender_auth_evidence_missing') or not (v_readiness->'blocking_reasons' ? 'sender_health_missing') then raise exception 'G2 sender OAT failed: missing auth/health did not fail closed %',v_readiness; end if;

  perform public.growth_g2_record_sender_auth_evidence(v_on_sender,'pass','pass','fail','synthetic_oat','AUTH-FAIL',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-on-sender@example.invalid');
  if (v_readiness->>'ready')::boolean or not (v_readiness->'blocking_reasons' ? 'dmarc_not_pass') then raise exception 'G2 sender OAT failed: DMARC fail not blocked %',v_readiness; end if;

  perform public.growth_g2_record_sender_auth_evidence(v_on_sender,'pass','pass','pass','synthetic_oat','AUTH-PASS',now()+interval '1 second',now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  perform public.growth_g2_record_sender_health_snapshot(v_on_sender,now()-interval '24 hours',now(),100,97,3,0,'synthetic_oat',jsonb_build_object('synthetic',true));
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-on-sender@example.invalid');
  if (v_readiness->>'ready')::boolean or not (v_readiness->'blocking_reasons' ? 'sender_health_not_healthy') then raise exception 'G2 sender OAT failed: blocked sender health did not fail closed %',v_readiness; end if;

  perform public.growth_g2_record_sender_health_snapshot(v_on_sender,now()-interval '24 hours',now()+interval '1 second',100,100,0,0,'synthetic_oat',jsonb_build_object('synthetic',true));
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-on-sender@example.invalid');
  if not (v_readiness->>'ready')::boolean then raise exception 'G2 sender OAT failed: healthy Ontario sender not ready %',v_readiness; end if;

  v_az_sender := public.growth_g2_register_sender_identity(v_org,v_az_bu,v_az_jur,'g2-az-sender@example.invalid','Synthetic Arizona Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_az_sender,'approved',v_reviewer,now()+interval '30 days','synthetic OAT');
  perform public.growth_g2_record_sender_auth_evidence(v_az_sender,'pass','pass','pass','synthetic_oat','AZ-AUTH-PASS',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  perform public.growth_g2_record_sender_health_snapshot(v_az_sender,now()-interval '24 hours',now(),1000,999,0,1,'synthetic_oat',jsonb_build_object('synthetic',true));
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_az_bu,v_az_jur,'g2-az-sender@example.invalid');
  if (v_readiness->>'ready')::boolean or not (v_readiness->'blocking_reasons' ? 'sender_health_not_healthy') then raise exception 'G2 sender OAT failed: complaint did not block Arizona sender %',v_readiness; end if;

  v_stale_sender := public.growth_g2_register_sender_identity(v_org,v_az_bu,v_az_jur,'g2-stale-sender@example.invalid','Synthetic Stale Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_stale_sender,'approved',v_reviewer,now()+interval '30 days','synthetic OAT');
  perform public.growth_g2_record_sender_auth_evidence(v_stale_sender,'pass','pass','pass','synthetic_oat','STALE-AUTH',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  insert into growth.sender_health_snapshot(sender_identity_id,window_start,window_end,submitted_count,delivered_count,hard_bounce_count,complaint_count,hard_bounce_rate,complaint_rate,health_status,policy_version,source,payload,recorded_at)
  values(v_stale_sender,now()-interval '4 days',now()-interval '3 days',10,10,0,0,0,0,'healthy','g2-sender-health-2026-08-23','synthetic_oat',jsonb_build_object('synthetic',true),now()-interval '2 days');
  v_readiness := public.growth_g2_evaluate_sender_readiness(v_org,v_az_bu,v_az_jur,'g2-stale-sender@example.invalid');
  if (v_readiness->>'ready')::boolean or not (v_readiness->'blocking_reasons' ? 'sender_health_stale') then raise exception 'G2 sender OAT failed: stale health did not block %',v_readiness; end if;

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(v_prospect,v_org,v_on_bu,v_on_jur,'G2-SENDER-OAT-ON','review_ready','synthetic_oat','Toronto','CA','ON','G2 Sender OAT Company','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,buyer_title,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(v_contact,v_prospect,v_org,v_on_bu,v_on_jur,'Synthetic','Contact','Office Manager','g2-sender-target@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'not_for_outreach',true),'accepted');
  v_basis := public.growth_g2_record_legal_basis(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','CASL-OAT',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_basis,'accepted',v_reviewer,'synthetic OAT');
  v_approval := public.growth_g2_create_approval_request(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_basis,'Synthetic subject','Synthetic body','g2-on-sender@example.invalid','G2-SENDER-OAT-APPROVAL',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_approval,'approved',v_reviewer,true,true,now()+interval '24 hours','synthetic OAT');

  begin
    perform public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_approval);
  exception when others then
    if position('outreach gate disabled' in sqlerrm)>0 then v_gate_blocked:=true; else raise; end if;
  end;
  if not v_gate_blocked then raise exception 'G2 sender OAT failed: persistent outreach gate OFF did not block'; end if;

  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_attempt := public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_approval);
  if v_attempt is null then raise exception 'G2 sender OAT failed: ready non-sending attempt not created'; end if;
  if not exists(select 1 from growth.outreach_attempt a where a.id=v_attempt and a.provider is null and a.provider_message_id is null and a.submitted_at is null and a.metadata->>'non_sending'='true') then raise exception 'G2 sender OAT failed: attempt crossed non-sending boundary'; end if;
end $$;
rollback;
select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select count(*) from growth.sender_identity where email_address like 'g2-%@example.invalid') as persisted_senders,
  (select count(*) from growth.prospect where external_prospect_key='G2-SENDER-OAT-ON') as persisted_prospects,
  (select count(*) from growth.outreach_approval where idempotency_key='G2-SENDER-OAT-APPROVAL') as persisted_approvals;
