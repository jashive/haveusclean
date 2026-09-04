-- Public Applicant Portal: complete intake profile, immediate quarantined uploads,
-- and Owner/Admin-only inspection. Uploading does not advance screening or make a
-- candidate activation eligible. All raw applicant fields remain in hems_hr.

begin;

alter table hems_hr.applicant_submission
  add column if not exists residential_address text,
  add column if not exists experience_summary text,
  add column if not exists availability_schedule text;

alter table hems_hr.applicant_submission
  drop constraint if exists ck_applicant_residential_address_length,
  add constraint ck_applicant_residential_address_length check (
    residential_address is null or (btrim(residential_address) <> '' and length(residential_address) <= 500)
  ),
  drop constraint if exists ck_applicant_experience_summary_length,
  add constraint ck_applicant_experience_summary_length check (
    experience_summary is null or (btrim(experience_summary) <> '' and length(experience_summary) <= 2000)
  ),
  drop constraint if exists ck_applicant_availability_schedule_length,
  add constraint ck_applicant_availability_schedule_length check (
    availability_schedule is null or (btrim(availability_schedule) <> '' and length(availability_schedule) <= 1200)
  );

create or replace function public.workforce_submit_public_application_v2(
  p_program_code text,
  p_legal_name text,
  p_email text,
  p_phone_e164 text,
  p_residential_address text,
  p_experience_summary text,
  p_availability_schedule text,
  p_applied_role_code text,
  p_privacy_notice_version text,
  p_background_consent_version text,
  p_privacy_accepted boolean,
  p_background_consent_accepted boolean,
  p_idempotency_key text,
  p_source_fingerprint_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_program hems_hr.applicant_intake_program%rowtype;
  v_existing hems_hr.applicant_submission%rowtype;
  v_submission_id uuid;
  v_reference text;
  v_access_token text;
begin
  select * into v_program
  from hems_hr.applicant_intake_program
  where public_code = upper(btrim(p_program_code))
    and public_code in ('HUC_ON_RESIDENTIAL_CLEANER','HUC_AZ_RESIDENTIAL_CLEANER')
    and status = 'active';
  if not found then raise exception 'applicant intake program unavailable'; end if;
  if btrim(coalesce(p_idempotency_key,'')) = '' or length(p_idempotency_key) > 180 then raise exception 'valid idempotency key is required'; end if;
  if btrim(coalesce(p_legal_name,'')) = '' or length(p_legal_name) > 200 then raise exception 'valid legal name is required'; end if;
  if lower(btrim(coalesce(p_email,''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'valid email is required'; end if;
  if coalesce(p_phone_e164,'') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'valid E.164 phone is required'; end if;
  if btrim(coalesce(p_residential_address,'')) = '' or length(p_residential_address) > 500 then raise exception 'valid residential address is required'; end if;
  if btrim(coalesce(p_experience_summary,'')) = '' or length(p_experience_summary) > 2000 then raise exception 'residential cleaning experience is required'; end if;
  if btrim(coalesce(p_availability_schedule,'')) = '' or length(p_availability_schedule) > 1200 then raise exception 'availability schedule is required'; end if;
  if not (btrim(p_applied_role_code) = any(v_program.allowed_role_codes)) then raise exception 'role is unavailable for this intake program'; end if;
  if p_privacy_notice_version is distinct from v_program.privacy_notice_version or not coalesce(p_privacy_accepted,false) then
    raise exception 'current privacy notice must be accepted';
  end if;
  if p_background_consent_version is distinct from v_program.background_consent_version or not coalesce(p_background_consent_accepted,false) then
    raise exception 'current background check consent must be accepted';
  end if;

  select * into v_existing from hems_hr.applicant_submission
  where program_id=v_program.id and intake_idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('applicant_reference',v_existing.applicant_reference,'stage',v_existing.current_stage,'idempotent_replay',true);
  end if;

  v_reference := 'APP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  v_access_token := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  insert into hems_hr.applicant_submission (
    organization_id,business_unit_id,program_id,applicant_reference,access_token_hash,
    legal_name,email_normalized,phone_e164,applied_role_code,applicant_statement,
    residential_address,experience_summary,availability_schedule,
    privacy_notice_version,consent_to_contact,intake_idempotency_key,source_fingerprint_hash
  ) values (
    v_program.organization_id,v_program.business_unit_id,v_program.id,v_reference,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_access_token,'UTF8'),'sha256'),'hex'),
    btrim(p_legal_name),lower(btrim(p_email)),p_phone_e164,btrim(p_applied_role_code),
    'Public residential cleaner application',btrim(p_residential_address),btrim(p_experience_summary),btrim(p_availability_schedule),
    p_privacy_notice_version,true,p_idempotency_key,nullif(btrim(p_source_fingerprint_hash),'')
  ) returning id into v_submission_id;

  insert into hems_hr.applicant_background_consent (
    organization_id,applicant_submission_id,consent_version,accepted,signed_name,
    consent_artifact_reference,idempotency_key
  ) values (
    v_program.organization_id,v_submission_id,p_background_consent_version,true,btrim(p_legal_name),
    'restricted://applicant-consent/'||v_submission_id::text,'public-apply:'||p_idempotency_key
  );
  insert into hems_hr.applicant_stage_event (
    organization_id,applicant_submission_id,from_stage,to_stage,event_code,actor_kind,idempotency_key
  ) values (v_program.organization_id,v_submission_id,null,'applied','public_application_received','applicant','apply:'||p_idempotency_key);

  return jsonb_build_object(
    'applicant_reference',v_reference,'applicant_access_token',v_access_token,
    'stage','applied','idempotent_replay',false
  );
end;
$$;

-- Applicants may supply requested documents at intake, but early files remain
-- quarantined and do not advance the canonical HR stage machine.
create or replace function public.workforce_create_applicant_upload_intent(
  p_applicant_reference text,p_access_token text,p_document_code text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_app hems_hr.applicant_submission%rowtype;
  v_program hems_hr.applicant_intake_program%rowtype;
  v_existing hems_hr.applicant_upload_intent%rowtype;
  v_intent uuid; v_path text; v_expires timestamptz;
begin
  select * into v_app from hems_hr.applicant_submission
  where applicant_reference=p_applicant_reference
    and access_token_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_access_token,'UTF8'),'sha256'),'hex')
  for update;
  if not found or v_app.disposition<>'open' then raise exception 'applicant document session unavailable'; end if;
  select * into v_program from hems_hr.applicant_intake_program where id=v_app.program_id and status='active';
  if not found or not (p_document_code=any(v_program.required_document_codes)) then raise exception 'document code is not requested'; end if;
  if btrim(coalesce(p_idempotency_key,''))='' or length(p_idempotency_key)>180 then raise exception 'valid upload idempotency key is required'; end if;
  select * into v_existing from hems_hr.applicant_upload_intent
  where applicant_submission_id=v_app.id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('upload_intent_id',v_existing.id,'bucket_id',v_existing.bucket_id,'object_path',v_existing.object_path,'expires_at',v_existing.expires_at,'idempotent_replay',true);
  end if;
  v_intent:=gen_random_uuid();
  v_path:=v_app.organization_id::text||'/'||v_app.id::text||'/'||v_intent::text;
  v_expires:=now()+interval '15 minutes';
  insert into hems_hr.applicant_upload_intent(
    id,organization_id,applicant_submission_id,document_code,object_path,expected_mime_types,max_bytes,expires_at,idempotency_key
  ) values(v_intent,v_app.organization_id,v_app.id,p_document_code,v_path,array['application/pdf','image/jpeg','image/png'],10485760,v_expires,p_idempotency_key);
  return jsonb_build_object('upload_intent_id',v_intent,'bucket_id','hems-hr-applicant-evidence','object_path',v_path,'expires_at',v_expires,'idempotent_replay',false);
end;
$$;

create or replace function public.get_applicant_upload_completion_locator(
  p_upload_intent_id uuid,p_applicant_reference text,p_access_token text
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_intent hems_hr.applicant_upload_intent%rowtype;
begin
  select intent.* into v_intent
  from hems_hr.applicant_upload_intent intent
  join hems_hr.applicant_submission applicant on applicant.id=intent.applicant_submission_id
  where intent.id=p_upload_intent_id and intent.intent_status='issued' and intent.expires_at>now()
    and applicant.applicant_reference=p_applicant_reference and applicant.disposition='open'
    and applicant.access_token_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_access_token,'UTF8'),'sha256'),'hex');
  if not found then raise exception 'active applicant upload not found'; end if;
  return jsonb_build_object('bucket_id',v_intent.bucket_id,'object_path',v_intent.object_path);
end;
$$;

create or replace function public.workforce_quarantine_applicant_upload(
  p_upload_intent_id uuid,p_detected_mime_type text,p_byte_size bigint,p_sha256 text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_intent hems_hr.applicant_upload_intent%rowtype; v_capture_id uuid;
begin
  select * into v_intent from hems_hr.applicant_upload_intent where id=p_upload_intent_id for update;
  if not found or v_intent.intent_status<>'issued' or v_intent.expires_at<now() then raise exception 'active upload intent not found'; end if;
  if not (p_detected_mime_type=any(v_intent.expected_mime_types)) then raise exception 'detected MIME type is not allowed'; end if;
  if p_byte_size<1 or p_byte_size>v_intent.max_bytes then raise exception 'verified object size is outside the intent limit'; end if;
  if lower(p_sha256)!~'^[0-9a-f]{64}$' then raise exception 'valid SHA-256 is required'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=v_intent.bucket_id and o.name=v_intent.object_path) then raise exception 'uploaded Storage object was not found'; end if;
  insert into hems_hr.applicant_document_capture(
    organization_id,applicant_submission_id,document_code,secure_file_reference,file_sha256,capture_status,idempotency_key
  ) values(
    v_intent.organization_id,v_intent.applicant_submission_id,v_intent.document_code,
    'storage://'||v_intent.bucket_id||'/'||v_intent.object_path,lower(p_sha256),'quarantined',p_idempotency_key
  ) returning id into v_capture_id;
  update hems_hr.applicant_upload_intent set intent_status='used',used_at=now() where id=v_intent.id;
  return jsonb_build_object('document_capture_id',v_capture_id,'capture_status','quarantined','admin_review_required',true);
end;
$$;

create or replace function public.get_applicant_intake_inspector(
  p_applicant_submission_id uuid,p_actor_app_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_app hems_hr.applicant_submission%rowtype; v_result jsonb;
begin
  select * into v_app from hems_hr.applicant_submission where id=p_applicant_submission_id;
  if not found then raise exception 'applicant not found'; end if;
  if not hems_hr.dashboard_actor_can_view(v_app.organization_id,v_app.business_unit_id,p_actor_app_user_id) then raise exception 'applicant inspector actor is not authorized'; end if;
  select jsonb_build_object(
    'applicant_submission_id',v_app.id,'organization_id',v_app.organization_id,'business_unit_id',v_app.business_unit_id,
    'applicant_reference',v_app.applicant_reference,'display_name',v_app.legal_name,'email',v_app.email_normalized,
    'phone',v_app.phone_e164,'applied_role_code',v_app.applied_role_code,'current_stage',v_app.current_stage,
    'residential_address',v_app.residential_address,'experience_summary',v_app.experience_summary,
    'availability_schedule',v_app.availability_schedule,'submitted_at',v_app.submitted_at,
    'background_consent_recorded',exists(select 1 from hems_hr.applicant_background_consent c where c.applicant_submission_id=v_app.id and c.accepted),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'document_capture_id',capture.id,'document_code',capture.document_code,'capture_status',capture.capture_status,
      'uploaded_at',capture.uploaded_at,'viewable',capture.secure_file_reference like 'storage://hems-hr-applicant-evidence/%'
    ) order by capture.uploaded_at) from hems_hr.applicant_document_capture capture
      where capture.applicant_submission_id=v_app.id and capture.capture_status<>'superseded'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_applicant_document_access_locator(
  p_document_capture_id uuid,p_actor_app_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_capture hems_hr.applicant_document_capture%rowtype; v_app hems_hr.applicant_submission%rowtype; v_prefix constant text := 'storage://hems-hr-applicant-evidence/';
begin
  select * into v_capture from hems_hr.applicant_document_capture where id=p_document_capture_id;
  if not found then raise exception 'applicant document not found'; end if;
  select * into v_app from hems_hr.applicant_submission where id=v_capture.applicant_submission_id;
  if not hems_hr.dashboard_actor_can_view(v_app.organization_id,v_app.business_unit_id,p_actor_app_user_id) then raise exception 'applicant document actor is not authorized'; end if;
  if v_capture.secure_file_reference not like v_prefix||'%' then raise exception 'applicant document is not a restricted Storage object'; end if;
  return jsonb_build_object('business_unit_id',v_app.business_unit_id,'bucket_id','hems-hr-applicant-evidence','object_path',substr(v_capture.secure_file_reference,length(v_prefix)+1));
end;
$$;

do $$ declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.workforce_submit_public_application_v2(text,text,text,text,text,text,text,text,text,text,boolean,boolean,text,text)'::regprocedure,
    'public.workforce_create_applicant_upload_intent(text,text,text,text)'::regprocedure,
    'public.get_applicant_upload_completion_locator(uuid,text,text)'::regprocedure,
    'public.workforce_quarantine_applicant_upload(uuid,text,bigint,text,text)'::regprocedure,
    'public.get_applicant_intake_inspector(uuid,uuid)'::regprocedure,
    'public.get_applicant_document_access_locator(uuid,uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',v_signature);
    execute format('grant execute on function %s to service_role',v_signature);
  end loop;
end $$;

comment on function public.get_applicant_intake_inspector(uuid,uuid) is
  'Owner/Admin governed applicant projection. Omits access tokens, secure paths, hashes, identity values and document bytes.';

commit;
