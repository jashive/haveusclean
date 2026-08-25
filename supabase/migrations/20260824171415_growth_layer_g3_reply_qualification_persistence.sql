create table if not exists growth.reply_classification_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete restrict,
  contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete restrict,
  outreach_event_id uuid not null references growth.outreach_event(id) on delete restrict,
  classification text not null check (classification in ('opt_out','positive_interest','request_information','timing_later','not_interested','wrong_contact','referral','unclear')),
  classifier_type text not null check (classifier_type in ('deterministic','human')),
  classifier_version text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  evidence_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (outreach_event_id,classifier_type,classifier_version)
);

create table if not exists growth.qualification_review (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete restrict,
  contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete restrict,
  outreach_event_id uuid not null references growth.outreach_event(id) on delete restrict,
  reply_classification_evidence_id uuid not null references growth.reply_classification_evidence(id) on delete restrict,
  decision text not null check (decision in ('qualification_pending','qualified','nurture','disqualified','suppressed')),
  verified_service_need boolean not null default false,
  supported_geography boolean not null default false,
  verified_reachable_contact boolean not null default false,
  reviewer_app_user_id uuid not null references public.app_user(id),
  review_reason text not null,
  idempotency_key text not null,
  evidence_payload jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key)
);

create index if not exists reply_classification_scope_idx on growth.reply_classification_evidence(organization_id,business_unit_id,jurisdiction_id,prospect_id,created_at desc);
create index if not exists reply_classification_contact_idx on growth.reply_classification_evidence(contact_candidate_id,created_at desc);
create index if not exists qualification_review_scope_idx on growth.qualification_review(organization_id,business_unit_id,jurisdiction_id,prospect_id,reviewed_at desc);
create index if not exists qualification_review_contact_idx on growth.qualification_review(contact_candidate_id,reviewed_at desc);
create index if not exists qualification_review_reviewer_idx on growth.qualification_review(reviewer_app_user_id);
create index if not exists qualification_review_classification_idx on growth.qualification_review(reply_classification_evidence_id);

alter table growth.reply_classification_evidence enable row level security;
alter table growth.qualification_review enable row level security;
revoke all on growth.reply_classification_evidence from public,anon,authenticated,service_role;
revoke all on growth.qualification_review from public,anon,authenticated,service_role;
grant select on growth.reply_classification_evidence to service_role;
grant select on growth.qualification_review to service_role;

create or replace function public.growth_g3_reply_evidence_immutable_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'growth_g3: reply classification evidence is immutable';
end;
$$;

create or replace function public.growth_g3_qualification_review_immutable_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'growth_g3: qualification reviews are immutable';
end;
$$;

drop trigger if exists trg_growth_g3_reply_evidence_immutable on growth.reply_classification_evidence;
create trigger trg_growth_g3_reply_evidence_immutable before update or delete on growth.reply_classification_evidence for each row execute function public.growth_g3_reply_evidence_immutable_guard();
drop trigger if exists trg_growth_g3_qualification_review_immutable on growth.qualification_review;
create trigger trg_growth_g3_qualification_review_immutable before update or delete on growth.qualification_review for each row execute function public.growth_g3_qualification_review_immutable_guard();

create or replace function public.growth_g3_record_reply_classification(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,
  p_outreach_event_id uuid,p_classification text,p_classifier_type text,p_classifier_version text,p_confidence numeric,p_evidence_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_event growth.outreach_event%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_id uuid;
  v_email text;
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_classification not in ('opt_out','positive_interest','request_information','timing_later','not_interested','wrong_contact','referral','unclear') then raise exception 'growth_g3: unsupported reply classification'; end if;
  if p_classifier_type not in ('deterministic','human') then raise exception 'growth_g3: unsupported classifier type'; end if;
  if nullif(btrim(coalesce(p_classifier_version,'')),'') is null then raise exception 'growth_g3: classifier version required'; end if;
  if p_confidence is null or p_confidence<0 or p_confidence>1 then raise exception 'growth_g3: confidence must be between 0 and 1'; end if;
  select * into v_event from growth.outreach_event e where e.id=p_outreach_event_id;
  if v_event.id is null or v_event.event_type<>'reply' or v_event.channel<>'email' then raise exception 'growth_g3: canonical email reply event required'; end if;
  if v_event.organization_id<>p_organization_id or v_event.business_unit_id<>p_business_unit_id or v_event.jurisdiction_id<>p_jurisdiction_id or v_event.prospect_id<>p_prospect_id or v_event.contact_candidate_id<>p_contact_candidate_id then raise exception 'growth_g3: reply event outside authorized target'; end if;
  select r.id into v_id from growth.reply_classification_evidence r where r.outreach_event_id=p_outreach_event_id and r.classifier_type=p_classifier_type and r.classifier_version=btrim(p_classifier_version);
  if v_id is not null then return v_id; end if;
  insert into growth.reply_classification_evidence(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_event_id,classification,classifier_type,classifier_version,confidence,evidence_payload)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_event_id,p_classification,p_classifier_type,btrim(p_classifier_version),p_confidence,coalesce(p_evidence_payload,'{}'::jsonb)) returning id into v_id;
  if p_classification='opt_out' then
    select * into v_contact from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id;
    v_email:=lower(btrim(coalesce(v_contact.email,'')));
    if v_email='' then raise exception 'growth_g3: opt-out requires reachable email identity'; end if;
    if not exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.prospect_id=p_prospect_id and s.channel in ('all','email') and s.identity_type='email' and s.identity_value_normalized=v_email and s.reason='opt_out' and s.active=true) then
      insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
      values(p_organization_id,p_jurisdiction_id,p_prospect_id,'email','email',v_email,'opt_out','growth_g3_reply_classification',true,jsonb_build_object('reply_classification_evidence_id',v_id,'outreach_event_id',p_outreach_event_id));
    end if;
    update growth.prospect set lifecycle_status='suppressed',updated_at=now() where id=p_prospect_id;
  else
    update growth.prospect set lifecycle_status='qualification_pending',updated_at=now() where id=p_prospect_id and lifecycle_status not in ('suppressed','disqualified','handoff_ready');
  end if;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g3_reply_classification_recorded','growth_g3',jsonb_build_object('reply_classification_evidence_id',v_id,'outreach_event_id',p_outreach_event_id,'classification',p_classification,'classifier_type',p_classifier_type,'classifier_version',btrim(p_classifier_version)));
  return v_id;
end;
$$;

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
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_decision not in ('qualification_pending','qualified','nurture','disqualified','suppressed') then raise exception 'growth_g3: unsupported qualification decision'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g3: human reviewer required'; end if;
  if nullif(btrim(coalesce(p_review_reason,'')),'') is null then raise exception 'growth_g3: review reason required'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'growth_g3: idempotency key required'; end if;
  select * into v_class from growth.reply_classification_evidence c where c.id=p_reply_classification_evidence_id;
  if v_class.id is null or v_class.organization_id<>p_organization_id or v_class.business_unit_id<>p_business_unit_id or v_class.jurisdiction_id<>p_jurisdiction_id or v_class.prospect_id<>p_prospect_id or v_class.contact_candidate_id<>p_contact_candidate_id or v_class.outreach_event_id<>p_outreach_event_id then raise exception 'growth_g3: classification evidence outside authorized target'; end if;
  select * into v_existing from growth.qualification_review q where q.organization_id=p_organization_id and q.idempotency_key=btrim(p_idempotency_key);
  if v_existing.id is not null then return jsonb_build_object('qualification_review_id',v_existing.id,'state',v_existing.decision,'handoff_candidate_id',null,'idempotent_replay',true); end if;
  if v_class.classification='opt_out' or exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.prospect_id=p_prospect_id and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email')) then
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
  elsif v_state='nurture' then update growth.prospect set lifecycle_status='nurture',updated_at=now() where id=p_prospect_id;
  elsif v_state='disqualified' then update growth.prospect set lifecycle_status='disqualified',updated_at=now() where id=p_prospect_id;
  elsif v_state='suppressed' then update growth.prospect set lifecycle_status='suppressed',updated_at=now() where id=p_prospect_id;
  else update growth.prospect set lifecycle_status='qualification_pending',updated_at=now() where id=p_prospect_id;
  end if;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,actor_app_user_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,p_reviewer_app_user_id,'g3_qualification_review_recorded','growth_g3',jsonb_build_object('qualification_review_id',v_review_id,'decision',v_state,'handoff_candidate_id',v_handoff_id,'serviceos_handoff_authorized',false));
  return jsonb_build_object('qualification_review_id',v_review_id,'state',case when v_state='qualified' then 'handoff_candidate' else v_state end,'handoff_candidate_id',v_handoff_id,'serviceos_handoff_authorized',false,'idempotent_replay',false);
end;
$$;

revoke execute on function public.growth_g3_reply_evidence_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g3_qualification_review_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g3_record_reply_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g3_record_qualification_review(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.growth_g3_record_reply_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,jsonb) to service_role;
grant execute on function public.growth_g3_record_qualification_review(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,uuid,text,text,jsonb) to service_role;
