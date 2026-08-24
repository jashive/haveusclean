import React, { useEffect, useMemo, useState } from "react";
import {
  CUSTOMER_RESPONSE_OPTIONS,
  listSentQuoteVersions,
  recordCustomerResponse,
  responseCreatesConversion,
} from "../../lib/serviceosCustomerResponseClient.js";

const styles = {
  panel: { marginTop: 14, background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18 },
  heading: { margin: 0, fontSize: 20 },
  subheading: { margin: "5px 0 16px", color: "#9AA9BC", fontSize: 13, lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  span2: { gridColumn: "1 / -1" },
  label: { color: "#AEBAC9", fontSize: 12, fontWeight: 750 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3A4B62", borderRadius: 8, background: "#0E1524", color: "#F5F8FC", padding: "10px 11px", fontSize: 14 },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 },
  primary: { border: 0, borderRadius: 8, padding: "11px 15px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #3D516B", borderRadius: 8, padding: "10px 14px", background: "#202B3C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  disabled: { opacity: 0.48, cursor: "not-allowed" },
  note: { color: "#8FA0B5", fontSize: 12, marginTop: 8, lineHeight: 1.45 },
  error: { marginTop: 12, border: "1px solid #8E3540", background: "#35151A", color: "#FF9EAA", borderRadius: 8, padding: 12, fontSize: 13 },
  success: { marginTop: 12, border: "1px solid #2B7A68", background: "#102A26", color: "#60E7C6", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  warning: { marginTop: 12, border: "1px solid #C78A20", background: "#35270F", color: "#FFD78A", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
};

function getServiceRequest(row) {
  return row?.quote?.opportunity?.service_request || null;
}

function deriveCustomerFields(row) {
  const requirements = getServiceRequest(row)?.requirements || {};
  return {
    customerName: requirements?.customer?.name || "",
    customerEmail: requirements?.customer?.email || "",
    customerPhone: requirements?.customer?.phone || "",
    addressLine1: requirements?.location?.address || "",
    city: requirements?.location?.city || "",
    postalCode: requirements?.location?.postalCode || "",
  };
}

export default function ServiceOSCustomerResponsePanel({ session, revenueContext }) {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [responseType, setResponseType] = useState("accepted");
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState(deriveCustomerFields(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const accessToken = session?.access_token ?? null;
  const organizationId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const jurisdictionId = revenueContext?.primaryJurisdictionId ?? null;
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const converts = responseCreatesConversion(responseType);

  async function refresh() {
    if (!accessToken || !organizationId || !businessUnitId) return;
    setBusy(true);
    setError(null);
    try {
      const next = await listSentQuoteVersions({ accessToken, organizationId, businessUnitId });
      setRows(next);
      setSelectedId((current) => current && next.some((row) => row.id === current) ? current : (next[0]?.id || ""));
    } catch (err) {
      setError(err?.message || "Unable to load sent quotes.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, organizationId, businessUnitId]);

  useEffect(() => {
    setFields(deriveCustomerFields(selected));
    setNotes("");
    setResult(null);
    setError(null);
  }, [selectedId]);

  function setField(name, value) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submitResponse() {
    if (busy || !selectedId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (converts) {
        if (!fields.customerName.trim()) throw new Error("Accepted response requires the customer name.");
        if (!fields.customerEmail.trim() && !fields.customerPhone.trim()) throw new Error("Accepted response requires customer email or phone.");
        if (!fields.addressLine1.trim() || !fields.city.trim()) throw new Error("Accepted response requires service address and city.");
      }

      const recorded = await recordCustomerResponse({
        accessToken,
        quoteVersionId: selectedId,
        responseType,
        respondedByName: fields.customerName,
        respondedByEmail: fields.customerEmail,
        notes,
        customerName: fields.customerName,
        customerEmail: fields.customerEmail,
        customerPhone: fields.customerPhone,
        addressLine1: fields.addressLine1,
        city: fields.city,
        postalCode: fields.postalCode,
        jurisdictionId,
        metadata: { source: "serviceos_customer_response_ui" },
      });
      setResult(recorded);
      await refresh();
    } catch (err) {
      setError(err?.message || "Unable to record customer response.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={styles.panel} data-testid="serviceos-customer-response-panel">
      <h2 style={styles.heading}>Customer Response / Acceptance</h2>
      <p style={styles.subheading}>Record what the customer actually did after a quote was sent. Only <strong>Accepted</strong> can create the canonical conversion and ready Operations handoff.</p>

      <div style={styles.grid}>
        <label style={{ ...styles.field, ...styles.span2 }}>
          <span style={styles.label}>Sent quote</span>
          <select style={styles.input} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={busy || rows.length === 0}>
            {rows.length === 0 ? <option value="">No sent quotes awaiting response</option> : null}
            {rows.map((row) => <option key={row.id} value={row.id}>{getServiceRequest(row)?.title || row.title || row.id} · {row.id.slice(0, 8)}</option>)}
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Customer response</span>
          <select style={styles.input} value={responseType} onChange={(e) => { setResponseType(e.target.value); setResult(null); setError(null); }} disabled={!selectedId || busy}>
            {CUSTOMER_RESPONSE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label style={styles.field}><span style={styles.label}>Customer name</span><input style={styles.input} value={fields.customerName} onChange={(e) => setField("customerName", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Email</span><input style={styles.input} type="email" value={fields.customerEmail} onChange={(e) => setField("customerEmail", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Phone</span><input style={styles.input} value={fields.customerPhone} onChange={(e) => setField("customerPhone", e.target.value)} /></label>
        <label style={{ ...styles.field, ...styles.span2 }}><span style={styles.label}>Service address</span><input style={styles.input} value={fields.addressLine1} onChange={(e) => setField("addressLine1", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>City</span><input style={styles.input} value={fields.city} onChange={(e) => setField("city", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Postal code</span><input style={styles.input} value={fields.postalCode} onChange={(e) => setField("postalCode", e.target.value)} /></label>
        <label style={{ ...styles.field, ...styles.span2 }}><span style={styles.label}>Response notes</span><textarea style={{ ...styles.input, minHeight: 74, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional: customer's exact request, reason, or follow-up note" /></label>
      </div>

      {converts ? <div style={styles.warning}><strong>Acceptance boundary:</strong> recording Accepted will atomically create one accepted quote response, one conversion record, and one ready job handoff. Repeating the action returns the existing conversion/handoff instead of creating duplicates.</div> : <div style={styles.note}>This disposition records the customer state only. It cannot create a conversion record or job handoff.</div>}

      <div style={styles.actions}>
        <button type="button" style={{ ...styles.primary, ...((busy || !selectedId) ? styles.disabled : {}) }} disabled={busy || !selectedId} onClick={submitResponse}>{busy ? "Recording…" : `Record ${CUSTOMER_RESPONSE_OPTIONS.find((item) => item.value === responseType)?.label || "Response"}`}</button>
        <button type="button" style={{ ...styles.secondary, ...(busy ? styles.disabled : {}) }} disabled={busy} onClick={refresh}>Refresh Sent Quotes</button>
      </div>

      {error ? <div style={styles.error}><strong>Unable to continue:</strong> {error}</div> : null}
      {result ? (
        <div style={styles.success}>
          <strong>{responseType === "accepted" ? "Accepted and handed off." : "Response recorded."}</strong>
          {result?.idempotent_replay ? " Existing accepted conversion returned; no duplicate was created." : ""}
          {result?.conversion_record?.id ? <><br />Conversion: {result.conversion_record.id}</> : null}
          {result?.job_handoff?.id ? <><br />Ready job handoff: {result.job_handoff.id}</> : null}
        </div>
      ) : null}
    </section>
  );
}
