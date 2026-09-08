import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql=fs.readFileSync("supabase/migrations/20260908181310_governed_contractor_payout_history.sql","utf8");
const ui=fs.readFileSync("src/features/wave5/CleanerPayablesPanel.jsx","utf8");

test("settlement evidence is append-only, territory-scoped, and owner governed",()=>{
  assert.match(sql,/create table public\.contractor_payable_settlement_event/);
  assert.match(sql,/append-only[\s\S]*before update or delete/);
  assert.match(sql,/has_bu_role\(p_organization_id,p_business_unit_id,array\['owner_admin'\]/);
  assert.match(sql,/worker_id=public\.current_worker_id\(organization_id\)/);
  assert.match(sql,/revoke all on table public\.contractor_payable_settlement_event from public,anon,authenticated/);
  assert.match(sql,/Settlement evidence must match its governed contractor payable/);
  assert.match(sql,/Payment evidence requires a governed approved-to-paid transition/);
});

test("payout RPCs preserve pending to approved to paid lifecycle",()=>{
  assert.match(sql,/staff_approve_contractor_payables[\s\S]*payable_status='pending'[\s\S]*payable_status='approved'/);
  assert.match(sql,/staff_mark_contractor_payables_paid[\s\S]*payable_status='approved'[\s\S]*payable_status='paid'/);
  assert.match(sql,/Payment confirmation or reference is required/);
  assert.match(sql,/payment_method in \('ach','zelle','etransfer','check','cash','payroll_provider','other'\)/);
  assert.match(sql,/uq_contractor_payable_settlement_event unique \(contractor_payable_id,event_type\)/);
});

test("dashboard separates outstanding payouts from team-member paid history",()=>{
  assert.match(sql,/'pending_total',v_pending,'approved_total',v_approved,'paid_total',v_paid/);
  assert.match(sql,/'worker_id',x.worker_id/);
  assert.match(sql,/'paid_at',x.paid_at,'payment_method',x.payment_method,'payment_reference',x.payment_reference/);
  assert.match(ui,/All team members/);
  assert.match(ui,/Outstanding/);
  assert.match(ui,/Paid History/);
  assert.match(ui,/Approve selected/);
  assert.match(ui,/Record payment sent/);
  assert.match(ui,/send funds through your bank or payroll provider first/);
});

test("payout workflow reuses the shared financial invalidation and adds no Vercel function",()=>{
  assert.match(ui,/invalidateServiceOSFinancials/);
  assert.equal(fs.readdirSync("api",{recursive:true}).filter(name=>String(name).endsWith(".js")).length,12);
});
