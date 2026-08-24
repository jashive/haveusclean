-- Growth Layer G2 provider-adapter contract + final execution preflight acceptance OAT.
-- SYNTHETIC / NON-PRODUCTION / ROLLBACK ONLY. No provider credentials, provider API, or real send.
begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_wrong_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_sender uuid;
  v_prospect uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_basis uuid;
  v_approval uuid;
  v_attempt uuid;
  v_contract_bad uuid;
  v_contract_good uuid;
  v_result jsonb;
  v_result2 jsonb;
  v_gate_blocked boolean := false;
  v_scope_blocked boolean := false;
  v_immutable_blocked boolean := false;
begin
  begin
    perform public.growth_g2_register_provider_adapter_contract(v_org,v_wrong_bu,v_jur,'synthetic-provider','contract-v1',true,true,true,true,v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true));
  exception when others then
    if position('provider contract scope mismatch' in sqlerrm)>0 then v_scope_blocked:=true; else raise; end if;
  end;
  if not v_scope_blocked then raise exception 'G2 preflight OAT failed: cross-scope provider contract accepted'; end if;

  v_sender := public.growth_g2_register_sender_identity(v_org,v_bu,v_jur,'g2-preflight-sender@example.invalid','Synthetic Preflight Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_sender,'approved',v_reviewer,now()+interval '30 days','synthetic preflight OAT');
  perform public.growth_g2_record_sender_auth_evidence(v_sender,'pass','pass','pass','synthetic_oat','PREFLIGHT-AUTH',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  perform public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '24 hours',now());

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(v_prospect,v_org,v_bu,v_jur,'G2-PREFLIGHT-OAT-ON','review_ready','synthetic_oat','Toronto','CA','ON','G2 Preflight Synthetic Company','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'not_for_outreach',true));

  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,buyer_title,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(v_contact,v_prospect,v_org,v_bu,v_jur,'Synthetic','Preflight','Office Manager','g2-preflight-target@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'not_for_outreach',true),'accepted');

  v_basis := public.growth_g2_record_legal_basis(v_org,v_bu,v_jur,v_prospect,v_contact,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','G2-PREFLIGHT-CASL',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_bu,v_jur,v_prospect,v_contact,v_basis,'accepted',v_reviewer,'synthetic preflight OAT');
  v_approval := public.growth_g2_create_approval_request(v_org,v_bu,v_jur,v_prospect,v_contact,v_basis,'Synthetic approved subject','Synthetic approved body','g2-preflight-sender@example.invalid','G2-PREFLIGHT-APPROVAL',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_bu,v_jur,v_prospect,v_contact,v_approval,'approved',v_reviewer,true,true,now()+interval '24 hours','synthetic preflight OAT');

  begin
    perform public.growth_g2_create_non_sending_attempt(v_org,v_bu,v_jur,v_prospect,v_contact,v_approval);
  exception when others then
    if position('outreach gate disabled' in sqlerrm)>0 then v_gate_blocked:=true; else raise; end if;
  end;
  if not v_gate_blocked then raise exception 'G2 preflight OAT failed: persistent outreach gate OFF did not block attempt creation'; end if;

  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_attempt := public.growth_g2_create_non_sending_attempt(v_org,v_bu,v_jur,v_prospect,v_contact,v_approval);
  if v_attempt is null then raise exception 'G2 preflight OAT failed: non-sending attempt not created'; end if;

  v_contract_bad := public.growth_g2_register_provider_adapter_contract(v_org,v_bu,v_jur,'synthetic-incomplete','contract-v1',true,true,false,true,v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'contract_only',true));
  v_result := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt,'synthetic-incomplete');
  if v_result->>'status'<>'BLOCKED' or not (v_result->'blocking_reasons' ? 'provider_delivery_events_unsupported') then raise exception 'G2 preflight OAT failed: incomplete provider capability contract not blocked %',v_result; end if;

  v_contract_good := public.growth_g2_register_provider_adapter_contract(v_org,v_bu,v_jur,'synthetic-provider','contract-v1',true,true,true,true,v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'contract_only',true));

  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_outreach_enabled';
  v_result := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt,'synthetic-provider');
  if v_result->>'status'<>'BLOCKED' or not (v_result->'blocking_reasons' ? 'outreach_gate_disabled') then raise exception 'G2 preflight OAT failed: preflight ignored outreach gate %',v_result; end if;

  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_result := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt,'synthetic-provider');
  if v_result->>'status'<>'READY_EXCEPT_PROVIDER' then raise exception 'G2 preflight OAT failed: qualified preflight not READY_EXCEPT_PROVIDER %',v_result; end if;
  if v_result->>'provider_credentials_state'<>'absent' then raise exception 'G2 preflight OAT failed: provider credentials unexpectedly present'; end if;
  if length(v_result->>'submission_key')<>64 or length(v_result->>'sender_hash')<>64 or length(v_result->>'recipient_hash')<>64 or length(v_result->>'content_hash')<>64 or length(v_result->>'envelope_hash')<>64 then raise exception 'G2 preflight OAT failed: deterministic hashes malformed %',v_result; end if;

  v_result2 := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt,'synthetic-provider');
  if v_result2->>'status'<>'READY_EXCEPT_PROVIDER' or v_result2->>'reservation_id'<>v_result->>'reservation_id' or v_result2->>'submission_key'<>v_result->>'submission_key' or v_result2->>'envelope_hash'<>v_result->>'envelope_hash' then raise exception 'G2 preflight OAT failed: idempotent replay changed reservation % / %',v_result,v_result2; end if;

  if not exists(select 1 from growth.outreach_submission_reservation r where r.id=(v_result->>'reservation_id')::uuid and r.outreach_attempt_id=v_attempt and r.sender_identity_id=v_sender and r.reservation_status='reserved' and r.metadata->>'non_sending'='true' and r.metadata->>'credentials_state'='absent') then raise exception 'G2 preflight OAT failed: reservation linkage missing'; end if;
  if not exists(select 1 from growth.outreach_attempt a where a.id=v_attempt and a.attempt_status='created' and a.provider is null and a.provider_message_id is null and a.submitted_at is null and a.metadata->>'non_sending'='true') then raise exception 'G2 preflight OAT failed: reservation crossed send boundary'; end if;
  if exists(select 1 from growth.outreach_event e where e.outreach_attempt_id=v_attempt and e.event_type='submitted') then raise exception 'G2 preflight OAT failed: preflight created submitted event'; end if;

  begin
    update growth.outreach_submission_reservation set provider_code='tampered-provider' where id=(v_result->>'reservation_id')::uuid;
  exception when others then
    if position('submission reservations are immutable' in sqlerrm)>0 then v_immutable_blocked:=true; else raise; end if;
  end;
  if not v_immutable_blocked then raise exception 'G2 preflight OAT failed: reservation mutation was allowed'; end if;
end $$;

rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select count(*) from growth.provider_adapter_contract where metadata->>'synthetic'='true') as persisted_provider_contracts,
  (select count(*) from growth.outreach_submission_reservation where metadata->>'non_sending'='true') as persisted_reservations,
  (select count(*) from growth.prospect where external_prospect_key='G2-PREFLIGHT-OAT-ON') as persisted_prospects,
  (select count(*) from growth.sender_identity where email_address='g2-preflight-sender@example.invalid') as persisted_senders;
