begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; r1 jsonb;
  e2 uuid:=gen_random_uuid(); ce2 uuid;
begin
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p1,v_org,v_bu,v_jur,'G3-OAT-CANCEL','engaged','synthetic_oat','Toronto','CA','ON','G3 Cancel Synthetic','office','verified','[]','[]',jsonb_build_object('synthetic',true));

  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c1,p1,v_org,v_bu,v_jur,'g3-cancel@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');

  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, please send pricing.'));

  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g3-hardening-2026-08-24',0.99,jsonb_build_object('synthetic',true));
  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic qualified before optout','G3-OAT-CANCEL-QUAL',jsonb_build_object('synthetic',true));

  if r1->>'state'<>'handoff_candidate' then raise exception 'G3 hardening OAT: qualified candidate not created'; end if;
  if not exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='draft') then raise exception 'G3 hardening OAT: draft candidate missing'; end if;

  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e2,v_org,v_bu,v_jur,p1,c1,'email','reply',now()+interval '1 minute',jsonb_build_object('synthetic',true,'reply_text','Please unsubscribe me.'));

  ce2:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e2,'opt_out','deterministic','g3-hardening-2026-08-24',1.0,jsonb_build_object('synthetic',true));

  if not exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='cancelled' and h.handoff_payload->>'cancelled_by'='g3_opt_out' and h.handoff_payload->>'serviceos_handoff_authorized'='false') then raise exception 'G3 hardening OAT: draft handoff not cancelled by optout'; end if;
  if not exists(select 1 from growth.suppression s where s.prospect_id=p1 and s.reason='opt_out' and s.active=true) then raise exception 'G3 hardening OAT: optout suppression missing'; end if;
  if not exists(select 1 from growth.prospect p where p.id=p1 and p.lifecycle_status='suppressed') then raise exception 'G3 hardening OAT: prospect not suppressed'; end if;
  if exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='draft') then raise exception 'G3 hardening OAT: stale draft candidate remains'; end if;
end $$;

rollback;

select
 (select count(*) from growth.prospect where external_prospect_key='G3-OAT-CANCEL') as persisted_prospects,
 (select count(*) from growth.reply_classification_evidence where evidence_payload->>'synthetic'='true' and classifier_version='g3-hardening-2026-08-24') as persisted_classifications,
 (select count(*) from growth.qualification_review where evidence_payload->>'synthetic'='true' and idempotency_key='G3-OAT-CANCEL-QUAL') as persisted_reviews,
 (select count(*) from growth.handoff_candidate where idempotency_key like 'g3:%' and handoff_payload->>'cancelled_by'='g3_opt_out') as persisted_cancelled_handoff_candidates,
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate;
