import React, { useEffect, useState } from "react";
import { authenticatedRestFetch } from "../../lib/serviceosAuthClient.js";
import { sendNativeQuoteEmail } from "../../lib/serviceosQuoteDeliveryClient.js";

const styles = {
  panel: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18, marginBottom: 14, color: "#F5F8FC" },
  heading: { margin: "0 0 6px", fontSize: 19 },
  sub: { margin: "0 0 14px", color: "#AEBAC9", fontSize: 14, lineHeight: 1.55 },
  card: { background: "#0E1524", border: "1px solid #2A394E", borderRadius: 10, padding: 15, marginTop: 10 },
  row: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" },
  name: { fontWeight: 850 },
  small: { color: "#AEBAC9", fontSize: 12, marginTop: 4, lineHeight: 1.45 },
  quote: { whiteSpace: "pre-wrap", background: "#111B2B", border: "1px solid #26364C", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13, lineHeight: 1.55, maxHeight: 220, overflow: "auto" },
  button: { border: 0, borderRadius: 8, padding: "10px 14px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #52637A", borderRadius: 8, padding: "9px 13px", background: "#151D2C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  actions: { display: "flex", gap: 9, flexWrap: "wrap", marginTop: 12 },
  success: { marginTop: 10, padding: 10, borderRadius: 8, background: "#18392F", color: "#8EF1D8", fontSize: 13 },
  warning: { marginTop: 10, padding: 10, borderRadius: 8, background: "#3B3218", color: "#F1D986", fontSize: 13 },
  error: { marginTop: 10, padding: 10, borderRadius: 8, background: "#421E26", color: "#FFB3C0", fontSize: 13 },
};

async function getRows(path, token, fallback) {
  const response = await authenticatedRestFetch(path, token);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.message || fallback);
  return Array.isArray(data) ? data : [];
}

async function loadDeliveryQueue({ token, orgId, businessUnitId }) {
  if (!token || !orgId || !businessUnitId) return [];
  const versions = await getRows(
    `quote_version?select=id,quote_id,lifecycle_status,title,commercial_snapshot,line_items_snapshot,sent_at,created_at&organization_id=eq.${encodeURIComponent(orgId)}&business_unit_id=eq.${encodeURIComponent(businessUnitId)}&lifecycle_status=in.(draft,sent)&order=created_at.desc&limit=20`,
    token,
    "Unable to load quote delivery queue."
  );

  return Promise.all(versions.map(async (version) => {
    const quotes = await getRows(`quote?select=id,opportunity_id&id=eq.${encodeURIComponent(version.quote_id)}&limit=1`, token, "Unable to load quote lineage.");
    const opportunityId = quotes[0]?.opportunity_id;
    const opportunities = opportunityId ? await getRows(`opportunity?select=id,service_request_id&id=eq.${encodeURIComponent(opportunityId)}&limit=1`, token, "Unable to load quote opportunity.") : [];
    const serviceRequestId = opportunities[0]?.service_request_id;
    const requests = serviceRequestId ? await getRows(`service_request?select=id,title,requirements&id=eq.${encodeURIComponent(serviceRequestId)}&limit=1`, token, "Unable to load quote customer.") : [];
    const deliveries = await getRows(`quote_delivery?select=id,recipient_email,provider,provider_message_id,provider_accepted_at,decision_expires_at&quote_version_id=eq.${encodeURIComponent(version.id)}&order=created_at.desc&limit=1`, token, "Unable to load quote delivery evidence.");
    const decisions = await getRows(`customer_quote_decision?select=id,decision,notes,decided_at,source&quote_version_id=eq.${encodeURIComponent(version.id)}&limit=1`, token, "Unable to load customer quote decision.");
    const requirements = requests[0]?.requirements || {};
    return {
      ...version,
      serviceRequestId,
      customerName: requirements?.customer?.name || requests[0]?.title || "Customer",
      customerEmail: requirements?.customer?.email || "",
      delivery: deliveries[0] || null,
      customerDecision: decisions[0] || null,
    };
  }));
}

function decisionLabel(decision) {
  if (decision === "accepted") return "CUSTOMER CLICKED ACCEPT";
  if (decision === "requested_changes") return "CUSTOMER REQUESTED CHANGES";
  return null;
}

export default function ServiceOSQuoteDeliveryPanel({ session, revenueContext }) {
  const token = session?.access_token ?? null;
  const orgId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setLoading(true); setError("");
    try { setRows(await loadDeliveryQueue({ token, orgId, businessUnitId })); }
    catch (err) { setError(err?.message || "Unable to load quote delivery queue."); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [token, orgId, businessUnitId]);

  async function sendEmail(row) {
    if (busyId || !row?.id) return;
    setBusyId(row.id); setError(""); setNotice("");
    try {
      const result = await sendNativeQuoteEmail({ quoteVersionId: row.id, accessToken: token });
      setNotice(result.alreadySent ? `This quote was already emailed to ${result.delivery?.recipient_email || row.customerEmail}.` : `Quote emailed successfully to ${result.delivery?.recipient_email || row.customerEmail}.`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Unable to send quote email.");
    } finally { setBusyId(null); }
  }

  async function copyMessage(text) {
    try { await navigator.clipboard.writeText(String(text || "")); setNotice("Saved quote message copied."); }
    catch { setError("Unable to copy automatically. Select the saved quote text manually."); }
  }

  return (
    <section style={styles.panel} data-testid="serviceos-quote-delivery-panel">
      <h2 style={styles.heading}>Quote Delivery + Customer Decision</h2>
      <p style={styles.sub}>Send the exact saved ServiceOS quote by email. A quote becomes <strong>Sent</strong> only after the email provider accepts the customer address. The customer receives a secure <strong>Accept Quote / Request Changes</strong> link.</p>
      <div style={styles.actions}><button type="button" style={styles.secondary} onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh Quote Queue"}</button></div>
      {notice ? <div style={styles.success}>{notice}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}
      {!loading && !rows.length ? <div style={styles.small}>No draft or sent quotes are currently in the delivery queue.</div> : null}
      {rows.map((row) => {
        const quoteText = row.commercial_snapshot?.customerFacingText || "";
        const decision = decisionLabel(row.customerDecision?.decision);
        return (
          <article key={row.id} style={styles.card}>
            <div style={styles.row}>
              <div>
                <div style={styles.name}>{row.customerName}</div>
                <div style={styles.small}>{row.customerEmail || "No email on saved lead"}<br />Quote: {row.title || row.id}<br />Status: {row.lifecycle_status.toUpperCase()}</div>
              </div>
              <div style={styles.small}>{row.delivery ? `Email accepted ${new Date(row.delivery.provider_accepted_at).toLocaleString()}` : "Not yet delivered by ServiceOS email"}</div>
            </div>
            {decision ? <div style={row.customerDecision.decision === "accepted" ? styles.success : styles.warning}><strong>{decision}</strong>{row.customerDecision.notes ? <><br />{row.customerDecision.notes}</> : null}{row.customerDecision.decision === "accepted" ? <><br />Open Customer Response / Acceptance below and record Accepted to cross the authenticated Revenue → Operations boundary.</> : null}</div> : null}
            <div style={styles.quote}>{quoteText || "Saved customer-facing quote text unavailable."}</div>
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} onClick={() => copyMessage(quoteText)}>Copy Saved Quote</button>
              <button type="button" style={{ ...styles.button, ...((busyId === row.id || !!row.delivery || !row.customerEmail) ? styles.disabled : {}) }} disabled={busyId === row.id || !!row.delivery || !row.customerEmail} onClick={() => sendEmail(row)}>
                {busyId === row.id ? "Sending…" : row.delivery ? "Quote Email Sent" : "Send Quote by Email"}
              </button>
            </div>
            {!row.customerEmail ? <div style={styles.warning}>No customer email is saved. Use the existing external-send workflow for text/LSA, or update the lead before emailing.</div> : null}
          </article>
        );
      })}
      <div style={styles.small}>Security boundary: customer link responses are evidence of the customer’s decision. They do not anonymously create a job. Conversion and job handoff still require the authenticated ServiceOS acceptance action.</div>
    </section>
  );
}
