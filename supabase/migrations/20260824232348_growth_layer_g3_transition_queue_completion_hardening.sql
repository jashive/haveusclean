create or replace function public.growth_g3_record_qualification_review(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,
  p_outreach_event_id uuid,p_reply_classification_evidence_id uuid,p_decision text,p_verified_service_need boolean,p_supported_geography boolean,
  p_verified_reachable_contact boolean,p_reviewer_app_user_id uuid,p_review_reason text,p_idempotency_key text,p_evidence_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_class growth.reply_classification_evidence%rowtype;
  v_review_id uuid;
  v_existing growth.qualification_review%rowtype;
  v_handoff_id uuid;
  v_state text;
  v_current_lifecycle text;
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_decision not in ('qualification_pending','qualified','nurture','disqualified','suppressed') then raise exception 'growth_g3: unsupported qualification decision'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g3: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_review_reason,'')),'') is null then raise exception 'growth_g3: review reason required'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'growth_g3: idempotency key required'; end if;

  select * into v_class from growth.reply_classification_evidence c where c.id=p_reply_classification_evidence_id;
  if v_class.id is null or v_class.organization_id<>p_organization_id or v_class.business_unit_id<>p_business_unit_id or v_class.jurisdiction_id<>p_jurisdiction_id or v_class.prospect_id<>p_prospect_id or v_class.contact_candidate_id<>p_contact_candidate_id or v_class.outreach_event_id<>p_outreach_event_id then raise exception 'growth_g3: classification evidence outside authorized target'; end if;

  select * into v_existing from growth.qualification_review q where q.organization_id=p_organization_id and q.idempotency_key=btrim(p_idempotency_key);
  if v_existing.id is not null then
    return jsonb_build_object('qualification_review_id',v_existing.id,'state',case when v_existing.decision='qualified' then 'handoff_candidate' else v_existing.decision end,'handoff_candidate_id',null,'serviceos_handoff_authorized',false,'idempotent_replay',true);
  end if;

  select p.lifecycle_status into v_current_lifecycle from growth.prospect p where p.id=p_prospect_id for update;
  if v_current_lifecycle is null then raise exception 'growth_g3: prospect not found'; end if;

  if v_current_lifecycle='suppressed' and p_decision<>'suppressed' then
    raise exception 'growth_g3: terminal qualification decision cannot be reopened';
  elsif v_current_lifecycle='disqualified' and p_decision not in ('disqualified','suppressed') then
    raise exception 'growth_g3: terminal qualification decision cannot be reopened';
  elsif v_current_lifecycle='nurture' and p_decision not in ('nurture','disqualified','suppressed') then
    raise exception 'growth_g3: terminal qualification decision cannot be reopened';
  end if;

  if v_class.classification='opt_out' or exists(
    select 1 from growth.suppression s
    where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.prospect_id=p_prospect_id
      and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email')
  ) then
    v_state:='suppressed';
  elsif p_decision='qualified' then
    if not (p_verified_service_need and p_supported_geography and p_verified_reachable_contact) then raise exception 'growth_g3: qualified decision requires verified service need, geography, and reachable contact'; end if;
    if v_class.classification not in ('positive_interest','request_information','referral') then raise exception 'growth_g3: reply classification does not support qualified decision'; end if;
    v_state:='qualified';
  else
    v_state:=p_decision;
  end if;

  insert into growth.qualification_review(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_event_id,reply_classification_evidence_id,decision,verified_service_need,supported_geography,verified_reachable_contact,reviewer_app_user_id,review_reason,idempotency_key,evidence_payload)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_event_id,p_reply_classification_evidence_id,v_state,coalesce(p_verified_service_need,false),coalesce(p_supported_geography,false),coalesce(p_verified_reachable_contact,false),p_reviewer_app_user_id,btrim(p_review_reason),btrim(p_idempotency_key),coalesce(p_evidence_payload,'{}'::jsonb)) returning id into v_review_id;

  if v_state='qualified' then
    update growth.prospect set lifecycle_status='handoff_ready',updated_at=now() where id=p_prospect_id;
    insert into growth.handoff_candidate(prospect_id,organization_id,business_unit_id,jurisdiction_id,status,trigger_type,qualified_by_app_user_id,qualification_evidence,handoff_payload,idempotency_key)
    values(p_prospect_id,p_organization_id,p_business_unit_id,p_jurisdiction_id,'draft','positive_reply',p_reviewer_app_user_id,jsonb_build_object('qualification_review_id',v_review_id,'reply_classification_evidence_id',p_reply_classification_evidence_id,'outreach_event_id',p_outreach_event_id,'verified_service_need',true,'supported_geography',true,'verified_reachable_contact',true),jsonb_build_object('g4_required',true,'serviceos_handoff_authorized',false),'g3:'||v_review_id::text)
    on conflict (prospect_id) do nothing;
    select h.id into v_handoff_id from growth.handoff_candidate h where h.prospect_id=p_prospect_id;
  elsif v_state='nurture' then
    update growth.handoff_candidate set status='cancelled',handoff_payload=coalesce(handoff_payload,'{}'::jsonb)||jsonb_build_object('cancelled_by','g3_nurture','qualification_review_id',v_review_id,'serviceos_handoff_authorized',false),updated_at=now()
    where prospect_id=p_prospect_id and organization_id=p_organization_id and business_unit_id=p_business_unit_id and jurisdiction_id=p_jurisdiction_id and status='draft';
    update growth.prospect set lifecycle_status='nurture',updated_at=now() where id=p_prospect_id;
  elsif v_state='disqualified' then
    update growth.handoff_candidate set status='cancelled',handoff_payload=coalesce(handoff_payload,'{}'::jsonb)||jsonb_build_object('cancelled_by','g3_disqualified','qualification_review_id',v_review_id,'serviceos_handoff_authorized',false),updated_at=now()
    where prospect_id=p_prospect_id and organization_id=p_organization_id and business_unit_id=p_business_unit_id and jurisdiction_id=p_jurisdiction_id and status='draft';
    update growth.prospect set lifecycle_status='disqualified',updated_at=now() where id=p_prospect_id;
  elsif v_state='suppressed' then
    update growth.handoff_candidate set status='cancelled',handoff_payload=coalesce(handoff_payload,'{}'::jsonb)||jsonb_build_object('cancelled_by','g3_suppressed','qualification_review_id',v_review_id,'serviceos_handoff_authorized',false),updated_at=now()
    where prospect_id=p_prospect_id and organization_id=p_organization_id and business_unit_id=p_business_unit_id and jurisdiction_id=p_jurisdiction_id and status='draft';
    update growth.prospect set lifecycle_status='suppressed',updated_at=now() where id=p_prospect_id;
  else
    update growth.prospect set lifecycle_status='qualification_pending',updated_at=now() where id=p_prospect_id;
  end if;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,actor_app_user_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,p_reviewer_app_user_id,'g3_qualification_review_recorded','growth_g3',jsonb_build_object('qualification_review_id',v_review_id,'decision',v_state,'handoff_candidate_id',v_handoff_id,'serviceos_handoff_authorized',false));

  return jsonb_build_object('qualification_review_id',v_review_id,'state',case when v_state='qualified' then 'handoff_candidate' else v_state end,'handoff_candidate_id',v_handoff_id,'serviceos_handoff_authorized',false,'idempotent_replay',false);
end;
$$;

create or replace function public.growth_g3_list_qualification_review_queue(
  p_organization_id uuid,
  p_business_unit_id uuid default null,
  p_limit integer default 100
) returns table(
  prospect_id uuid,
  contact_candidate_id uuid,
  outreach_event_id uuid,
  reply_classification_evidence_id uuid,
  business_unit_id uuid,
  jurisdiction_id uuid,
  company_name text,
  contact_email text,
  classification text,
  classifier_type text,
  classifier_version text,
  confidence numeric,
  reply_occurred_at timestamptz,
  lifecycle_status text,
  requires_human_review boolean,
  serviceos_handoff_authorized boolean
) language plpgsql security definer set search_path='' as $$
begin
  if p_organization_id is null or not exists(select 1 from public.organization o where o.id=p_organization_id) then
    raise exception 'growth_g3: organization not found';
  end if;
  if p_business_unit_id is not null and not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id) then
    raise exception 'growth_g3: business unit outside organization';
  end if;
  if p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'growth_g3: queue limit must be between 1 and 200';
  end if;

  return query
  with ranked as (
    select c.*,
           row_number() over(partition by c.outreach_event_id order by case when c.classifier_type='human' then 0 else 1 end,c.created_at desc,c.id desc) as rn
    from growth.reply_classification_evidence c
    where c.organization_id=p_organization_id
      and (p_business_unit_id is null or c.business_unit_id=p_business_unit_id)
  )
  select r.prospect_id,r.contact_candidate_id,r.outreach_event_id,r.id,r.business_unit_id,r.jurisdiction_id,
         p.company_name,lower(btrim(cc.email)),r.classification,r.classifier_type,r.classifier_version,r.confidence,
         e.occurred_at,p.lifecycle_status,true,false
  from ranked r
  join growth.prospect p on p.id=r.prospect_id and p.organization_id=r.organization_id and p.business_unit_id=r.business_unit_id and p.jurisdiction_id=r.jurisdiction_id
  join growth.prospect_contact_candidate cc on cc.id=r.contact_candidate_id and cc.prospect_id=r.prospect_id and cc.organization_id=r.organization_id and cc.business_unit_id=r.business_unit_id and cc.jurisdiction_id=r.jurisdiction_id
  join growth.outreach_event e on e.id=r.outreach_event_id and e.organization_id=r.organization_id and e.business_unit_id=r.business_unit_id and e.jurisdiction_id=r.jurisdiction_id and e.prospect_id=r.prospect_id and e.contact_candidate_id=r.contact_candidate_id and e.channel='email' and e.event_type='reply'
  where r.rn=1
    and r.classification<>'opt_out'
    and p.lifecycle_status not in ('nurture','suppressed','disqualified')
    and not exists(select 1 from growth.qualification_review q where q.reply_classification_evidence_id=r.id)
  order by e.occurred_at asc,r.created_at asc
  limit p_limit;
end;
$$;

revoke execute on function public.growth_g3_record_qualification_review(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.growth_g3_record_qualification_review(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,uuid,text,text,jsonb) to service_role;
revoke execute on function public.growth_g3_list_qualification_review_queue(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.growth_g3_list_qualification_review_queue(uuid,uuid,integer) to service_role;
