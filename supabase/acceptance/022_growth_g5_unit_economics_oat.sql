begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := 'f7400246-a791-47a1-a924-c2fab39b9f05';
  v_jur uuid := '7ce78825-e3ac-48f0-a18e-1ae72c160adb';
  v_user uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_sr uuid := '46afc42d-d17a-44cc-875f-5c7140adc039';
  v_opp uuid := 'f1657c84-2962-4b86-9e18-c268fcb2b76f';
  p uuid := gen_random_uuid(); c uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  r uuid := gen_random_uuid(); q uuid := gen_random_uuid(); h uuid := gen_random_uuid();
  rec1 jsonb; rec2 jsonb; v record;
  collision_blocked boolean := false; immutable_blocked boolean := false;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,
    source_lane,city,country_code,company_name,segment,facility_type,service_need_summary,
    verification_status,risk_flags,missing_fields,metadata,captured_at
  ) values(
    p,v_org,v_bu,v_jur,'G5-OAT-022-UNIT','handoff_ready','synthetic_g5_unit_econ','Phoenix','US',
    'G5 Unit Economics Synthetic','office','office','Unit economics proof','verified','[]','[]',
    jsonb_build_object('synthetic',true,'oat','022'),'2026-08-05T12:00:00Z'
  );

  insert into growth.prospect_contact_candidate(
    id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,
    contact_source,verification_status,is_primary_candidate,metadata,review_status
  ) values(
    c,p,v_org,v_bu,v_jur,'G5','Economics','g5-oat-022@example.invalid','synthetic_oat','verified',true,
    jsonb_build_object('synthetic',true),'accepted'
  );

  insert into growth.outreach_event(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    channel,event_type,occurred_at,payload,created_at
  ) values(
    e,v_org,v_bu,v_jur,p,c,'email','reply','2026-08-06T12:00:00Z',jsonb_build_object('synthetic',true),'2026-08-06T12:00:00Z'
  );

  insert into growth.reply_classification_evidence(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_event_id,
    classification,classifier_type,classifier_version,confidence,evidence_payload,created_at
  ) values(
    r,v_org,v_bu,v_jur,p,c,e,'positive_interest','human','g5-oat-022',1.0,jsonb_build_object('synthetic',true),'2026-08-06T12:05:00Z'
  );

  insert into growth.qualification_review(
    id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_event_id,
    reply_classification_evidence_id,decision,verified_service_need,supported_geography,verified_reachable_contact,
    reviewer_app_user_id,review_reason,idempotency_key,evidence_payload,reviewed_at,created_at
  ) values(
    q,v_org,v_bu,v_jur,p,c,e,r,'qualified',true,true,true,v_user,'G5 unit economics qualification','G5-OAT-022-Q',
    jsonb_build_object('synthetic',true),'2026-08-06T12:10:00Z','2026-08-06T12:10:00Z'
  );

  insert into growth.handoff_candidate(
    id,prospect_id,organization_id,business_unit_id,jurisdiction_id,status,trigger_type,
    qualification_evidence,handoff_payload,idempotency_key,serviceos_service_request_id,
    serviceos_opportunity_id,attempt_count,submitted_at,completed_at
  ) values(
    h,p,v_org,v_bu,v_jur,'succeeded','positive_reply',jsonb_build_object('synthetic',true),
    jsonb_build_object('synthetic',true),'G5-OAT-022-HANDOFF',v_sr,v_opp,1,'2026-08-07T00:00:00Z','2026-08-07T00:01:00Z'
  );

  rec1 := public.growth_g5_record_acquisition_cost_evidence(
    v_org,v_bu,v_jur,'synthetic_g5_unit_econ','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',
    'CAD',100.00,'G5-OAT-022-SPEND',v_user,'Synthetic approved spend for unit economics OAT','G5-OAT-022-COST',jsonb_build_object('synthetic',true,'oat','022')
  );
  if rec1->>'status' <> 'RECORDED' or coalesce((rec1->>'idempotent_replay')::boolean,true) then
    raise exception 'OAT022 first cost record failed: %',rec1;
  end if;

  rec2 := public.growth_g5_record_acquisition_cost_evidence(
    v_org,v_bu,v_jur,'synthetic_g5_unit_econ','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',
    'CAD',100.00,'G5-OAT-022-SPEND',v_user,'Synthetic approved spend for unit economics OAT','G5-OAT-022-COST',jsonb_build_object('synthetic',true,'oat','022')
  );
  if rec2->>'cost_evidence_id' <> rec1->>'cost_evidence_id' or coalesce((rec2->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'OAT022 idempotent replay failed: %',rec2;
  end if;

  begin
    perform public.growth_g5_record_acquisition_cost_evidence(
      v_org,v_bu,v_jur,'synthetic_g5_unit_econ','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',
      'CAD',101.00,'G5-OAT-022-SPEND',v_user,'Synthetic approved spend for unit economics OAT','G5-OAT-022-COST',jsonb_build_object('synthetic',true,'oat','022')
    );
  exception when others then
    if sqlerrm like '%idempotency collision%' then collision_blocked := true; else raise; end if;
  end;
  if not collision_blocked then raise exception 'OAT022 expected idempotency collision'; end if;

  begin
    update growth.acquisition_cost_evidence set amount=200 where id=(rec1->>'cost_evidence_id')::uuid;
  exception when others then
    if sqlerrm like '%immutable%' then immutable_blocked := true; else raise; end if;
  end;
  if not immutable_blocked then raise exception 'OAT022 expected immutable cost evidence'; end if;

  select * into v
  from public.growth_g5_unit_economics_summary(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_unit_econ' and currency_code='CAD';

  if v.spend_amount<>100.00 or v.prospects<>1 or v.qualified<>1 or v.converted<>1 or v.invoiced_prospects<>1
     or v.recognized_revenue<>300.00 or v.gross_contribution<>200.00
     or v.cost_per_prospect<>100.00 or v.cost_per_qualified_lead<>100.00 or v.customer_acquisition_cost<>100.00
     or v.return_on_ad_spend<>3.0000 or v.contribution_roi<>1.0000 then
    raise exception 'OAT022 unit economics wrong: %',row_to_json(v);
  end if;

  if exists(
    select 1 from public.growth_g5_unit_economics_summary(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-08-31T00:00:00Z')
    where source_lane='synthetic_g5_unit_econ'
  ) then raise exception 'OAT022 partial-period spend should not be allocated'; end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then raise exception 'OAT022 execution gate unexpectedly enabled'; end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key='G5-OAT-022-UNIT') as persisted_prospects,
  (select count(*) from growth.acquisition_cost_evidence where idempotency_key='G5-OAT-022-COST') as persisted_cost_evidence,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
