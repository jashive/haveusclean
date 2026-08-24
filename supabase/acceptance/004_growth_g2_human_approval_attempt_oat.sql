-- Growth Layer G2 human-approval + non-sending attempt OAT.
-- NON-PRODUCTION / SYNTHETIC / ROLLBACK ONLY.
-- Proves ON/AZ approval lifecycle, gate-off fail-closed behavior, suppression, reply, cooldown, frequency cap, and zero persistence.

begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_on_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_on_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_az_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_az_jur uuid := '7288ca65-5d0f-4e21-a200-1d47cf527e29';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p_on uuid := gen_random_uuid(); c_on uuid := gen_random_uuid(); b_on uuid; a_on uuid; t_on uuid;
  p_az uuid := gen_random_uuid(); c_az uuid := gen_random_uuid(); b_az uuid; a_az uuid;
  p_reply uuid := gen_random_uuid(); c_reply uuid := gen_random_uuid(); b_reply uuid; a_reply uuid;
  p_freq uuid := gen_random_uuid(); c_freq uuid := gen_random_uuid(); b_freq uuid; a_freq uuid;
  a_hist uuid;
  v_blocked boolean;
  i int;
begin
  -- Ontario positive-control record.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p_on,v_org,v_on_bu,v_on_jur,'G2-OAT-APPROVAL-ON','review_ready','synthetic_oat','Toronto','CA','ON','Synthetic ON Approval','office','verified','[]','[]',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c_on,p_on,v_org,v_on_bu,v_on_jur,'g2-on-approval@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  b_on := public.growth_g2_record_legal_basis(v_org,v_on_bu,v_on_jur,p_on,c_on,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','ON-BASIS',jsonb_build_object('synthetic',true),now()+interval '90 days');
  perform public.growth_g2_review_legal_basis(v_org,v_on_bu,v_on_jur,p_on,c_on,b_on,'accepted',v_reviewer,'synthetic OAT acceptance');
  a_on := public.growth_g2_create_approval_request(v_org,v_on_bu,v_on_jur,p_on,c_on,b_on,'Synthetic subject','Synthetic body with unsubscribe placeholder','sales@example.invalid','G2-OAT-ON-APPROVAL',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_on_bu,v_on_jur,p_on,c_on,a_on,'approved',v_reviewer,true,true,now()+interval '24 hours','synthetic OAT approval');

  -- Gate OFF must block even a fully approved attempt.
  v_blocked := false;
  begin
    perform public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,p_on,c_on,a_on);
  exception when others then
    if position('outreach gate disabled' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'G2 OAT failed: gate-off attempt was allowed'; end if;

  -- Transaction-local gate ON only to prove the remaining guarded path, then rollback restores OFF.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  t_on := public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,p_on,c_on,a_on);
  if t_on is null then raise exception 'G2 OAT failed: approved ON non-sending attempt not created'; end if;
  if exists(select 1 from growth.outreach_attempt where id=t_on and (provider is not null or provider_message_id is not null or submitted_at is not null or attempt_status<>'created' or coalesce((metadata->>'non_sending')::boolean,false) is not true)) then
    raise exception 'G2 OAT failed: non-sending attempt carried sender/submission state';
  end if;

  -- Cooldown: second approved request for same ON contact must block inside 72 hours.
  a_hist := public.growth_g2_create_approval_request(v_org,v_on_bu,v_on_jur,p_on,c_on,b_on,'Second synthetic subject','Second synthetic body','sales@example.invalid','G2-OAT-ON-COOLDOWN',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_on_bu,v_on_jur,p_on,c_on,a_hist,'approved',v_reviewer,true,true,now()+interval '24 hours','cooldown test');
  v_blocked:=false;
  begin perform public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,p_on,c_on,a_hist);
  exception when others then if position('cooldown active' in sqlerrm)>0 then v_blocked:=true; else raise; end if; end;
  if not v_blocked then raise exception 'G2 OAT failed: cooldown did not block'; end if;

  -- Arizona suppression block.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p_az,v_org,v_az_bu,v_az_jur,'G2-OAT-APPROVAL-AZ','review_ready','synthetic_oat','Phoenix','US','AZ','Synthetic AZ Suppression','office','verified','[]','[]',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c_az,p_az,v_org,v_az_bu,v_az_jur,'g2-az-suppression@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  b_az := public.growth_g2_record_legal_basis(v_org,v_az_bu,v_az_jur,p_az,c_az,'email','can_spam_commercial_email','synthetic_oat','AZ-BASIS',jsonb_build_object('synthetic',true),now()+interval '90 days');
  perform public.growth_g2_review_legal_basis(v_org,v_az_bu,v_az_jur,p_az,c_az,b_az,'accepted',v_reviewer,'synthetic AZ basis');
  a_az := public.growth_g2_create_approval_request(v_org,v_az_bu,v_az_jur,p_az,c_az,b_az,'AZ synthetic subject','AZ synthetic body','sales@example.invalid','G2-OAT-AZ-SUPPRESSION',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_az_bu,v_az_jur,p_az,c_az,a_az,'approved',v_reviewer,true,true,now()+interval '24 hours','AZ suppression test');
  insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
  values(v_org,v_az_jur,p_az,'email','email','g2-az-suppression@example.invalid','manual_suppression','synthetic_oat',true,jsonb_build_object('synthetic',true));
  v_blocked:=false;
  begin perform public.growth_g2_create_non_sending_attempt(v_org,v_az_bu,v_az_jur,p_az,c_az,a_az);
  exception when others then if position('active suppression blocks outreach' in sqlerrm)>0 then v_blocked:=true; else raise; end if; end;
  if not v_blocked then raise exception 'G2 OAT failed: active suppression did not block'; end if;

  -- Arizona reply stops sequencing without permanent suppression requirement.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p_reply,v_org,v_az_bu,v_az_jur,'G2-OAT-REPLY-AZ','review_ready','synthetic_oat','Phoenix','US','AZ','Synthetic AZ Reply','office','verified','[]','[]',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c_reply,p_reply,v_org,v_az_bu,v_az_jur,'g2-az-reply@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  b_reply := public.growth_g2_record_legal_basis(v_org,v_az_bu,v_az_jur,p_reply,c_reply,'email','can_spam_commercial_email','synthetic_oat','AZ-REPLY-BASIS',jsonb_build_object('synthetic',true),now()+interval '90 days');
  perform public.growth_g2_review_legal_basis(v_org,v_az_bu,v_az_jur,p_reply,c_reply,b_reply,'accepted',v_reviewer,'synthetic reply basis');
  a_reply := public.growth_g2_create_approval_request(v_org,v_az_bu,v_az_jur,p_reply,c_reply,b_reply,'Reply synthetic subject','Reply synthetic body','sales@example.invalid','G2-OAT-AZ-REPLY',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_az_bu,v_az_jur,p_reply,c_reply,a_reply,'approved',v_reviewer,true,true,now()+interval '24 hours','reply stop test');
  perform public.growth_g2_record_event(v_org,v_az_bu,v_az_jur,p_reply,c_reply,null,'email','reply','G2-OAT-AZ-REPLY-EVENT',now(),jsonb_build_object('synthetic',true));
  v_blocked:=false;
  begin perform public.growth_g2_create_non_sending_attempt(v_org,v_az_bu,v_az_jur,p_reply,c_reply,a_reply);
  exception when others then if position('reply received; sequencing stopped' in sqlerrm)>0 then v_blocked:=true; else raise; end if; end;
  if not v_blocked then raise exception 'G2 OAT failed: reply did not stop sequencing'; end if;

  -- Frequency cap: 3 prior attempts within 30 days but outside 72-hour cooldown.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p_freq,v_org,v_az_bu,v_az_jur,'G2-OAT-FREQ-AZ','review_ready','synthetic_oat','Phoenix','US','AZ','Synthetic AZ Frequency','office','verified','[]','[]',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c_freq,p_freq,v_org,v_az_bu,v_az_jur,'g2-az-frequency@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  b_freq := public.growth_g2_record_legal_basis(v_org,v_az_bu,v_az_jur,p_freq,c_freq,'email','can_spam_commercial_email','synthetic_oat','AZ-FREQ-BASIS',jsonb_build_object('synthetic',true),now()+interval '90 days');
  perform public.growth_g2_review_legal_basis(v_org,v_az_bu,v_az_jur,p_freq,c_freq,b_freq,'accepted',v_reviewer,'synthetic frequency basis');
  for i in 1..3 loop
    a_hist := public.growth_g2_create_approval_request(v_org,v_az_bu,v_az_jur,p_freq,c_freq,b_freq,'Historical subject '||i,'Historical body '||i,'sales@example.invalid','G2-OAT-AZ-HIST-'||i,jsonb_build_object('synthetic',true));
    perform public.growth_g2_review_outreach_approval(v_org,v_az_bu,v_az_jur,p_freq,c_freq,a_hist,'approved',v_reviewer,true,true,now()+interval '24 hours','historical frequency test');
    insert into growth.outreach_attempt(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_approval_id,channel,attempt_status,created_at,metadata)
    values(v_org,v_az_bu,v_az_jur,p_freq,c_freq,a_hist,'email','delivered',now()-((i*5)||' days')::interval,jsonb_build_object('synthetic',true,'historical',true));
  end loop;
  a_freq := public.growth_g2_create_approval_request(v_org,v_az_bu,v_az_jur,p_freq,c_freq,b_freq,'Fourth synthetic subject','Fourth synthetic body','sales@example.invalid','G2-OAT-AZ-FREQ-4',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_az_bu,v_az_jur,p_freq,c_freq,a_freq,'approved',v_reviewer,true,true,now()+interval '24 hours','frequency cap test');
  v_blocked:=false;
  begin perform public.growth_g2_create_non_sending_attempt(v_org,v_az_bu,v_az_jur,p_freq,c_freq,a_freq);
  exception when others then if position('frequency cap exceeded' in sqlerrm)>0 then v_blocked:=true; else raise; end if; end;
  if not v_blocked then raise exception 'G2 OAT failed: frequency cap did not block'; end if;
end $$;

rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select count(*) from growth.prospect where external_prospect_key like 'G2-OAT-%') as persisted_oat_prospects,
  (select count(*) from growth.outreach_approval where idempotency_key like 'G2-OAT-%') as persisted_oat_approvals,
  (select count(*) from growth.outreach_event where provider_event_id like 'G2-OAT-%') as persisted_oat_events;
