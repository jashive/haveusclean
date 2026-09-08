import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatContributionMargin, formatFinancialAmount, MARKET_CURRENCY, SERVICEOS_FINANCIAL_INVALIDATED_EVENT } from "../src/lib/serviceosFinancialPerformance.js";

const migration = readFileSync(new URL("../supabase/migrations/20260908174522_financial_read_model_ergonomics.sql", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/features/wave1/FinancialPerformancePanel.jsx", import.meta.url), "utf8");
const qa = readFileSync(new URL("../src/features/wave4/ServiceOSQaWorkspace.jsx", import.meta.url), "utf8");
const intelligence = readFileSync(new URL("../src/features/intelligence/Os10IntelligenceDashboard.jsx", import.meta.url), "utf8");
test("financial currency mapping is territory isolated", () => assert.deepEqual(MARKET_CURRENCY, { "HUC-ON": "CAD", "HUC-AZ": "USD" }));
test("money and margin formatting are deterministic", () => { assert.match(formatFinancialAmount(1234.5, "CAD"), /1,234\.50/); assert.equal(formatFinancialAmount(1, "EUR"), "Unavailable"); assert.equal(formatContributionMargin(25.126), "25.1%"); assert.equal(formatContributionMargin(undefined), "No governed data"); });
test("financial RPC is invoker scoped, Owner/Admin only, and denied to anonymous users", () => { const financialRpc = migration.split("create or replace function public.staff_finalize_qa_inspection")[0]; assert.match(financialRpc, /SECURITY INVOKER/i); assert.match(financialRpc, /has_bu_role[\s\S]*owner_admin/i); assert.match(financialRpc, /REVOKE ALL ON FUNCTION[\s\S]*PUBLIC, anon/i); assert.doesNotMatch(financialRpc, /SECURITY DEFINER/i); });
test("financial invalidation event is shared", () => assert.equal(SERVICEOS_FINANCIAL_INVALIDATED_EVENT, "serviceos:financial-invalidated"));
test("read model fails closed and recognizes economics by service completion", () => { assert.match(migration, /Financial ledger currency does not match the selected territory/); for (const ledger of ["pricing_snapshot", "contractor_payable", "job_profitability_snapshot"]) assert.match(migration, new RegExp(ledger)); assert.match(migration, /DISTINCT ON\(jps\.operational_job_id\)/i); assert.match(migration, /wo\.service_completed_at>=p_period_start/i); assert.match(migration, /sum\(direct_labor_cost\)/i); for (const metric of ["cleaner_labor_accrued","payroll_pending","payroll_approved","payroll_paid","jobs_count"]) assert.match(migration,new RegExp(metric)); });
test("QA returns its sealed snapshot and invalidates financial consumers", () => { assert.match(migration,/financial_summary/); assert.match(migration,/returning \* into v_snapshot/); assert.match(qa,/invalidateServiceOSFinancials/); assert.match(qa,/Financial close complete/); assert.match(intelligence,/SERVICEOS_FINANCIAL_INVALIDATED_EVENT/); });
test("panel exposes accrued labor and settlement badges", () => { for (const label of ["Gross bookings", "Cleaner Labor Accrued", "Pending", "Approved", "Paid", "Net contribution", "Contribution margin", "No governed data", "Metric definitions"]) assert.match(panel, new RegExp(label, "i")); assert.match(panel, /<TechnicalDetails>/); });
