import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatContributionMargin, formatFinancialAmount, MARKET_CURRENCY } from "../src/lib/serviceosFinancialPerformance.js";

const migration = readFileSync(new URL("../supabase/migrations/20260906225749_financial_performance_read_model.sql", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/features/wave1/FinancialPerformancePanel.jsx", import.meta.url), "utf8");
test("financial currency mapping is territory isolated", () => assert.deepEqual(MARKET_CURRENCY, { "HUC-ON": "CAD", "HUC-AZ": "USD" }));
test("money and margin formatting are deterministic", () => { assert.match(formatFinancialAmount(1234.5, "CAD"), /1,234\.50/); assert.equal(formatFinancialAmount(1, "EUR"), "Unavailable"); assert.equal(formatContributionMargin(25.126), "25.1%"); assert.equal(formatContributionMargin(undefined), "No governed data"); });
test("RPC is invoker scoped, Owner/Admin only, and denied to anonymous users", () => { assert.match(migration, /SECURITY INVOKER/i); assert.match(migration, /has_bu_role[\s\S]*owner_admin/i); assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*PUBLIC, anon/i); assert.doesNotMatch(migration, /SECURITY DEFINER/i); });
test("read model fails closed on currency mismatch and uses governed ledgers", () => { assert.match(migration, /Financial ledger currency does not match the selected territory/); for (const ledger of ["pricing_snapshot", "contractor_payable", "job_profitability_snapshot"]) assert.match(migration, new RegExp(ledger)); assert.match(migration, /DISTINCT ON \(jps\.operational_job_id\)/i); });
test("panel exposes four KPIs, empty state, and guarded technical identifiers", () => { for (const label of ["Gross bookings", "Cleaner payouts", "Net contribution", "Contribution margin", "No governed data", "Metric definitions"]) assert.match(panel, new RegExp(label, "i")); assert.match(panel, /<TechnicalDetails>/); });
