-- Preserve closed compensation versions as valid historical authority.
-- A version is retired only to prevent future selection; its effective interval
-- remains authoritative for work completed while that version was in force.
begin;

do $migration$
declare
  v_definition text;
  v_before text := 'compensation_status in (''approved'',''active'')';
  v_after text := 'compensation_status in (''approved'',''active'',''retired'')';
begin
  select pg_get_functiondef(
    'public.staff_finalize_qa_inspection(uuid,text,numeric,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null or strpos(v_definition, v_before) = 0 then
    raise exception 'Migration guard: staff_finalize_qa_inspection eligibility predicate was not found';
  end if;

  execute replace(v_definition, v_before, v_after);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_before text := 'v_ccv.compensation_status NOT IN (''approved'', ''active'')';
  v_after text := 'v_ccv.compensation_status NOT IN (''approved'', ''active'', ''retired'')';
  v_message_before text := 'must be approved or active (is: %)';
  v_message_after text := 'must be approved, active, or historically retired (is: %)';
begin
  select pg_get_functiondef(
    'public.trg_contractor_payable_eligibility()'::regprocedure
  ) into v_definition;

  if v_definition is null or strpos(v_definition, v_before) = 0 then
    raise exception 'Migration guard: contractor payable eligibility predicate was not found';
  end if;

  v_definition := replace(v_definition, v_before, v_after);
  v_definition := replace(v_definition, v_message_before, v_message_after);
  execute v_definition;
end;
$migration$;

commit;
