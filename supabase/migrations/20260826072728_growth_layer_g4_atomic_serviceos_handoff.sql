create or replace function public.growth_g4_execute_serviceos_handoff(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_lease_id uuid,
  p_execution_token text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_lease growth.serviceos_handoff_execution_lease%rowtype;
  v_auth growth.serviceos_handoff_authorization%rowtype;
  v_plan growth.serviceos_handoff_plan%rowtype;
  v_res growth.serviceos_handoff_reservation%rowtype;
  v_eval jsonb;
  v_plan_eval jsonb;
  v_obj jsonb;
  v_token_hash text;
  v_gate boolean:=false;
  v_idem public.idempotency_key%rowtype;
  v_idem_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_location_id uuid;
  v_sr_id uuid;
  v_opp_id uuid;
  v_ext_id uuid;
  v_response jsonb;
  v_customer_action text;
  v_contact_action text;
  v_location_action text;
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null or p_lease_id is null or nullif(btrim(coalesce(p_execution_token,'')),'') is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('required_execution_inputs_missing'),'policy_version','g4-atomic-handoff-2026-08-26');
  end if;

  select * into v_lease from growth.serviceos_handoff_execution_lease l where l.id=p_lease_id for update;
  if v_lease.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_found'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;
  if v_lease.organization_id<>p_organization_id or v_lease.business_unit_id<>p_business_unit_id or v_lease.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_scope_mismatch'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(btrim(p_execution_token),'UTF8'),'sha256'),'hex');
  if v_token_hash<>v_lease.lease_token_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('execution_token_invalid'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;

  select * into v_plan from growth.serviceos_handoff_plan p where p.id=v_lease.plan_id;
  select * into v_auth from growth.serviceos_handoff_authorization a where a.id=v_lease.authorization_id;
  if v_plan.id is null or v_auth.id is null or v_plan.object_plan_hash<>v_lease.object_plan_hash or v_auth.object_plan_hash<>v_lease.object_plan_hash or v_auth.plan_id<>v_plan.id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_authorization_plan_lineage_drift'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;
  select * into v_res from growth.serviceos_handoff_reservation r where r.id=v_plan.reservation_id;
  if v_res.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_not_found'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;

  if v_lease.lease_status='consumed' then
    select * into v_idem from public.idempotency_key i where i.scope=v_res.planned_idempotency_scope and i.key=v_res.planned_idempotency_key;
    if v_idem.id is not null and v_idem.request_hash=v_plan.object_plan_hash and v_idem.response_code=200 and v_idem.response_body is not null then
      return v_idem.response_body || jsonb_build_object('idempotent_replay',true);
    end if;
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('consumed_lease_without_completed_idempotency_record'),'policy_version','g4-atomic-handoff-2026-08-26');
  end if;
  if v_lease.lease_status<>'issued' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_issued'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;
  if v_lease.expires_at<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_expired'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;

  select coalesce(enabled,false) into v_gate from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled' for update;
  if not coalesce(v_gate,false) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('growth_serviceos_handoff_gate_disabled'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;

  v_eval:=public.growth_g4_evaluate_serviceos_handoff_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_auth.id);
  if coalesce(v_eval->>'status','')<>'AUTHORIZED_FOR_EXECUTION_LEASE' then return v_eval || jsonb_build_object('policy_version','g4-atomic-handoff-2026-08-26'); end if;
  v_plan_eval:=public.growth_g4_build_serviceos_handoff_dry_run_plan(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_plan.reservation_id);
  if coalesce(v_plan_eval->>'status','')<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' or coalesce(v_plan_eval->>'plan_id','')<>v_plan.id::text or coalesce(v_plan_eval->>'object_plan_hash','')<>v_plan.object_plan_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_plan_eval->'blocking_reasons',jsonb_build_array('handoff_plan_no_longer_current')),'policy_version','g4-atomic-handoff-2026-08-26'); end if;

  insert into public.idempotency_key(organization_id,scope,key,request_hash,expires_at)
  values(p_organization_id,v_res.planned_idempotency_scope,v_res.planned_idempotency_key,v_plan.object_plan_hash,now()+interval '365 days')
  on conflict (scope,key) do nothing;
  select * into v_idem from public.idempotency_key i where i.scope=v_res.planned_idempotency_scope and i.key=v_res.planned_idempotency_key for update;
  if v_idem.request_hash is distinct from v_plan.object_plan_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('canonical_idempotency_conflict'),'policy_version','g4-atomic-handoff-2026-08-26'); end if;
  if v_idem.response_code=200 and v_idem.response_body is not null then
    update growth.serviceos_handoff_execution_lease set lease_status='consumed',consumed_at=coalesce(consumed_at,now()) where id=v_lease.id and lease_status='issued';
    return v_idem.response_body || jsonb_build_object('idempotent_replay',true);
  end if;
  v_idem_id:=v_idem.id;
  v_obj:=v_plan.object_plan;
  v_customer_action:=v_obj->'customer'->>'action';
  v_contact_action:=v_obj->'contact'->>'action';
  v_location_action:=v_obj->'service_location'->>'action';

  if v_customer_action='create' then
    insert into public.customer(organization_id,business_unit_id,customer_type,display_name,status,metadata)
    values(p_organization_id,p_business_unit_id,coalesce(v_obj->'customer'->'create'->>'customer_type','business'),v_obj->'customer'->'create'->>'display_name',coalesce(v_obj->'customer'->'create'->>'status','lead'),coalesce(v_obj->'customer'->'create'->'metadata','{}'::jsonb)) returning id into v_customer_id;
  elsif v_customer_action='reuse' then v_customer_id:=(v_obj->'customer'->>'existing_id')::uuid;
  else raise exception 'growth_g4: unsupported customer action %',v_customer_action; end if;

  if v_contact_action='create' then
    insert into public.contact(customer_id,contact_type,first_name,last_name,email,phone,is_primary,metadata)
    values(v_customer_id,coalesce(v_obj->'contact'->'create'->>'contact_type','primary'),v_obj->'contact'->'create'->>'first_name',v_obj->'contact'->'create'->>'last_name',nullif(v_obj->'contact'->'create'->>'email',''),nullif(v_obj->'contact'->'create'->>'phone',''),coalesce((v_obj->'contact'->'create'->>'is_primary')::boolean,true),coalesce(v_obj->'contact'->'create'->'metadata','{}'::jsonb)) returning id into v_contact_id;
  elsif v_contact_action='reuse' then v_contact_id:=(v_obj->'contact'->>'existing_id')::uuid;
  else raise exception 'growth_g4: unsupported contact action %',v_contact_action; end if;

  if v_location_action='create' then
    insert into public.service_location(customer_id,jurisdiction_id,label,address_line1,address_line2,city,subdivision,postal_code,country_code,metadata)
    values(v_customer_id,p_jurisdiction_id,v_obj->'service_location'->'create'->>'label',v_obj->'service_location'->'create'->>'address_line1',nullif(v_obj->'service_location'->'create'->>'address_line2',''),v_obj->'service_location'->'create'->>'city',nullif(v_obj->'service_location'->'create'->>'subdivision',''),nullif(v_obj->'service_location'->'create'->>'postal_code',''),nullif(v_obj->'service_location'->'create'->>'country_code',''),coalesce(v_obj->'service_location'->'create'->'metadata','{}'::jsonb)) returning id into v_location_id;
  elsif v_location_action='reuse' then v_location_id:=(v_obj->'service_location'->>'existing_id')::uuid;
  elsif v_location_action='omit' then v_location_id:=null;
  else raise exception 'growth_g4: unsupported service location action %',v_location_action; end if;

  if nullif(v_obj->'customer'->>'external_id','') is not null then insert into public.external_reference(organization_id,entity_type,entity_id,system_name,external_type,external_id,metadata) values(p_organization_id,'customer',v_customer_id,'growth_layer_1_0','g4_handoff',v_obj->'customer'->>'external_id',jsonb_build_object('handoff_candidate_id',v_plan.handoff_candidate_id)) returning id into v_ext_id; end if;
  if nullif(v_obj->'contact'->>'external_id','') is not null then insert into public.external_reference(organization_id,entity_type,entity_id,system_name,external_type,external_id,metadata) values(p_organization_id,'contact',v_contact_id,'growth_layer_1_0','g4_handoff',v_obj->'contact'->>'external_id',jsonb_build_object('handoff_candidate_id',v_plan.handoff_candidate_id)) returning id into v_ext_id; end if;
  if v_location_id is not null and nullif(v_obj->'service_location'->>'external_id','') is not null then insert into public.external_reference(organization_id,entity_type,entity_id,system_name,external_type,external_id,metadata) values(p_organization_id,'service_location',v_location_id,'growth_layer_1_0','g4_handoff',v_obj->'service_location'->>'external_id',jsonb_build_object('handoff_candidate_id',v_plan.handoff_candidate_id)) returning id into v_ext_id; end if;

  insert into public.service_request(organization_id,business_unit_id,customer_id,contact_id,service_location_id,marketing_source_id,campaign_id,idempotency_key_id,service_category,lifecycle_status,intake_channel,title,description,requirements,metadata,created_by_app_user_id,updated_by_app_user_id)
  values(p_organization_id,p_business_unit_id,v_customer_id,v_contact_id,v_location_id,(v_obj->'service_request'->>'marketing_source_id')::uuid,nullif(v_obj->'service_request'->>'campaign_id','')::uuid,v_idem_id,v_obj->'service_request'->>'service_category',v_obj->'service_request'->>'lifecycle_status',v_obj->'service_request'->>'intake_channel',v_obj->'service_request'->>'title',v_obj->'service_request'->>'description',coalesce(v_obj->'service_request'->'requirements','{}'::jsonb),coalesce(v_obj->'service_request'->'metadata','{}'::jsonb),v_auth.approved_by_app_user_id,v_auth.approved_by_app_user_id) returning id into v_sr_id;
  insert into public.external_reference(organization_id,entity_type,entity_id,system_name,external_type,external_id,metadata)
  values(p_organization_id,'service_request',v_sr_id,'growth_layer_1_0','g4_handoff',v_obj->'service_request'->>'external_id',jsonb_build_object('handoff_candidate_id',v_plan.handoff_candidate_id)) returning id into v_ext_id;
  update public.service_request set external_reference_id=v_ext_id where id=v_sr_id;

  insert into public.opportunity(organization_id,business_unit_id,service_request_id,customer_id,contact_id,service_location_id,marketing_source_id,campaign_id,idempotency_key_id,stage,title,summary,metadata,created_by_app_user_id,updated_by_app_user_id)
  values(p_organization_id,p_business_unit_id,v_sr_id,v_customer_id,v_contact_id,v_location_id,(v_obj->'opportunity'->>'marketing_source_id')::uuid,nullif(v_obj->'opportunity'->>'campaign_id','')::uuid,v_idem_id,v_obj->'opportunity'->>'stage',v_obj->'opportunity'->>'title',v_obj->'opportunity'->>'summary',coalesce(v_obj->'opportunity'->'metadata','{}'::jsonb),v_auth.approved_by_app_user_id,v_auth.approved_by_app_user_id) returning id into v_opp_id;
  insert into public.external_reference(organization_id,entity_type,entity_id,system_name,external_type,external_id,metadata)
  values(p_organization_id,'opportunity',v_opp_id,'growth_layer_1_0','g4_handoff',v_obj->'opportunity'->>'external_id',jsonb_build_object('handoff_candidate_id',v_plan.handoff_candidate_id)) returning id into v_ext_id;
  update public.opportunity set external_reference_id=v_ext_id where id=v_opp_id;

  update growth.handoff_candidate set status='succeeded',serviceos_customer_id=v_customer_id,serviceos_contact_id=v_contact_id,serviceos_location_id=v_location_id,serviceos_service_request_id=v_sr_id,serviceos_opportunity_id=v_opp_id,attempt_count=attempt_count+1,submitted_at=coalesce(submitted_at,now()),completed_at=now(),last_error=null where id=v_plan.handoff_candidate_id;
  update growth.serviceos_handoff_execution_lease set lease_status='consumed',consumed_at=now() where id=v_lease.id;

  v_response:=jsonb_build_object('status','HANDOFF_SUCCEEDED','policy_version','g4-atomic-handoff-2026-08-26','handoff_candidate_id',v_plan.handoff_candidate_id,'customer_id',v_customer_id,'contact_id',v_contact_id,'service_location_id',v_location_id,'service_request_id',v_sr_id,'opportunity_id',v_opp_id,'plan_id',v_plan.id,'object_plan_hash',v_plan.object_plan_hash,'idempotent_replay',false);
  update public.idempotency_key set response_code=200,response_body=v_response where id=v_idem_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,v_plan.prospect_id,'g4_serviceos_handoff_succeeded','growth_g4',v_response);
  return v_response;
end;
$$;
revoke execute on function public.growth_g4_execute_serviceos_handoff(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g4_execute_serviceos_handoff(uuid,uuid,uuid,uuid,text) to service_role;
