begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';

  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; r1 jsonb;
  p2 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); ce2 uuid; r2 jsonb;
  q_count integer;
  blocked boolean;
begin
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values
  (p1,v_org,v_bu,v_jur,'G3-OAT-QUEUE-NURTURE','engaged','synthetic_oat','Toronto','CA','ON','G3 Queue Nurture Synthetic','office','verified','[]','[]',jsonb_build_object('synthetic',true)),
  (p2,v_org,v_bu,v_jur,'G3-OAT-DISQUALIFIED','engaged','synthetic_oat','Toronto','CA','ON','G3 Disqualified Synthetic','office','verified','[]','[]',jsonb_build_object('synthetic',true));

  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values
  (c1,p1,v_org,v_bu,v_jur,'g3-queue-nurture@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted'),
  (c2,p2,v_org,v_bu,v_jur,'g3-disqualified@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');

  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values
  (e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, please send pricing.')),
  (e2,v_org,v_bu,v_jur,p2,c2,'email','reply',now()+interval '1 second',jsonb_build_object('synthetic',true,'reply_text','Yes, I am interested.'));

  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g3-completion-2026-08-24',0.99,jsonb_build_object('synthetic',true));
  ce2:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p2,c2,e2,'positive_interest','deterministic','g3-completion-2026-08-24',0.99,jsonb_build_object('synthetic',true));

  select count(*) into q_count from public.growth_g3_list_qualification_review_queue(v_org,v_bu,100) q where q.prospect_id in (p1,p2);
  if q_count<>2 then raise exception 'G3 completion OAT: expected 2 pending queue rows, got %',q_count; end if;
  if exists(select 1 from public.growth_g3_list_qualification_review_queue(v_org,v_bu,100) q where q.prospect_id in (p1,p2) and (q.requires_human_review<>true or q.serviceos_handoff_authorized<>false)) then
    raise exception 'G3 completion OAT: queue authorization flags invalid';
  end if;

  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic qualification before nurture','G3-OAT-QUEUE-QUAL',jsonb_build_object('synthetic',true));
  if r1->>'state'<>'handoff_candidate' or coalesce((r1->>'serviceos_handoff_authorized')::boolean,true) then raise exception 'G3 completion OAT: qualified boundary invalid %',r1; end if;
  if not exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='draft' and h.handoff_payload->>'g4_required'='true' and h.handoff_payload->>'serviceos_handoff_authorized'='false' and h.serviceos_service_request_id is null and h.serviceos_opportunity_id is null) then
    raise exception 'G3 completion OAT: draft Growth handoff candidate missing';
  end if;

  select count(*) into q_count from public.growth_g3_list_qualification_review_queue(v_org,v_bu,100) q where q.prospect_id=p1;
  if q_count<>0 then raise exception 'G3 completion OAT: reviewed prospect still in queue'; end if;

  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'nurture',false,true,true,v_reviewer,'Synthetic later nurture decision','G3-OAT-QUEUE-NURTURE',jsonb_build_object('synthetic',true));
  if r1->>'state'<>'nurture' then raise exception 'G3 completion OAT: nurture state invalid %',r1; end if;
  if not exists(select 1 from growth.prospect p where p.id=p1 and p.lifecycle_status='nurture') then raise exception 'G3 completion OAT: prospect not nurture'; end if;
  if exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='draft') then raise exception 'G3 completion OAT: stale draft remains after nurture'; end if;
  if not exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='cancelled' and h.handoff_payload->>'cancelled_by'='g3_nurture' and h.handoff_payload->>'serviceos_handoff_authorized'='false') then raise exception 'G3 completion OAT: nurture cancellation evidence missing'; end if;

  blocked:=false;
  begin
    perform public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Illegal reopen after nurture','G3-OAT-QUEUE-REOPEN',jsonb_build_object('synthetic',true));
  exception when others then
    if position('terminal qualification decision cannot be reopened' in sqlerrm)>0 then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'G3 completion OAT: nurture reopened to qualified'; end if;

  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'disqualified',false,true,true,v_reviewer,'Synthetic escalation to disqualified','G3-OAT-QUEUE-DISQUALIFIED',jsonb_build_object('synthetic',true));
  if r1->>'state'<>'disqualified' then raise exception 'G3 completion OAT: disqualified state invalid %',r1; end if;
  if not exists(select 1 from growth.prospect p where p.id=p1 and p.lifecycle_status='disqualified') then raise exception 'G3 completion OAT: prospect not disqualified'; end if;

  blocked:=false;
  begin
    perform public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'nurture',false,true,true,v_reviewer,'Illegal reopen after disqualified','G3-OAT-QUEUE-REOPEN-2',jsonb_build_object('synthetic',true));
  exception when others then
    if position('terminal qualification decision cannot be reopened' in sqlerrm)>0 then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'G3 completion OAT: disqualified reopened to nurture'; end if;

  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'suppressed',false,true,true,v_reviewer,'Synthetic escalation to suppressed','G3-OAT-QUEUE-SUPPRESSED',jsonb_build_object('synthetic',true));
  if r1->>'state'<>'suppressed' then raise exception 'G3 completion OAT: suppressed state invalid %',r1; end if;
  if not exists(select 1 from growth.prospect p where p.id=p1 and p.lifecycle_status='suppressed') then raise exception 'G3 completion OAT: prospect not suppressed'; end if;

  blocked:=false;
  begin
    perform public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Illegal reopen after suppressed','G3-OAT-QUEUE-REOPEN-3',jsonb_build_object('synthetic',true));
  exception when others then
    if position('terminal qualification decision cannot be reopened' in sqlerrm)>0 then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'G3 completion OAT: suppressed reopened to qualified'; end if;

  r2:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p2,c2,e2,ce2,'disqualified',false,true,true,v_reviewer,'Synthetic direct disqualification','G3-OAT-DISQUALIFIED-1',jsonb_build_object('synthetic',true));
  if r2->>'state'<>'disqualified' then raise exception 'G3 completion OAT: direct disqualification invalid %',r2; end if;
  if exists(select 1 from growth.handoff_candidate h where h.prospect_id=p2 and h.status='draft') then raise exception 'G3 completion OAT: disqualified prospect has draft handoff'; end if;

  select count(*) into q_count from public.growth_g3_list_qualification_review_queue(v_org,v_bu,100) q where q.prospect_id in (p1,p2);
  if q_count<>0 then raise exception 'G3 completion OAT: terminal/reviewed prospects remain in queue'; end if;

  if exists(select 1 from growth.handoff_candidate h where h.prospect_id in (p1,p2) and (h.serviceos_service_request_id is not null or h.serviceos_opportunity_id is not null or h.handoff_payload->>'serviceos_handoff_authorized'='true')) then
    raise exception 'G3 completion OAT: ServiceOS handoff authority leaked';
  end if;
end $$;

rollback;

select
 (select count(*) from growth.prospect where external_prospect_key in ('G3-OAT-QUEUE-NURTURE','G3-OAT-DISQUALIFIED')) as persisted_prospects,
 (select count(*) from growth.reply_classification_evidence where classifier_version='g3-completion-2026-08-24' and evidence_payload->>'synthetic'='true') as persisted_classifications,
 (select count(*) from growth.qualification_review where idempotency_key like 'G3-OAT-%' and evidence_payload->>'synthetic'='true') as persisted_reviews,
 (select count(*) from growth.handoff_candidate where idempotency_key like 'g3:%' and prospect_id in (select id from growth.prospect where external_prospect_key in ('G3-OAT-QUEUE-NURTURE','G3-OAT-DISQUALIFIED'))) as persisted_handoff_candidates,
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
 (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate,
 (select enabled from growth.feature_gate where gate_code='growth_auto_followup_enabled') as auto_followup_gate,
 (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_execution_gate;
