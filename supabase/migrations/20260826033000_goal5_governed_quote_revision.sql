alter table public.quote_version drop constraint if exists quote_version_lifecycle_status_check;
alter table public.quote_version add constraint quote_version_lifecycle_status_check check (lifecycle_status = any (array['draft'::text,'sent'::text,'accepted'::text,'declined'::text,'expired'::text,'cancelled'::text,'superseded'::text]));

alter table public.quote_version add column if not exists supersedes_quote_version_id uuid references public.quote_version(id) on delete restrict;
alter table public.quote_version add column if not exists revision_type text;
alter table public.quote_version add column if not exists revision_reason text;
alter table public.quote_version add column if not exists approved_by_app_user_id uuid references public.app_user(id);
alter table public.quote_version add column if not exists concession_amount numeric not null default 0;

alter table public.quote_version drop constraint if exists quote_version_revision_type_check;
alter table public.quote_version add constraint quote_version_revision_type_check check (revision_type is null or revision_type in ('scope_adjustment','approved_concession'));
alter table public.quote_version drop constraint if exists quote_version_concession_amount_check;
alter table public.quote_version add constraint quote_version_concession_amount_check check (concession_amount >= 0);
create index if not exists idx_quote_version_supersedes on public.quote_version(supersedes_quote_version_id);

create or replace function public.quote_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare commercial_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_status <> 'draft' then raise exception 'New quote_version must begin in draft status'; end if;
    if new.revision_type = 'approved_concession' then
      if nullif(trim(coalesce(new.revision_reason,'')),'') is null then raise exception 'Approved concession requires revision reason'; end if;
      if new.approved_by_app_user_id is null then raise exception 'Approved concession requires approved_by_app_user_id'; end if;
      if new.concession_amount <= 0 then raise exception 'Approved concession requires positive concession_amount'; end if;
    elsif new.revision_type = 'scope_adjustment' and new.concession_amount <> 0 then
      raise exception 'Scope adjustment cannot carry concession_amount';
    end if;
    return new;
  end if;

  commercial_changed :=
       new.pricing_snapshot_id is distinct from old.pricing_snapshot_id
    or new.line_items_snapshot is distinct from old.line_items_snapshot
    or new.commercial_snapshot is distinct from old.commercial_snapshot
    or new.terms_text is distinct from old.terms_text
    or new.valid_until is distinct from old.valid_until
    or new.version_no is distinct from old.version_no
    or new.quote_id is distinct from old.quote_id
    or new.organization_id is distinct from old.organization_id
    or new.business_unit_id is distinct from old.business_unit_id
    or new.estimate_id is distinct from old.estimate_id
    or new.supersedes_quote_version_id is distinct from old.supersedes_quote_version_id
    or new.revision_type is distinct from old.revision_type
    or new.revision_reason is distinct from old.revision_reason
    or new.approved_by_app_user_id is distinct from old.approved_by_app_user_id
    or new.concession_amount is distinct from old.concession_amount;

  if old.lifecycle_status <> 'draft' and commercial_changed then raise exception 'Quote version commercial fields are immutable after draft'; end if;
  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'sent' and commercial_changed then raise exception 'Persist commercial edits before the separate draft -> sent transition'; end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    if old.lifecycle_status = 'draft' and new.lifecycle_status not in ('sent','cancelled','superseded') then
      raise exception 'Invalid quote_version transition: % -> %', old.lifecycle_status, new.lifecycle_status;
    elsif old.lifecycle_status = 'sent' and new.lifecycle_status not in ('accepted','declined','expired','cancelled','superseded') then
      raise exception 'Invalid quote_version transition: % -> %', old.lifecycle_status, new.lifecycle_status;
    elsif old.lifecycle_status in ('accepted','declined','expired','cancelled','superseded') then
      raise exception 'Terminal quote_version status % cannot transition to %', old.lifecycle_status, new.lifecycle_status;
    end if;
  end if;

  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif old.lifecycle_status <> 'draft' and new.sent_at is distinct from old.sent_at then
    raise exception 'sent_at is immutable after quote_version leaves draft';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.create_revised_quote_version(
  p_source_quote_version_id uuid,
  p_revision_type text,
  p_revision_reason text,
  p_approved_by_app_user_id uuid,
  p_concession_amount numeric,
  p_estimate_scope_snapshot jsonb,
  p_estimate_assumptions jsonb,
  p_pricing_snapshot jsonb,
  p_title text,
  p_line_items_snapshot jsonb,
  p_commercial_snapshot jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source public.quote_version%rowtype;
  v_quote public.quote%rowtype;
  v_actor uuid;
  v_next_version integer;
  v_estimate_version integer;
  v_estimate public.estimate%rowtype;
  v_pricing public.pricing_snapshot%rowtype;
  v_new public.quote_version%rowtype;
  v_config public.configuration_version%rowtype;
  v_config_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_revision_type not in ('scope_adjustment','approved_concession') then raise exception 'Unsupported revision type'; end if;
  if p_revision_type = 'approved_concession' then
    if nullif(trim(coalesce(p_revision_reason,'')),'') is null then raise exception 'Approved concession requires Reason'; end if;
    if p_approved_by_app_user_id is null then raise exception 'Approved concession requires Approved By'; end if;
    if coalesce(p_concession_amount,0) <= 0 then raise exception 'Approved concession requires a positive concession amount'; end if;
  elsif coalesce(p_concession_amount,0) <> 0 then
    raise exception 'Scope adjustment cannot include a concession amount';
  end if;

  select * into v_source from public.quote_version where id=p_source_quote_version_id for update;
  if not found then raise exception 'Source quote version not found or not visible'; end if;
  if not public.has_bu_role(v_source.organization_id,v_source.business_unit_id,array['owner_admin','office_ops']::text[]) then raise exception 'Not authorized for this business unit'; end if;
  if v_source.lifecycle_status not in ('draft','sent') then raise exception 'Only active draft or sent quote versions may be revised'; end if;
  if exists (select 1 from public.quote_version qv where qv.supersedes_quote_version_id=v_source.id) then raise exception 'This quote version has already been superseded'; end if;
  if exists (select 1 from public.quote_response qr where qr.quote_version_id=v_source.id and qr.response_type='accepted') then raise exception 'Accepted quote cannot be revised'; end if;

  select * into v_quote from public.quote where id=v_source.quote_id and organization_id=v_source.organization_id and business_unit_id=v_source.business_unit_id;
  if not found then raise exception 'Quote lineage is invalid'; end if;

  if p_revision_type='approved_concession' then
    if not exists (
      select 1 from public.user_membership um
      join public.app_role ar on ar.id=um.role_id
      join public.app_user au on au.id=um.app_user_id
      where um.app_user_id=p_approved_by_app_user_id
        and um.organization_id=v_source.organization_id
        and (um.business_unit_id is null or um.business_unit_id=v_source.business_unit_id)
        and um.status='active' and au.status='active' and ar.code='owner_admin'
    ) then raise exception 'Approved By must be an active owner_admin authorized for this business unit'; end if;
  end if;

  v_actor := public.current_app_user_id();
  v_config_id := nullif(p_pricing_snapshot->>'configuration_version_id','')::uuid;
  if v_config_id is null then raise exception 'Revised quote requires governed configuration_version_id'; end if;
  select * into v_config from public.configuration_version where id=v_config_id;
  if not found or v_config.status <> 'published' or v_config.business_unit_id <> v_source.business_unit_id then raise exception 'Revised quote requires published governed configuration for the same business unit'; end if;

  if coalesce((p_pricing_snapshot->>'subtotal_amount')::numeric,-1) < 0
     or coalesce((p_pricing_snapshot->>'tax_amount')::numeric,-1) < 0
     or coalesce((p_pricing_snapshot->>'total_amount')::numeric,-1) < 0 then
    raise exception 'Revised pricing amounts are invalid';
  end if;

  select coalesce(max(version_no),0)+1 into v_next_version from public.quote_version where quote_id=v_source.quote_id;
  select coalesce(max(version_no),0)+1 into v_estimate_version from public.estimate where opportunity_id=v_quote.opportunity_id;

  insert into public.estimate(
    organization_id,business_unit_id,opportunity_id,version_no,lifecycle_status,assumptions,scope_snapshot,notes,metadata,created_by_app_user_id,updated_by_app_user_id
  ) values (
    v_source.organization_id,v_source.business_unit_id,v_quote.opportunity_id,v_estimate_version,'prepared',coalesce(p_estimate_assumptions,'{}'::jsonb),coalesce(p_estimate_scope_snapshot,'{}'::jsonb),
    case when p_revision_type='approved_concession' then 'Approved concession: '||trim(p_revision_reason) else nullif(trim(coalesce(p_revision_reason,'')),'') end,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('revision_of_quote_version_id',v_source.id,'revision_type',p_revision_type),v_actor,v_actor
  ) returning * into v_estimate;

  insert into public.pricing_snapshot(
    organization_id,business_unit_id,opportunity_id,estimate_id,configuration_version_id,currency_code,tax_name,tax_rate,subtotal_amount,discount_amount,tax_amount,total_amount,calculator_version,configuration_snapshot,labor_economics,calculation_inputs,calculation_outputs,raw_calculation_snapshot,frozen_at,metadata,created_by_app_user_id
  ) values (
    v_source.organization_id,v_source.business_unit_id,v_quote.opportunity_id,v_estimate.id,v_config_id,
    p_pricing_snapshot->>'currency_code',p_pricing_snapshot->>'tax_name',(p_pricing_snapshot->>'tax_rate')::numeric,(p_pricing_snapshot->>'subtotal_amount')::numeric,
    coalesce((p_pricing_snapshot->>'discount_amount')::numeric,0),(p_pricing_snapshot->>'tax_amount')::numeric,(p_pricing_snapshot->>'total_amount')::numeric,
    p_pricing_snapshot->>'calculator_version',coalesce(p_pricing_snapshot->'configuration_snapshot','{}'::jsonb),coalesce(p_pricing_snapshot->'labor_economics','{}'::jsonb),
    coalesce(p_pricing_snapshot->'calculation_inputs','{}'::jsonb),coalesce(p_pricing_snapshot->'calculation_outputs','{}'::jsonb),coalesce(p_pricing_snapshot->'raw_calculation_snapshot','{}'::jsonb),now(),
    coalesce(p_pricing_snapshot->'metadata','{}'::jsonb)||jsonb_build_object('revision_of_quote_version_id',v_source.id,'revision_type',p_revision_type,'concession_amount',coalesce(p_concession_amount,0)),v_actor
  ) returning * into v_pricing;

  insert into public.quote_version(
    organization_id,business_unit_id,quote_id,estimate_id,pricing_snapshot_id,version_no,lifecycle_status,title,line_items_snapshot,commercial_snapshot,metadata,created_by_app_user_id,updated_by_app_user_id,
    supersedes_quote_version_id,revision_type,revision_reason,approved_by_app_user_id,concession_amount
  ) values (
    v_source.organization_id,v_source.business_unit_id,v_source.quote_id,v_estimate.id,v_pricing.id,v_next_version,'draft',p_title,coalesce(p_line_items_snapshot,'[]'::jsonb),coalesce(p_commercial_snapshot,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('revision_of_quote_version_id',v_source.id,'revision_type',p_revision_type),v_actor,v_actor,
    v_source.id,p_revision_type,nullif(trim(coalesce(p_revision_reason,'')),''),case when p_revision_type='approved_concession' then p_approved_by_app_user_id else null end,case when p_revision_type='approved_concession' then p_concession_amount else 0 end
  ) returning * into v_new;

  update public.quote_version set lifecycle_status='superseded',updated_by_app_user_id=v_actor where id=v_source.id;
  if v_source.estimate_id is not null then
    update public.estimate set lifecycle_status='superseded',updated_by_app_user_id=v_actor,updated_at=now()
      where id=v_source.estimate_id and lifecycle_status in ('draft','prepared','sent');
  end if;

  return jsonb_build_object(
    'source_quote_version_id',v_source.id,
    'source_status','superseded',
    'quote_version_id',v_new.id,
    'version_no',v_new.version_no,
    'lifecycle_status',v_new.lifecycle_status,
    'estimate_id',v_estimate.id,
    'pricing_snapshot_id',v_pricing.id,
    'revision_type',v_new.revision_type,
    'concession_amount',v_new.concession_amount,
    'approved_by_app_user_id',v_new.approved_by_app_user_id
  );
end;
$$;
revoke all on function public.create_revised_quote_version(uuid,text,text,uuid,numeric,jsonb,jsonb,jsonb,text,jsonb,jsonb,jsonb) from public;
revoke all on function public.create_revised_quote_version(uuid,text,text,uuid,numeric,jsonb,jsonb,jsonb,text,jsonb,jsonb,jsonb) from anon;
grant execute on function public.create_revised_quote_version(uuid,text,text,uuid,numeric,jsonb,jsonb,jsonb,text,jsonb,jsonb,jsonb) to authenticated;
