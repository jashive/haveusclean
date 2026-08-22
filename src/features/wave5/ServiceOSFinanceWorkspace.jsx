import React, { useMemo, useState } from "react";
import { authenticatedRestFetchWithRefresh } from "../../lib/serviceosAuthClient.js";
import {
  assessBillingReadiness,
  createAndFreezeInvoiceRequest,
} from "../../lib/serviceosWave5Runtime.js";

const FINANCE_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED === "true";

const styles = {
  card: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18, marginTop: 14 },
  title: { margin: "0 0 8px", fontSize: 18 },
  text: { margin: 0, color: "#AEBAC9", fontSize: 14, lineHeight: 1.55 },
  form: { display: "grid", gap: 10, marginTop: 14 },
  input: { background: "#0A0F1E", color: "#F5F8FC", border: "1px solid #344359", borderRadius: 8, padding: "10px 12px" },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" },
  button: { border: 0, borderRadius: 8, padding: "10px 14px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #55657A", borderRadius: 8, padding: "10px 14px", background: "#151D2C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  disabled: { opacity: 0.45, cursor: "not-allowed" },
  status: { marginTop: 12, color: "#54E5C2", fontWeight: 800, fontSize: 13 },
  error: { marginTop: 12, color: "#FF9B9B", whiteSpace: "pre-wrap", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 14 },
  stat: { background: "#0F1624", border: "1px solid #28364A", borderRadius: 8, padding: 12 },
  label: { color: "#8291A6", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" },
  value: { marginTop: 5, overflowWrap: "anywhere", fontWeight: 750 },
};

async function fetchOne(path) {
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res?.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Finance upstream read failed: HTTP ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}

async function fetchMany(path) {
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res?.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Finance upstream read failed: HTTP ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export default function ServiceOSFinanceWorkspace({ revenueContext }) {
  const [jobId, setJobId] = useState("");
  const [caseData, setCaseData] = useState(null);
  const [gate, setGate] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const role = revenueContext?.roleCode ?? "unknown";
  const financeAuthorized = FINANCE_ENABLED && role === "finance";

  const blockers = useMemo(() => {
    if (!caseData) return [];
    const list = [];
    if (!["qa_passed", "closed"].includes(caseData.job?.operational_status)) list.push("Job has not passed QA.");
    if (!["qa_complete", "closed"].includes(caseData.workOrder?.work_order_status)) list.push("Work order has not completed QA.");
    const open = (caseData.correctiveActions || []).filter((ca) => !["verified", "cancelled"].includes(ca.action_status));
    if (open.length) list.push(`${open.length} blocking corrective action(s) remain.`);
    if (!caseData.handoff?.id) list.push("Canonical operational handoff is missing.");
    if (!caseData.job?.pricing_snapshot_id) list.push("Pricing snapshot lineage is missing.");
    if (!caseData.job?.quote_version_id) list.push("Quote version lineage is missing.");
    return list;
  }, [caseData]);

  if (!financeAuthorized) return null;

  async function loadCase() {
    const id = jobId.trim();
    if (!id) return;
    setBusy(true);
    setError("");
    setGate(null);
    setInvoice(null);
    try {
      const job = await fetchOne(`operational_job?id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!job) throw new Error("Operational job not found or not visible to Finance.");
      const workOrder = await fetchOne(`work_order?operational_job_id=eq.${encodeURIComponent(id)}&limit=1`);
      const handoff = await fetchOne(`operational_handoff?operational_job_id=eq.${encodeURIComponent(id)}&limit=1`);
      const correctiveActions = await fetchMany(`corrective_action?operational_job_id=eq.${encodeURIComponent(id)}&order=created_at.asc`);
      const pricingSnapshot = job.pricing_snapshot_id
        ? await fetchOne(`pricing_snapshot?id=eq.${encodeURIComponent(job.pricing_snapshot_id)}&limit=1`)
        : null;
      const quoteVersion = job.quote_version_id
        ? await fetchOne(`quote_version?id=eq.${encodeURIComponent(job.quote_version_id)}&limit=1`)
        : null;
      const conversionRecord = job.conversion_record_id
        ? await fetchOne(`conversion_record?id=eq.${encodeURIComponent(job.conversion_record_id)}&limit=1`)
        : null;
      setCaseData({ job, workOrder, handoff, correctiveActions, pricingSnapshot, quoteVersion, conversionRecord });
    } catch (e) {
      setCaseData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function assess() {
    if (!caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      const result = await assessBillingReadiness(
        {
          organizationId: caseData.job.organization_id,
          businessUnitId: caseData.job.business_unit_id,
          jurisdictionId: caseData.job.jurisdiction_id ?? null,
        },
        caseData.job,
        caseData.workOrder,
        caseData.handoff,
        caseData.correctiveActions,
        { appUserId: revenueContext?.appUserId ?? null }
      );
      setGate(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function freezeInvoice() {
    if (!gate || gate.gate_status !== "ready" || !caseData?.pricingSnapshot) return;
    setBusy(true);
    setError("");
    try {
      const result = await createAndFreezeInvoiceRequest(
        {
          organizationId: gate.organization_id,
          businessUnitId: gate.business_unit_id,
          jurisdictionId: gate.jurisdiction_id ?? null,
        },
        gate,
        caseData.pricingSnapshot,
        caseData.quoteVersion,
        caseData.conversionRecord,
        { appUserId: revenueContext?.appUserId ?? null }
      );
      setInvoice(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={styles.card} data-serviceos-finance-workspace="true">
      <h2 style={styles.title}>Wave 5 Finance</h2>
      <p style={styles.text}>Finance-only controlled workspace. This surface can assess billing readiness and freeze an invoice request from accepted pricing. QuickBooks send, payment creation, and contractor payout execution are not available here.</p>

      <div style={styles.form}>
        <label>
          <div style={styles.label}>Operational job ID</div>
          <input style={styles.input} value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="Operational job UUID" />
        </label>
        <div style={styles.actions}>
          <button type="button" style={{ ...styles.secondary, ...(busy ? styles.disabled : {}) }} onClick={loadCase} disabled={busy}>Load Finance Case</button>
          <button type="button" style={{ ...styles.button, ...((busy || !caseData) ? styles.disabled : {}) }} onClick={assess} disabled={busy || !caseData}>Assess Billing Readiness</button>
          <button type="button" style={{ ...styles.button, ...((busy || gate?.gate_status !== "ready" || Boolean(invoice)) ? styles.disabled : {}) }} onClick={freezeInvoice} disabled={busy || gate?.gate_status !== "ready" || Boolean(invoice)}>Create Frozen Invoice Request</button>
        </div>
      </div>

      {caseData ? (
        <div style={styles.grid}>
          <div style={styles.stat}><div style={styles.label}>Job</div><div style={styles.value}>{caseData.job?.operational_status ?? "Unavailable"}</div></div>
          <div style={styles.stat}><div style={styles.label}>Work order</div><div style={styles.value}>{caseData.workOrder?.work_order_status ?? "Unavailable"}</div></div>
          <div style={styles.stat}><div style={styles.label}>Corrective blockers</div><div style={styles.value}>{blockers.length}</div></div>
          <div style={styles.stat}><div style={styles.label}>Billing gate</div><div style={styles.value}>{gate?.gate_status ?? "Not assessed"}</div></div>
          <div style={styles.stat}><div style={styles.label}>Invoice request</div><div style={styles.value}>{invoice?.request_status ?? "Not created"}</div></div>
          <div style={styles.stat}><div style={styles.label}>Frozen total</div><div style={styles.value}>{invoice ? `${invoice.currency_code} ${invoice.total_amount}` : "Not created"}</div></div>
        </div>
      ) : null}

      {blockers.length ? <div style={styles.error}>{blockers.join("\n")}</div> : null}
      {gate ? <div style={styles.status}>Billing readiness: {gate.gate_status}</div> : null}
      {invoice ? <div style={styles.status}>Frozen invoice request created: {invoice.id}</div> : null}
      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
    </section>
  );
}
