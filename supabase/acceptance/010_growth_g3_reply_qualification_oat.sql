begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; r1 jsonb;
  p2 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); ce2 uuid; r2 jsonb;
  blocked boolean:=false;
begin
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values
  (p1,v_org,v_bu,v_jur,'G3-OAT-QUAL','engaged','synthetic_oat','Toronto','CA','ON','G3 Qualified Synthetic','office','verified','[]','[]',jsonb_build_object('synthetic',true)),
  (p2,v_org,v_bu,v_jur,'G3-OAT-OPTOUT','engaged','synthetic_oat','Toronto','CA','ON','G3 Optout Synthetic','office','verified','[]','[]',jsonb_build_object('synthetic',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values
  (c1,p1,v_org,v_bu,v_jur,'g3-qualified@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted'),
  (c2,p2,v_org,v_bu,v_jur,'g3-optout@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values
  (e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, please send pricing.')),
  (e2,v_org,v_bu,v_jur,p2,c2,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Please unsubscribe me.'));

  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g3-deterministic-2026-08-24',0.99,jsonb_build_object('synthetic',true));
  r1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic qualified OAT','G3-OAT-QUAL-1',jsonb_build_object('synthetic',true));
  if r1->>'state'<>'handoff_candidate' or coalesce((r1->>'serviceos_handoff_authorized')::boolean,true) then raise exception 'G3 OAT failed qualified boundary %',r1; end if;
  if not exists(select 1 from growth.handoff_candidate h where h.prospect_id=p1 and h.status='draft' and h.handoff_payload->>'g4_required'='true' and h.handoff_payload->>'serviceos_handoff_authorized'='false' and h.serviceos_service_request_id is null and h.serviceos_opportunity_id is null) then raise exception 'G3 OAT failed handoff candidate boundary'; end if;

  ce2:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p2,c2,e2,'opt_out','deterministic','g3-deterministic-2026-08-24',1.0,jsonb_build_object('synthetic',true));
  r2:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p2,c2,e2,ce2,'qualified',true,true,true,v_reviewer,'Synthetic optout precedence OAT','G3-OAT-OPTOUT-1',jsonb_build_object('synthetic',true));
  if r2->>'state'<>'suppressed' then raise exception 'G3 OAT failed optout precedence %',r2; end if;
  if not exists(select 1 from growth.suppression s where s.prospect_id=p2 and s.reason='opt_out' and s.active=true) then raise exception 'G3 OAT failed optout suppression'; end if;
  if exists(select 1 from growth.handoff_candidate h where h.prospect_id=p2) then raise exception 'G3 OAT failed suppressed handoff'; end if;

  begin
    perform public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e2,'unclear','deterministic','g3-scope-test',0.5,'{}'::jsonb);
  exception when others then
    if position('reply event outside authorized target' in sqlerrm)>0 then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'G3 OAT failed cross-target event accepted'; end if;

  begin
    update growth.reply_classification_evidence set classification='unclear' where id=ce1;
    raise exception 'G3 OAT failed evidence mutation allowed';
  exception when others then
    if position('reply classification evidence is immutable' in sqlerrm)=0 then raise; end if;
  end;
end $$;

rollback;

select
 (select count(*) from growth.prospect where external_prospect_key in ('G3-OAT-QUAL','G3-OAT-OPTOUT')) as persisted_prospects,
 (select count(*) from growth.reply_classification_evidence where evidence_payload->>'synthetic'='true') as persisted_classifications,
 (select count(*) from growth.qualification_review where evidence_payload->>'synthetic'='true') as persisted_reviews,
 (select count(*) from growth.handoff_candidate where qualification_evidence ? 'qualification_review_id' and idempotency_key like 'g3:%') as persisted_handoff_candidates,
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate;
