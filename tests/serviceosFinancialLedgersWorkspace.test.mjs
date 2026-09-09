import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { outstandingPayables, profitabilityTone } from "../src/lib/serviceosFinancialLedgers.js";

const workspace = fs.readFileSync(new URL("../src/features/admin/FinancialLedgersWorkspace.jsx", import.meta.url), "utf8");
const settlement = fs.readFileSync(new URL("../src/features/admin/PayableSettlementBoard.jsx", import.meta.url), "utf8");
const profitability = fs.readFileSync(new URL("../src/features/admin/JobProfitabilityTable.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/lib/serviceosFinancialLedgers.js", import.meta.url), "utf8");

function countApiFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countApiFiles(new URL(`${entry.name}/`, directory)) : Number(entry.name.endsWith(".js"))), 0);
}

test("outstanding payables include pending and approved liabilities only", () => {
  assert.equal(outstandingPayables({ pending_total: "2.90", approved_total: 12, paid_total: 100 }), 14.9);
});

test("profitability thresholds are deterministic and investor-readable", () => {
  assert.equal(profitabilityTone(50), "success");
  assert.equal(profitabilityTone(30), "warning");
  assert.equal(profitabilityTone(29.99), "danger");
  assert.equal(profitabilityTone(null), "neutral");
  assert.equal(profitabilityTone(undefined), "neutral");
});

test("financial workspace composes one territory-aware read model", () => {
  assert.match(workspace, /fetchFinancialLedgers/);
  assert.match(workspace, /ExecutiveKpiBar/);
  assert.match(workspace, /PayableSettlementBoard/);
  assert.match(workspace, /JobProfitabilityTable/);
  assert.match(workspace, /SERVICEOS_WORKSPACE_INVALIDATED_EVENT/);
});

test("settlement board uses the existing governed approval RPC boundary", () => {
  assert.match(client, /get_cleaner_payables_dashboard/);
  assert.match(client, /staff_approve_contractor_payables/);
  assert.match(settlement, /Approve payout/);
  assert.match(settlement, /\/admin\/dispatch/);
  assert.doesNotMatch(client + settlement, /\/api\/financial/);
});

test("job profitability uses sealed snapshot fields and required margin colors", () => {
  for (const field of ["recognized_revenue", "cleaner_cost", "net_contribution", "contribution_margin_percent"]) assert.match(profitability, new RegExp(field));
  for (const tone of ["success", "warning", "danger"]) assert.equal(client.includes(`return \"${tone}\"`), true);
});

test("financial workspace adds no schema migration or serverless function", () => {
  assert.equal(countApiFiles(new URL("../api/", import.meta.url)), 12);
  assert.equal(fs.readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).length > 0, true);
});
