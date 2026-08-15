// ── Wave 5: ServiceOS Finance Preview Pilot Panel ─────────────────────────────
//
// Feature flags required:
//   VITE_SERVICEOS_FINANCE_ENABLED   === "true"
//   VITE_SERVICEOS_WAVE5_PILOT_UI    === "true"
//
// This panel works ONLY with explicit canonical IDs entered by the user.
// It does NOT:
//   - modify Wave 1–4 data
//   - delete or void historical records
//   - execute SQL migrations
//   - invoke cleanup
//   - enable Production flags
//
// Production flags remain OFF.

import React, { useState, useCallback } from "react";

import {
  assessBillingReadiness,
  createAndFreezeInvoiceRequest,
  enqueueAccountingSync,
  observePayment,
  createCompensationVersion,
  approveCompensationVersion,
  createPayableForAssignment,
  captureJobProfitabilitySnapshot,
  loadWave5FinanceStatus,
} from "../../lib/serviceosWave5Runtime.js";

// ── Feature guards ─────────────────────────────────────────────────────────────

const FINANCE_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED === "true";

const WAVE5_PILOT_ENABLED =
  FINANCE_ENABLED &&
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_WAVE5_PILOT_UI === "true";

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  panel: {
    position: "fixed",
    bottom: 16,
    left: 16,
    width: 410,
    background: "#0e1a2b",
    border: "1px solid #1e3a5f",
    borderRadius: 8,
    padding: "1.25rem",
    fontFamily: "system-ui, sans-serif",
    color: "#e8f4ff",
    zIndex: 9995,
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    maxHeight: "90vh",
    overflowY: "auto",
    fontSize: "0.82rem",
  },
  heading: {
    margin: "0 0 0.75rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#38bdf8",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    background: "#1e40af",
    color: "#bfdbfe",
    fontSize: "0.68rem",
    borderRadius: 4,
    padding: "2px 6px",
    fontWeight: 700,
  },
  section: {
    marginBottom: "0.9rem",
    borderTop: "1px solid #1e3a5f",
    paddingTop: "0.7rem",
  },
  sectionLabel: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    background: "#0a1628",
    border: "1px solid #2d4a6e",
    borderRadius: 4,
    color: "#e8f4ff",
    padding: "5px 8px",
    fontSize: "0.78rem",
    marginBottom: 6,
    boxSizing: "border-box",
  },
  btn: {
    background: "#1e40af",
    color: "#e8f4ff",
    border: "none",
    borderRadius: 4,
    padding: "5px 12px",
    fontSize: "0.78rem",
    cursor: "pointer",
    marginRight: 6,
  },
  statusBlock: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: "0.75rem",
    marginTop: 6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  error: { color: "#f87171", fontSize: "0.75rem", marginTop: 4 },
  ok: { color: "#4ade80", fontSize: "0.75rem", marginTop: 4 },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function ResultBlock({ data, error }) {
  if (error) return <div style={styles.error}>{String(error)}</div>;
  if (data === undefined || data === null) return null;
  return (
    <div style={styles.statusBlock}>{JSON.stringify(data, null, 2)}</div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function ServiceOSWave5FinancePilotPanel({ session }) {
  if (!WAVE5_PILOT_ENABLED) return null;

  const accessToken = session?.access_token ?? null;
  const appUserId = session?.user?.id ?? null;

  // ── Step 1: Billing Readiness Assessment ─────────────────────────────────────
  const [jobId1, setJobId1] = useState("");
  const [gateResult, setGateResult] = useState(null);
  const [gateErr, setGateErr] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);

  const handleAssessBillingReadiness = useCallback(async () => {
    if (!jobId1.trim()) { setGateErr("operational_job_id required"); return; }
    setGateLoading(true); setGateErr(null); setGateResult(null);
    try {
      const status = await loadWave5FinanceStatus(jobId1.trim(), { accessToken });
      setGateResult(status);
    } catch (e) {
      setGateErr(e.message);
    } finally {
      setGateLoading(false);
    }
  }, [jobId1, accessToken]);

  // ── Step 2: Create Invoice Request ─────────────────────────────────────────
  const [gateId2, setGateId2] = useState("");
  const [psId2, setPsId2] = useState("");
  const [qvId2, setQvId2] = useState("");
  const [irResult, setIrResult] = useState(null);
  const [irErr, setIrErr] = useState(null);
  const [irLoading, setIrLoading] = useState(false);

  const handleCreateInvoiceRequest = useCallback(async () => {
    if (!gateId2.trim() || !psId2.trim() || !qvId2.trim()) {
      setIrErr("billing_readiness_gate_id, pricing_snapshot_id, and quote_version_id required");
      return;
    }
    setIrLoading(true); setIrErr(null); setIrResult(null);
    try {
      // Fetch gate, pricing_snapshot, and quote_version for the operation
      // (In a real flow these would be passed from context; here we fetch by ID for preview)
      const { fetchBillingReadinessGateById } = await import("../../lib/serviceosWave5FinanceClient.js");
      const gate = await fetchBillingReadinessGateById(gateId2.trim(), accessToken);
      if (!gate) throw new Error(`billing_readiness_gate ${gateId2.trim()} not found`);
      if (gate.gate_status !== "ready") throw new Error(`Gate status is '${gate.gate_status}', not ready`);

      // Fetch pricing snapshot inline (no Wave5 client method for this; use direct import)
      const { authenticatedRestFetch } = await import("../../lib/serviceosAuthClient.js");
      const psRes = await authenticatedRestFetch(
        `pricing_snapshot?id=eq.${encodeURIComponent(psId2.trim())}&limit=1`,
        accessToken
      );
      const psRows = psRes.ok ? await psRes.json() : [];
      const ps = Array.isArray(psRows) ? psRows[0] : null;
      if (!ps) throw new Error(`pricing_snapshot ${psId2.trim()} not found`);

      const qvRes = await authenticatedRestFetch(
        `quote_version?id=eq.${encodeURIComponent(qvId2.trim())}&limit=1`,
        accessToken
      );
      const qvRows = qvRes.ok ? await qvRes.json() : [];
      const qv = Array.isArray(qvRows) ? qvRows[0] : null;
      if (!qv) throw new Error(`quote_version ${qvId2.trim()} not found`);

      const result = await createAndFreezeInvoiceRequest(
        {
          organizationId: gate.organization_id,
          businessUnitId: gate.business_unit_id,
          jurisdictionId: gate.jurisdiction_id ?? null,
        },
        gate,
        ps,
        qv,
        null,
        { accessToken, appUserId }
      );
      setIrResult(result);
    } catch (e) {
      setIrErr(e.message);
    } finally {
      setIrLoading(false);
    }
  }, [gateId2, psId2, qvId2, accessToken, appUserId]);

  // ── Step 3: Accounting Sync (Preview Test Adapter) ────────────────────────
  const [irId3, setIrId3] = useState("");
  const [syncResult, setSyncResult] = useState(null);
  const [syncErr, setSyncErr] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const handleEnqueueAccountingSync = useCallback(async () => {
    if (!irId3.trim()) { setSyncErr("invoice_request_id required"); return; }
    setSyncLoading(true); setSyncErr(null); setSyncResult(null);
    try {
      const { fetchInvoiceRequestById } = await import("../../lib/serviceosWave5FinanceClient.js");
      const ir = await fetchInvoiceRequestById(irId3.trim(), accessToken);
      if (!ir) throw new Error(`invoice_request ${irId3.trim()} not found`);

      const outbox = await enqueueAccountingSync(ir, "v1", {
        accessToken,
        appUserId,
        isTestAdapter: true,
        provider: "preview_test",
      });
      setSyncResult(outbox);
    } catch (e) {
      setSyncErr(e.message);
    } finally {
      setSyncLoading(false);
    }
  }, [irId3, accessToken, appUserId]);

  // ── Step 4: Observe Payment ───────────────────────────────────────────────
  const [irId4, setIrId4] = useState("");
  const [payAmount4, setPayAmount4] = useState("");
  const [payCurrency4, setPayCurrency4] = useState("CAD");
  const [payResult, setPayResult] = useState(null);
  const [payErr, setPayErr] = useState(null);
  const [payLoading, setPayLoading] = useState(false);

  const handleObservePayment = useCallback(async () => {
    if (!irId4.trim() || !payAmount4) { setPayErr("invoice_request_id and amount required"); return; }
    setPayLoading(true); setPayErr(null); setPayResult(null);
    try {
      const { fetchInvoiceRequestById } = await import("../../lib/serviceosWave5FinanceClient.js");
      const ir = await fetchInvoiceRequestById(irId4.trim(), accessToken);
      if (!ir) throw new Error(`invoice_request ${irId4.trim()} not found`);

      const previewEventId = `preview-test-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const result = await observePayment(
        ir,
        {
          provider: "preview_test",
          providerEventId: previewEventId,
          providerEventType: "preview.payment.observed",
          currencyCode: payCurrency4.trim() || ir.currency_code,
          amountObserved: Number(payAmount4),
          observedAt: new Date().toISOString(),
          isTestProvider: true,
          eventPayloadSnapshot: { preview_only: true, note: "Wave 5 Preview Pilot Panel" },
        },
        { accessToken, appUserId }
      );
      setPayResult(result);
    } catch (e) {
      setPayErr(e.message);
    } finally {
      setPayLoading(false);
    }
  }, [irId4, payAmount4, payCurrency4, accessToken, appUserId]);

  // ── Step 5: Job Profitability ─────────────────────────────────────────────
  const [irId5, setIrId5] = useState("");
  const [profResult, setProfResult] = useState(null);
  const [profErr, setProfErr] = useState(null);
  const [profLoading, setProfLoading] = useState(false);

  const handleCaptureProfit = useCallback(async () => {
    if (!irId5.trim()) { setProfErr("invoice_request_id required"); return; }
    setProfLoading(true); setProfErr(null); setProfResult(null);
    try {
      const { fetchInvoiceRequestById } = await import("../../lib/serviceosWave5FinanceClient.js");
      const ir = await fetchInvoiceRequestById(irId5.trim(), accessToken);
      if (!ir) throw new Error(`invoice_request ${irId5.trim()} not found`);
      const result = await captureJobProfitabilitySnapshot(
        { organizationId: ir.organization_id, businessUnitId: ir.business_unit_id },
        ir,
        { accessToken, appUserId }
      );
      setProfResult(result);
    } catch (e) {
      setProfErr(e.message);
    } finally {
      setProfLoading(false);
    }
  }, [irId5, accessToken, appUserId]);

  // ── Step 6: Finance Status ────────────────────────────────────────────────
  const [jobId6, setJobId6] = useState("");
  const [statusResult, setStatusResult] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const handleLoadStatus = useCallback(async () => {
    if (!jobId6.trim()) { setStatusErr("operational_job_id required"); return; }
    setStatusLoading(true); setStatusErr(null); setStatusResult(null);
    try {
      const result = await loadWave5FinanceStatus(jobId6.trim(), { accessToken });
      setStatusResult(result);
    } catch (e) {
      setStatusErr(e.message);
    } finally {
      setStatusLoading(false);
    }
  }, [jobId6, accessToken]);

  return (
    <div style={styles.panel}>
      <h4 style={styles.heading}>
        💰 ServiceOS Wave 5 Finance Pilot
        <span style={styles.badge}>PREVIEW ONLY</span>
      </h4>

      {/* Step 1 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>1 · Billing Readiness Assessment</div>
        <input
          style={styles.input}
          placeholder="operational_job_id"
          value={jobId1}
          onChange={(e) => setJobId1(e.target.value)}
        />
        <button style={styles.btn} onClick={handleAssessBillingReadiness} disabled={gateLoading}>
          {gateLoading ? "…" : "Assess"}
        </button>
        <ResultBlock data={gateResult} error={gateErr} />
      </div>

      {/* Step 2 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>2 · Create/Freeze Invoice Request</div>
        <input style={styles.input} placeholder="billing_readiness_gate_id" value={gateId2} onChange={(e) => setGateId2(e.target.value)} />
        <input style={styles.input} placeholder="pricing_snapshot_id" value={psId2} onChange={(e) => setPsId2(e.target.value)} />
        <input style={styles.input} placeholder="quote_version_id" value={qvId2} onChange={(e) => setQvId2(e.target.value)} />
        <button style={styles.btn} onClick={handleCreateInvoiceRequest} disabled={irLoading}>
          {irLoading ? "…" : "Create Invoice Request"}
        </button>
        <ResultBlock data={irResult} error={irErr} />
      </div>

      {/* Step 3 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>3 · Accounting Sync (Preview Test Adapter)</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId3} onChange={(e) => setIrId3(e.target.value)} />
        <button style={styles.btn} onClick={handleEnqueueAccountingSync} disabled={syncLoading}>
          {syncLoading ? "…" : "Enqueue Sync"}
        </button>
        <ResultBlock data={syncResult} error={syncErr} />
      </div>

      {/* Step 4 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>4 · Observe Payment (Preview)</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId4} onChange={(e) => setIrId4(e.target.value)} />
        <input style={styles.input} placeholder="amount" value={payAmount4} onChange={(e) => setPayAmount4(e.target.value)} />
        <input style={styles.input} placeholder="currency (CAD)" value={payCurrency4} onChange={(e) => setPayCurrency4(e.target.value)} />
        <button style={styles.btn} onClick={handleObservePayment} disabled={payLoading}>
          {payLoading ? "…" : "Observe Payment"}
        </button>
        <ResultBlock data={payResult} error={payErr} />
      </div>

      {/* Step 5 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>5 · Capture Job Profitability</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId5} onChange={(e) => setIrId5(e.target.value)} />
        <button style={styles.btn} onClick={handleCaptureProfit} disabled={profLoading}>
          {profLoading ? "…" : "Capture Profitability"}
        </button>
        <ResultBlock data={profResult} error={profErr} />
      </div>

      {/* Step 6 */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>6 · Wave 5 Finance Status Contract</div>
        <input style={styles.input} placeholder="operational_job_id" value={jobId6} onChange={(e) => setJobId6(e.target.value)} />
        <button style={styles.btn} onClick={handleLoadStatus} disabled={statusLoading}>
          {statusLoading ? "…" : "Load Status"}
        </button>
        <ResultBlock data={statusResult} error={statusErr} />
      </div>
    </div>
  );
}
