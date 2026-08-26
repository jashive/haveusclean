create index if not exists serviceos_handoff_plan_business_unit_idx
  on growth.serviceos_handoff_plan (business_unit_id);

create index if not exists serviceos_handoff_plan_jurisdiction_idx
  on growth.serviceos_handoff_plan (jurisdiction_id);
