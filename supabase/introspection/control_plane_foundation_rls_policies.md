# Control-plane foundation RLS policy evidence

Read-only extraction from the production-like ServiceOS database. No application rows were copied. This is historical evidence, not an instruction to blindly reproduce legacy role codes. The canonical fresh-environment role model remains `owner_admin`, `office_ops`, `worker`, `qa`; legacy `sales`, `finance`, `qa_supervisor`, and `read_only` references below require intentional reconciliation.

All 26 foundation relations had RLS enabled and not forced.

| table | policy | command | roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| app_role | role_authenticated_select | SELECT | authenticated | `true` | — |
| app_user | app_user_self_select | SELECT | authenticated | `auth_user_id = auth.uid()` | — |
| audit_event | audit_admin_select | SELECT | authenticated | `organization_id IS NOT NULL AND has_org_role(organization_id, ARRAY['owner_admin','office_ops','finance','qa_supervisor'])` | — |
| business_unit | bu_member_select | SELECT | authenticated | `is_org_member(organization_id)` | — |
| campaign | campaign_staff_select | SELECT | authenticated | `has_org_role(organization_id, ARRAY['owner_admin','office_ops','sales','finance','read_only'])` | — |
| campaign | campaign_staff_write | ALL | authenticated | `has_org_role(organization_id, ARRAY['owner_admin','sales'])` | same |
| configuration_version | config_admin_write | ALL | authenticated | `has_org_role(organization_id, ARRAY['owner_admin'])` | same |
| configuration_version | config_member_select | SELECT | authenticated | `is_org_member(organization_id) AND (business_unit_id IS NULL OR is_business_unit_member(business_unit_id))` | — |
| contact | contact_staff_insert | INSERT | authenticated | — | `EXISTS (SELECT 1 FROM customer c WHERE c.id = contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales']))` |
| contact | contact_staff_select | SELECT | authenticated | `EXISTS (SELECT 1 FROM customer c WHERE c.id = contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only']))` | — |
| contact | contact_staff_update | UPDATE | authenticated | `EXISTS (SELECT 1 FROM customer c WHERE c.id = contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales']))` | same |
| conversion_record | conversion_record_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| conversion_record | conversion_record_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| customer | customer_staff_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales'])` |
| customer | customer_staff_select | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| customer | customer_staff_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales'])` | same |
| estimate | estimate_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| estimate | estimate_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status IN ('draft','prepared','sent','superseded','rejected','expired','cancelled')` |
| estimate | estimate_ops_sales_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status IN ('draft','prepared','sent','superseded','rejected','expired','cancelled')` |
| estimate | estimate_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| external_reference | external_ref_admin_select | SELECT | authenticated | `organization_id IS NOT NULL AND has_org_role(organization_id,ARRAY['owner_admin','office_ops','finance'])` | — |
| job_handoff | job_handoff_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| job_handoff | job_handoff_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| jurisdiction | jurisdiction_authenticated_select | SELECT | authenticated | `true` | — |
| marketing_source | marketing_staff_select | SELECT | authenticated | `has_org_role(organization_id,ARRAY['owner_admin','office_ops','sales','finance','read_only'])` | — |
| marketing_source | marketing_staff_write | ALL | authenticated | `has_org_role(organization_id,ARRAY['owner_admin','sales'])` | same |
| migration_lineage | lineage_admin_select | SELECT | authenticated | `has_org_role((SELECT organization.id FROM organization WHERE organization.code = 'HUC' LIMIT 1), ARRAY['owner_admin'])` | — |
| opportunity | opportunity_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| opportunity | opportunity_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND stage IN ('open','qualified','proposal','lost','cancelled')` |
| opportunity | opportunity_ops_sales_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND stage IN ('open','qualified','proposal','lost','cancelled')` |
| opportunity | opportunity_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| organization | org_member_select | SELECT | authenticated | `is_org_member(id)` | — |
| pricing_snapshot | pricing_snapshot_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| pricing_snapshot | pricing_snapshot_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` |
| pricing_snapshot | pricing_snapshot_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| quote | quote_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| quote | quote_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status IN ('draft','active','cancelled')` |
| quote | quote_ops_sales_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status IN ('draft','active','cancelled')` |
| quote | quote_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| quote_response | quote_response_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| quote_response | quote_response_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND response_type IN ('viewed','requested_changes','declined','expired')` |
| quote_response | quote_response_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| quote_version | quote_version_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| quote_version | quote_version_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status = 'draft'` |
| quote_version | quote_version_ops_sales_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales']) AND lifecycle_status IN ('draft','sent','cancelled')` |
| quote_version | quote_version_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| service_location | location_staff_insert | INSERT | authenticated | — | `EXISTS (SELECT 1 FROM customer c WHERE c.id = service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales']))` |
| service_location | location_staff_select | SELECT | authenticated | `EXISTS (SELECT 1 FROM customer c WHERE c.id = service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales','qa_supervisor','read_only']))` | — |
| service_location | location_staff_update | UPDATE | authenticated | `EXISTS (SELECT 1 FROM customer c WHERE c.id = service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops','sales']))` | same |
| service_request | service_request_authorized_read | SELECT | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','sales','finance','qa_supervisor','read_only'])` | — |
| service_request | service_request_ops_sales_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` |
| service_request | service_request_ops_sales_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['office_ops','sales'])` | same |
| service_request | service_request_owner_admin_all | ALL | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])` | same |
| user_membership | membership_admin_select | SELECT | authenticated | `has_org_role(organization_id,ARRAY['owner_admin'])` | — |
| user_membership | membership_self_select | SELECT | authenticated | `app_user_id = current_app_user_id()` | — |
| worker | worker_staff_insert | INSERT | authenticated | — | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops'])` |
| worker | worker_staff_or_self_select | SELECT | authenticated | `app_user_id = current_app_user_id() OR has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','qa_supervisor','read_only'])` | — |
| worker | worker_staff_update | UPDATE | authenticated | `has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops','qa_supervisor'])` | same |

## Required reconciliation

- Remove legacy roles rather than recreating them.
- Replace `sales` operational write/read intent with the current canonical office role only where current application/workflow policy supports it.
- Do not automatically map historical `finance`, `qa_supervisor`, or `read_only` privileges to broader canonical roles; use current PR #7 role/workflow boundaries and fail closed.
- Remove the `organization.code = 'HUC'` coupling from `migration_lineage`; classify as expected HUC-specific historical drift.
