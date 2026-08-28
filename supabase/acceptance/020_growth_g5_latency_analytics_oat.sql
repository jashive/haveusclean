begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_user uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  q uuid := gen_random_uuid();
  v record;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,
    source_lane,city,country_code,subdivision_code,company_name,segment,facility_type,
    service_need_summary,verification_status,risk_flags,missing_fields,metadata,captured_at
  ) values(
    p,v_org,v_bu,v_jur,'G5-OAT-020-LAT','engaged','synthetic_g5_latency','Toronto','CA','ON',
    'G5 Latency Synthetic','office','office','Latency proof','verified','[]','[]',
    jsonb_build_object('synthetic',true,'oat','020'),'2026-08-01T12:00:00Z'
  );

  insert into growth.prospect_contact_candidate(
    id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,
    contact_source,verification_status,is_primary_candidate,metadata,review_status
  ) values(
    c,p,v_org,v_bu,v_jur,'G5','Latency','g5-oat-020@example.invalid','synthetic_oat','verified',true,
    jsonb_build_object('synthetic',true),'accepted'
  );

  insert into growth.outreach_event(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    channel,event_type,occurred_at,payload,created_at
  ) values(
    e,v_org,v_bu,v_jur,p,c,'email','reply','2026-08-03T12:00:00Z',jsonb_build_object('synthetic',true),'2026-08-03T12:00:00Z'
  );

  insert into growth.reply_classification_evidence(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_event_id,classification,classifier_type,classifier_version,confidence,evidence_payload,created_at
  ) values(
    r,v_org,v_bu,v_jur,p,c,e,'positive_interest','human','g5-oat-020',1.0,jsonb_build_object('synthetic',true),'2026-08-03T12:05:00Z'
  );

  insert into growth.qualification_review(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_event_id,reply_classification_evidence_id,decision,verified_service_need,supported_geography,
    verified_reachable_contact,reviewer_app_user_id,review_reason,idempotency_key,evidence_payload,reviewed_at,created_at
  ) values(
    q,v_org,v_bu,v_jur,p,c,e,r,'qualified',true,true,true,v_user,'G5 latency qualification','G5-OAT-020-Q',
    jsonb_build_object('synthetic',true),'2026-08-03T18:00:00Z','2026-08-03T18:00:00Z'
  );

  select * into v
  from public.growth_g5_latency_summary(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_latency';

  if v.prospects <> 1 then raise exception 'OAT020 expected one prospect: %',row_to_json(v); end if;
  if v.avg_hours_to_first_reply <> 48.00 then raise exception 'OAT020 reply latency expected 48.00: %',row_to_json(v); end if;
  if v.avg_hours_to_qualification <> 54.00 then raise exception 'OAT020 qualification latency expected 54.00: %',row_to_json(v); end if;
  if v.avg_hours_to_opportunity is not null or v.avg_hours_to_quote is not null or v.avg_hours_to_acceptance is not null or v.avg_hours_to_conversion is not null then
    raise exception 'OAT020 downstream latency should remain null without canonical milestones: %',row_to_json(v);
  end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then
    raise exception 'OAT020 execution gate unexpectedly enabled';
  end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key='G5-OAT-020-LAT') as persisted_prospects,
  (select count(*) from growth.qualification_review where idempotency_key='G5-OAT-020-Q') as persisted_qualification_reviews,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
