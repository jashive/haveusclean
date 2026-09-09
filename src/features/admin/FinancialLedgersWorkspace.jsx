import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ExecutiveKpiBar from "./ExecutiveKpiBar.jsx";
import JobProfitabilityTable from "./JobProfitabilityTable.jsx";
import PayableSettlementBoard from "./PayableSettlementBoard.jsx";
import PayableDisbursementModal from "./PayableDisbursementModal.jsx";
import { approveContractorPayable, disburseContractorPayable, fetchFinancialLedgers, outstandingPayables } from "../../lib/serviceosFinancialLedgers.js";
import { invalidateServiceOSFinancials, SERVICEOS_WORKSPACE_INVALIDATED_EVENT, serviceOSInvalidationMatches } from "../../lib/serviceosFinancialPerformance.js";

const CleanerPayablesPanel = lazy(() => import("../wave5/CleanerPayablesPanel"));

export default function FinancialLedgersWorkspace({ revenueContext }) {
  const organizationId = revenueContext?.orgId, businessUnitId = revenueContext?.primaryBusinessUnitId;
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busyId, setBusyId] = useState(""), [disbursement, setDisbursement] = useState(null);
  const period = useMemo(() => ({ start: new Date(Date.now() - 30 * 86400000).toISOString(), end: new Date().toISOString() }), [businessUnitId]);
  const load = useCallback(async () => { if (!organizationId || !businessUnitId) return; setLoading(true); setError(""); try { setData(await fetchFinancialLedgers({ organizationId, businessUnitId, periodStart: period.start, periodEnd: period.end })); } catch (nextError) { setError(nextError?.message || "Financial ledgers could not be loaded."); } finally { setLoading(false); } }, [organizationId, businessUnitId, period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const refresh = (event) => { if (serviceOSInvalidationMatches(event, businessUnitId)) load(); }; window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh); return () => window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh); }, [businessUnitId, load]);
  async function approve(row) { setBusyId(row.id); setError(""); try { await approveContractorPayable({ organizationId, businessUnitId, payableId: row.id }); invalidateServiceOSFinancials({ businessUnitId, reason: "contractor_payable_approved" }); await load(); } catch (nextError) { setError(nextError?.message || "Payout approval failed."); } finally { setBusyId(""); } }
  async function disburse(row, paymentMethod, paymentReference) { setBusyId(row.id); setError(""); try { await disburseContractorPayable({ organizationId, businessUnitId, payableId: row.id, paymentMethod, paymentReference }); setDisbursement(null); invalidateServiceOSFinancials({ businessUnitId, reason: "contractor_payable_paid" }); await load(); } catch (nextError) { setError(nextError?.message || "Disbursement recording failed."); } finally { setBusyId(""); } }
  const currencyCode = data?.performance?.scope?.currency_code || data?.payables?.scope?.currency_code;
  return <div className="financial-ledgers-workspace" aria-busy={loading}>
    <ExecutiveKpiBar revenueContext={revenueContext} financialData={data?.performance} outstandingAmount={outstandingPayables(data?.payables)} externalLoading={loading} externalError={error} />
    {error ? <div className="financial-alert" role="alert">{error}</div> : null}
    <PayableSettlementBoard rows={data?.payables?.rows} currencyCode={currencyCode} roleCode={revenueContext?.roleCode} busyId={busyId} onApprove={approve} onDisburse={setDisbursement} />
    <JobProfitabilityTable jobs={data?.jobs} currencyCode={currencyCode} />
    <details className="financial-history-drawer"><summary>Payment history, disbursement evidence, and payroll export</summary><Suspense fallback={<div role="status">Loading payment history…</div>}><CleanerPayablesPanel revenueContext={revenueContext} /></Suspense></details>
    <PayableDisbursementModal row={disbursement} busy={busyId === disbursement?.id} onClose={() => setDisbursement(null)} onConfirm={disburse} />
  </div>;
}
