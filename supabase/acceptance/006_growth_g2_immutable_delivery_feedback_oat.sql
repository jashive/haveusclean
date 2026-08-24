-- Growth Layer G2 immutable delivery-feedback acceptance OAT.
-- SYNTHETIC / NON-PRODUCTION / ROLLBACK ONLY. No provider API or real send.
begin;
do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_on_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_on_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_az_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_az_jur uuid := '7288ca65-5d0f-4e21-a200-1d47cf527e29';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_sender uuid; v_prospect uuid:=gen_random_uuid(); v_contact uuid:=gen_random_uuid();
  v_basis uuid; v_approval uuid; v_attempt uuid; v_submitted uuid; v_delivered uuid; v_complaint uuid; v_health uuid; v_ready jsonb;
  v_collision boolean:=false; v_cross_scope boolean:=false; v_immutable boolean:=false; v_generic_bypass boolean:=false;
  v_same uuid;
begin
  v_sender := public.growth_g2_register_sender_identity(v_org,v_on_bu,v_on_jur,'g2-feedback-sender@example.invalid','Synthetic Feedback Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_sender,'approved',v_reviewer,now()+interval '30 days','synthetic immutable-feedback OAT');
  perform public.growth_g2_record_sender_auth_evidence(v_sender,'pass','pass','pass','synthetic_oat','G2-FEEDBACK-AUTH',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  v_health := public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '24 hours',now());
  select public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-feedback-sender@example.invalid') into v_ready;
  if not (v_ready->>'ready')::boolean then raise exception 'G2 feedback OAT failed: zero-history derived health not ready %',v_ready; end if;

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(v_prospect,v_org,v_on_bu,v_on_jur,'G2-FEEDBACK-OAT-ON','review_ready','synthetic_oat','Toronto','CA','ON','G2 Feedback OAT Company','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,buyer_title,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(v_contact,v_prospect,v_org,v_on_bu,v_on_jur,'Synthetic','Feedback','Office Manager','g2-feedback-target@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'not_for_outreach',true),'accepted');
  v_basis := public.growth_g2_record_legal_basis(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','G2-FEEDBACK-CASL',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_basis,'accepted',v_reviewer,'synthetic OAT');
  v_approval := public.growth_g2_create_approval_request(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_basis,'Synthetic feedback subject','Synthetic feedback body','g2-feedback-sender@example.invalid','G2-FEEDBACK-OAT-APPROVAL',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_approval,'approved',v_reviewer,true,true,now()+interval '24 hours','synthetic OAT');

  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_attempt := public.growth_g2_create_non_sending_attempt(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_approval);
  if not exists(select 1 from growth.outreach_attempt a where a.id=v_attempt and a.sender_identity_id=v_sender and a.provider is null and a.provider_message_id is null and a.submitted_at is null) then raise exception 'G2 feedback OAT failed: sender identity not bound to attempt'; end if;

  begin
    perform public.growth_g2_ingest_delivery_event(v_org,v_az_bu,v_az_jur,v_attempt,'synthetic_provider','MSG-001','EVT-CROSS','submitted',now(),jsonb_build_object('synthetic',true));
  exception when others then
    if position('outside authorized scope' in sqlerrm)>0 then v_cross_scope:=true; else raise; end if;
  end;
  if not v_cross_scope then raise exception 'G2 feedback OAT failed: cross-scope provider event accepted'; end if;

  v_submitted := public.growth_g2_ingest_delivery_event(v_org,v_on_bu,v_on_jur,v_attempt,'synthetic_provider','MSG-001','EVT-SUB-001','submitted',now()-interval '3 minutes',jsonb_build_object('synthetic',true));
  v_same := public.growth_g2_ingest_delivery_event(v_org,v_on_bu,v_on_jur,v_attempt,'synthetic_provider','MSG-001','EVT-SUB-001','submitted',now()-interval '3 minutes',jsonb_build_object('synthetic',true,'repeat',true));
  if v_same<>v_submitted then raise exception 'G2 feedback OAT failed: idempotent submitted event duplicated'; end if;
  if not exists(select 1 from growth.outreach_attempt a where a.id=v_attempt and a.provider='synthetic_provider' and a.provider_message_id='MSG-001' and a.attempt_status='submitted' and a.submitted_at is not null) then raise exception 'G2 feedback OAT failed: submitted event did not bind provider/message'; end if;

  begin
    perform public.growth_g2_ingest_delivery_event(v_org,v_on_bu,v_on_jur,v_attempt,'synthetic_provider','MSG-001','EVT-SUB-001','delivered',now()-interval '2 minutes',jsonb_build_object('synthetic',true));
  exception when others then
    if position('provider event id collision' in sqlerrm)>0 then v_collision:=true; else raise; end if;
  end;
  if not v_collision then raise exception 'G2 feedback OAT failed: provider event collision not rejected'; end if;

  v_delivered := public.growth_g2_ingest_delivery_event(v_org,v_on_bu,v_on_jur,v_attempt,'synthetic_provider','MSG-001','EVT-DEL-001','delivered',now()-interval '2 minutes',jsonb_build_object('synthetic',true));
  if not exists(select 1 from growth.outreach_attempt a where a.id=v_attempt and a.attempt_status='delivered') then raise exception 'G2 feedback OAT failed: delivered transition missing'; end if;

  begin
    perform public.growth_g2_record_event(v_org,v_on_bu,v_on_jur,v_prospect,v_contact,v_attempt,'email','bounce','BYPASS',now(),jsonb_build_object('synthetic',true));
  exception when others then
    if position('immutable provider boundary' in sqlerrm)>0 then v_generic_bypass:=true; else raise; end if;
  end;
  if not v_generic_bypass then raise exception 'G2 feedback OAT failed: generic delivery-event bypass remained open'; end if;

  begin
    update growth.outreach_event set payload=payload||jsonb_build_object('tampered',true) where id=v_delivered;
  exception when others then
    if position('outreach events are immutable' in sqlerrm)>0 then v_immutable:=true; else raise; end if;
  end;
  if not v_immutable then raise exception 'G2 feedback OAT failed: outreach event mutation succeeded'; end if;

  v_health := public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '1 day',now()+interval '1 second');
  if not exists(select 1 from growth.sender_health_snapshot h where h.id=v_health and h.source='derived_outreach_events' and h.submitted_count=1 and h.delivered_count=1 and h.hard_bounce_count=0 and h.complaint_count=0 and h.health_status='healthy') then raise exception 'G2 feedback OAT failed: healthy event-derived metrics incorrect'; end if;

  v_complaint := public.growth_g2_ingest_delivery_event(v_org,v_on_bu,v_on_jur,v_attempt,'synthetic_provider','MSG-001','EVT-CMP-001','complaint',now()-interval '1 minute',jsonb_build_object('synthetic',true));
  if not exists(select 1 from growth.suppression s where s.prospect_id=v_prospect and s.reason='complaint' and s.active=true) then raise exception 'G2 feedback OAT failed: complaint suppression missing'; end if;
  v_health := public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '1 day',now()+interval '2 seconds');
  if not exists(select 1 from growth.sender_health_snapshot h where h.id=v_health and h.submitted_count=1 and h.delivered_count=1 and h.complaint_count=1 and h.health_status='blocked') then raise exception 'G2 feedback OAT failed: complaint-derived health not blocked'; end if;
  select public.growth_g2_evaluate_sender_readiness(v_org,v_on_bu,v_on_jur,'g2-feedback-sender@example.invalid') into v_ready;
  if (v_ready->>'ready')::boolean or not (v_ready->'blocking_reasons' ? 'sender_health_not_healthy') then raise exception 'G2 feedback OAT failed: blocked derived health did not fail sender readiness %',v_ready; end if;
end $$;
rollback;
select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select count(*) from growth.sender_identity where email_address='g2-feedback-sender@example.invalid') as persisted_senders,
  (select count(*) from growth.prospect where external_prospect_key='G2-FEEDBACK-OAT-ON') as persisted_prospects,
  (select count(*) from growth.outreach_event where provider='synthetic_provider') as persisted_provider_events,
  (select count(*) from growth.sender_health_snapshot where source='derived_outreach_events' and sender_identity_id in (select id from growth.sender_identity where email_address='g2-feedback-sender@example.invalid')) as persisted_health;
