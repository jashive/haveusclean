create index acquisition_cost_evidence_business_unit_idx
  on growth.acquisition_cost_evidence (business_unit_id);

create index acquisition_cost_evidence_jurisdiction_idx
  on growth.acquisition_cost_evidence (jurisdiction_id);

create index acquisition_cost_evidence_approver_idx
  on growth.acquisition_cost_evidence (approved_by_app_user_id);

create index acquisition_cost_evidence_reporting_idx
  on growth.acquisition_cost_evidence (
    organization_id,
    business_unit_id,
    jurisdiction_id,
    period_start,
    period_end,
    source_lane,
    currency_code
  );
