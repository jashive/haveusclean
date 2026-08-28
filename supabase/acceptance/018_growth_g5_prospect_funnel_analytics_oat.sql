begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_on_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_on_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_az_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_az_jur uuid := '7288ca65-5d0f-4e21-a200-1d47cf527e29';
  v_user uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p_on uuid := gen_random_uuid();
  p_az uuid := gen_random_uuid();
  c_on uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid();
  e2 uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  q1 uuid := gen_random_uuid();
  q2 uuid := gen_random_uuid();
  v record;
  n integer;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,
    lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,
    segment,facility_type,service_need_summary,verification_status,risk_flags,
    missing_fields,metadata,captured_at
  )
  values
  (p_on,v_org,v_on_bu,v_on_jur,'G5-OAT-018-ON','engaged','synthetic_g5_oat','Toronto','CA','ON','G5 OAT Ontario','office','office','Recurring office cleaning','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','018'),'2026-08-01T12:00:00Z'),
  (p_az,v_org,v_az_bu,v_az_jur,'G5-OAT-018-AZ','discovered','synthetic_g5_oat','Phoenix','US','AZ','G5 OAT Arizona','office','office','Recurring office cleaning','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','018'),'2026-08-15T12:00:00Z');

  insert into growth.prospect_contact_candidate(
    id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,
    email,contact_source,verification_status,is_primary_candidate,metadata,review_status
  )
  values(c_on,p_on,v_org,v_on_bu,v_on_jur,'G5','Ontario','g5-oat-018-on@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');

  insert into growth.outreach_event(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    channel,event_type,occurred_at,payload,created_at
  )
  values
  (e1,v_org,v_on_bu,v_on_jur,p_on,c_on,'email','reply','2026-08-03T12:00:00Z',jsonb_build_object('synthetic',true),'2026-08-03T12:00:00Z'),
  (e2,v_org,v_on_bu,v_on_jur,p_on,c_on,'email','reply','2026-08-05T12:00:00Z',jsonb_build_object('synthetic',true),'2026-08-05T12:00:00Z');

  insert into growth.reply_classification_evidence(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_event_id,classification,classifier_type,classifier_version,confidence,
    evidence_payload,created_at
  )
  values
  (r1,v_org,v_on_bu,v_on_jur,p_on,c_on,e1,'positive_interest','human','g5-oat-018-historical',1.0,jsonb_build_object('synthetic',true),'2026-08-03T12:05:00Z'),
  (r2,v_org,v_on_bu,v_on_jur,p_on,c_on,e2,'not_interested','human','g5-oat-018-latest',1.0,jsonb_build_object('synthetic',true),'2026-08-05T12:05:00Z');

  insert into growth.qualification_review(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_event_id,reply_classification_evidence_id,decision,verified_service_need,
    supported_geography,verified_reachable_contact,reviewer_app_user_id,review_reason,
    idempotency_key,evidence_payload,reviewed_at,created_at
  )
  values
  (q1,v_org,v_on_bu,v_on_jur,p_on,c_on,e1,r1,'qualified',true,true,true,v_user,'G5 OAT historical qualification','G5-OAT-018-Q1',jsonb_build_object('synthetic',true),'2026-08-03T12:10:00Z','2026-08-03T12:10:00Z'),
  (q2,v_org,v_on_bu,v_on_jur,p_on,c_on,e2,r2,'nurture',true,true,true,v_user,'G5 OAT later nurture decision','G5-OAT-018-Q2',jsonb_build_object('synthetic',true),'2026-08-05T12:10:00Z','2026-08-05T12:10:00Z');

  select * into v from growth.prospect_funnel_analytics_v1 where prospect_id=p_on;
  if v.first_positive_interest_at <> '2026-08-03T12:05:00Z'::timestamptz then
    raise exception 'OAT018 first positive milestone wrong: %',v.first_positive_interest_at;
  end if;
  if v.latest_reply_classification <> 'not_interested' then
    raise exception 'OAT018 latest reply wrong: %',v.latest_reply_classification;
  end if;
  if v.first_qualified_at <> '2026-08-03T12:10:00Z'::timestamptz then
    raise exception 'OAT018 first qualified milestone wrong: %',v.first_qualified_at;
  end if;
  if v.latest_qualification_decision <> 'nurture' then
    raise exception 'OAT018 latest qualification wrong: %',v.latest_qualification_decision;
  end if;
  if v.first_reply_at <> '2026-08-03T12:00:00Z'::timestamptz then
    raise exception 'OAT018 first reply milestone wrong: %',v.first_reply_at;
  end if;

  select count(*) into n
  from public.growth_g5_funnel_summary(v_org,null,null,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z');
  if n <> 2 then raise exception 'OAT018 expected two market cohort rows, got %',n; end if;

  select * into v
  from public.growth_g5_funnel_summary(v_org,v_on_bu,v_on_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_oat';
  if v.country_code <> 'CA' or v.subdivision_code <> 'ON' or v.prospects <> 1 or v.verified <> 1 or v.replied <> 1 or v.positive_interest <> 1 or v.qualified <> 1 then
    raise exception 'OAT018 Ontario summary wrong: %',row_to_json(v);
  end if;

  select * into v
  from public.growth_g5_funnel_summary(v_org,v_az_bu,v_az_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_oat';
  if v.country_code <> 'US' or v.subdivision_code <> 'AZ' or v.prospects <> 1 or v.verified <> 1 or v.replied <> 0 or v.positive_interest <> 0 or v.qualified <> 0 then
    raise exception 'OAT018 Arizona summary wrong: %',row_to_json(v);
  end if;

  select count(*) into n
  from public.growth_g5_funnel_summary(v_org,null,null,'2026-08-10T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_oat';
  if n <> 1 then raise exception 'OAT018 captured_from filter expected one cohort row, got %',n; end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then
    raise exception 'OAT018 execution gate unexpectedly enabled';
  end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key in ('G5-OAT-018-ON','G5-OAT-018-AZ')) as persisted_prospects,
  (select count(*) from growth.reply_classification_evidence where classifier_version like 'g5-oat-018-%') as persisted_classifications,
  (select count(*) from growth.qualification_review where idempotency_key in ('G5-OAT-018-Q1','G5-OAT-018-Q2')) as persisted_qualification_reviews,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
