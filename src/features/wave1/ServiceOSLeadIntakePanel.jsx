import React, { useEffect, useMemo, useState } from "react";
import { listRecentInboundLeads, savePartialInboundLead } from "../../lib/serviceosLeadIntakeClient.js";
import ServiceOSLeadReviewDrawer from "./ServiceOSLeadReviewDrawer.jsx";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";

const initialForm = {
  customerName: "", phone: "", email: "", address: "", city: "", postalCode: "",
  propertyType: "", bedrooms: "", bathrooms: "", squareFeet: "", cleanType: "",
  frequency: "", preferredDate: "", preferredTime: "", leadSource: "Phone",
  externalSourceSystem: "", externalSourceId: "", notes: "",
};

const styles = {
  panel: { marginTop: 14, background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18 },
  heading: { margin: 0, fontSize: 20 },
  sub: { margin: "5px 0 16px", color: "#9AA9BC", fontSize: 13, lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  wide: { gridColumn: "1 / -1" },
  label: { color: "#AEBAC9", fontSize: 12, fontWeight: 750 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3A4B62", borderRadius: 8, background: "#0E1524", color: "#F5F8FC", padding: "10px 11px", fontSize: 14 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 },
  primary: { border: 0, borderRadius: 8, padding: "11px 15px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #3D516B", borderRadius: 8, padding: "10px 14px", background: "#202B3C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  note: { marginTop: 12, color: "#8FA0B5", fontSize: 12, lineHeight: 1.5 },
  success: { marginTop: 12, border: "1px solid #2B7A68", background: "#102A26", color: "#60E7C6", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  warning: { marginTop: 12, border: "1px solid #C78A20", background: "#35270F", color: "#FFD78A", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  error: { marginTop: 12, border: "1px solid #8E3540", background: "#35151A", color: "#FF9EAA", borderRadius: 8, padding: 12, fontSize: 13 },
  recent: { marginTop: 18, borderTop: "1px solid #28364A", paddingTop: 16 },
  recentRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", border: "1px solid #28364A", borderRadius: 8, padding: 10, marginTop: 8, background: "#0E1524" },
};

function leadLabel(row) {
  const sr = row?.service_request || {};
  const req = sr.requirements || {};
  const customer = req.customer || {};
  const location = req.location || {};
  return customer.name || sr.title || customer.email || customer.phone || location.address || sr.id || "Saved lead";
}

function canContinueRecentLead(row) {
  return row?.service_request?.lifecycle_status === "intake" && row?.opportunity?.stage === "open";
}

function isCommercialWalkthrough(row) {
  return row?.service_request?.lifecycle_status === "walkthrough_requested";
}

export default function ServiceOSLeadIntakePanel({ session, revenueContext }) {
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [continuationLead, setContinuationLead] = useState(null);
  const [error, setError] = useState(null);
  const [recentLeads, setRecentLeads] = useState([]);
  const [recentBusy, setRecentBusy] = useState(false);
  const [recentError, setRecentError] = useState(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStage, setLeadStage] = useState("all");

  const accessToken = session?.access_token || null;
  const organizationId = revenueContext?.orgId || null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId || null;

  const continuationRevenueContext = useMemo(() => {
    if (!continuationLead) return revenueContext;
    const serviceRequestBusinessUnitId = continuationLead?.service_request?.business_unit_id || null;
    const opportunityBusinessUnitId = continuationLead?.opportunity?.business_unit_id || null;
    if (!serviceRequestBusinessUnitId || serviceRequestBusinessUnitId !== opportunityBusinessUnitId) return revenueContext;
    const visibleRecords = Array.isArray(revenueContext?.businessUnitRecords) ? revenueContext.businessUnitRecords : [];
    const canonicalLeadBusinessUnit = visibleRecords.find((item) => item.id === serviceRequestBusinessUnitId) || null;
    if (!canonicalLeadBusinessUnit) return revenueContext;
    return {
      ...revenueContext,
      primaryBusinessUnitId: canonicalLeadBusinessUnit.id,
      primaryJurisdictionId: canonicalLeadBusinessUnit.jurisdictionId,
      activeBusinessUnitCode: canonicalLeadBusinessUnit.code,
      activeBusinessUnitName: canonicalLeadBusinessUnit.name,
    };
  }, [continuationLead, revenueContext]);

  async function refreshRecentLeads() {
    if (!accessToken || !organizationId || !businessUnitId) return;
    setRecentBusy(true);
    setRecentError(null);
    try {
      const rows = await listRecentInboundLeads({ accessToken, organizationId, businessUnitId });
      setRecentLeads(rows);
    } catch (err) {
      setRecentError(err?.message || "Unable to load recent leads.");
    } finally {
      setRecentBusy(false);
    }
  }

  useEffect(() => {
    setContinuationLead(null);
    setResult(null);
    refreshRecentLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, organizationId, businessUnitId]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setResult(null);
    setContinuationLead(null);
    setError(null);
  }

  async function saveLead() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setContinuationLead(null);
    try {
      const saved = await savePartialInboundLead({
        accessToken,
        organizationId,
        businessUnitId,
        intakeChannel: "office_partial_intake",
        leadSource: form.leadSource,
        externalSourceSystem: form.externalSourceSystem,
        externalSourceId: form.externalSourceId,
        customerName: form.customerName,
        customerPhone: form.phone,
        customerEmail: form.email,
        addressLine1: form.address,
        city: form.city,
        postalCode: form.postalCode,
        propertyType: form.propertyType,
        bedrooms: form.bedrooms,
        bathrooms: form.bathrooms,
        squareFeet: form.squareFeet,
        cleanType: form.cleanType,
        frequency: form.frequency,
        preferredDate: form.preferredDate,
        preferredTime: form.preferredTime,
        notes: form.notes,
        metadata: { source: "serviceos_save_lead_ui" },
      });
      setResult(saved);
      if (saved?.created) setForm(initialForm);
      await refreshRecentLeads();
    } catch (err) {
      setError(err?.message || "Unable to save lead.");
    } finally {
      setBusy(false);
    }
  }

  const canContinue = !!result?.service_request?.id && !!result?.opportunity?.id && !result?.duplicate_review_required;
  const visibleRecentLeads = useMemo(() => {
    const query = leadSearch.trim().toLowerCase();
    return recentLeads.filter((row) => {
      const serviceRequest = row?.service_request || {};
      const opportunity = row?.opportunity || {};
      const searchable = [leadLabel(row), serviceRequest?.requirements?.customer?.email, serviceRequest?.requirements?.customer?.phone, serviceRequest?.requirements?.location?.city].filter(Boolean).join(" ").toLowerCase();
      const stage = opportunity.stage || serviceRequest.lifecycle_status || "new";
      return (!query || searchable.includes(query)) && (leadStage === "all" || stage === leadStage);
    }).slice(0, 25);
  }, [recentLeads, leadSearch, leadStage]);

  function leadStatus(row) {
    const stage = row?.opportunity?.stage || row?.service_request?.lifecycle_status || "open";
    if (["won", "accepted", "converted"].includes(stage)) return { label: "WON", tone: "success" };
    if (["proposal", "estimate_sent", "quote_sent"].includes(stage)) return { label: "ESTIMATE SENT", tone: "info" };
    if (["contacted", "qualified", "walkthrough_requested"].includes(stage)) return { label: "CONTACTED", tone: "warning" };
    return { label: "NEW", tone: "neutral" };
  }

  return (
    <section style={styles.panel} data-testid="serviceos-partial-lead-intake">
      <h2 style={styles.heading}>Save Lead / Qualify Later</h2>
      <p style={styles.sub}>Capture an inbound lead immediately even when quote details are incomplete. This creates only the canonical intake request and open opportunity. Saved leads are reloaded from ServiceOS so the same record is available after refresh and on another device.</p>
      <div style={styles.grid}>
        <label style={styles.field}><span style={styles.label}>Customer name</span><input style={styles.input} value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Phone</span><input style={styles.input} value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Email</span><input style={styles.input} type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Lead source</span><input style={styles.input} value={form.leadSource} onChange={(e) => setField("leadSource", e.target.value)} placeholder="Phone, Google LSA, Referral…" /></label>
        <label style={styles.field}><span style={styles.label}>External source system</span><input style={styles.input} value={form.externalSourceSystem} onChange={(e) => setField("externalSourceSystem", e.target.value)} placeholder="gmail, google_lsa…" /></label>
        <label style={styles.field}><span style={styles.label}>External lead/reference ID</span><input style={styles.input} value={form.externalSourceId} onChange={(e) => setField("externalSourceId", e.target.value)} placeholder="Message or lead ID" /></label>
        <label style={{ ...styles.field, ...styles.wide }}><span style={styles.label}>Service address</span><input style={styles.input} value={form.address} onChange={(e) => setField("address", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>City</span><input style={styles.input} value={form.city} onChange={(e) => setField("city", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Postal code</span><input style={styles.input} value={form.postalCode} onChange={(e) => setField("postalCode", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Property type</span><input style={styles.input} value={form.propertyType} onChange={(e) => setField("propertyType", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Bedrooms</span><input style={styles.input} type="number" min="0" step="1" value={form.bedrooms} onChange={(e) => setField("bedrooms", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Bathrooms</span><input style={styles.input} type="number" min="0" step="0.5" value={form.bathrooms} onChange={(e) => setField("bathrooms", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Square feet</span><input style={styles.input} type="number" min="0" value={form.squareFeet} onChange={(e) => setField("squareFeet", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Cleaning/service type</span><input style={styles.input} value={form.cleanType} onChange={(e) => setField("cleanType", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Frequency</span><input style={styles.input} value={form.frequency} onChange={(e) => setField("frequency", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Preferred date</span><input style={styles.input} value={form.preferredDate} onChange={(e) => setField("preferredDate", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Preferred time</span><input style={styles.input} value={form.preferredTime} onChange={(e) => setField("preferredTime", e.target.value)} /></label>
        <label style={{ ...styles.field, ...styles.wide }}><span style={styles.label}>Lead notes / call summary</span><textarea style={{ ...styles.input, minHeight: 78, resize: "vertical" }} value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></label>
      </div>
      <div style={styles.actions}>
        <button type="button" style={{ ...styles.primary, opacity: busy ? 0.55 : 1 }} disabled={busy} onClick={saveLead}>{busy ? "Saving…" : "Save Lead / Qualify Later"}</button>
        <button type="button" style={styles.secondary} disabled={busy} onClick={() => { setForm(initialForm); setResult(null); setContinuationLead(null); setError(null); }}>Clear</button>
      </div>
      <div style={styles.note}>Duplicate order: external source ID first; then active phone/email; then exact active name/address. Phone/email or address matches are surfaced for staff review rather than silently creating another active lead.</div>
      {error ? <div style={styles.error}><strong>Unable to save:</strong> {error}</div> : null}
      {result?.duplicate_review_required ? <div style={styles.warning}><strong>Possible duplicate — review existing lead before quoting.</strong><br />Reason: {result.dedup_reason}<TechnicalDetails><span>Service request: {result.service_request?.id}</span></TechnicalDetails></div> : null}
      {result && !result.duplicate_review_required ? <div style={styles.success}><strong>{result.created ? "Lead captured and added to the follow-up queue." : "Existing source record returned; no duplicate created."}</strong>{canContinue ? <div style={styles.actions}><button type="button" style={styles.primary} onClick={() => setContinuationLead(result)}>Continue This Lead to Quote</button></div> : null}<TechnicalDetails><span>Service request: {result.service_request?.id}</span><span>Opportunity: {result.opportunity?.id || "Not available"}</span></TechnicalDetails></div> : null}

      <div style={styles.recent} data-testid="serviceos-recent-saved-leads">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div><strong>Recent Saved Leads</strong><div style={styles.note}>Canonical active-market leads from ServiceOS, including commercial walkthrough requests.</div></div>
          <button type="button" style={styles.secondary} disabled={recentBusy} onClick={refreshRecentLeads}>{recentBusy ? "Refreshing…" : "Refresh Leads"}</button>
        </div>
        <div className="admin-filter-bar" aria-label="Lead queue filters">
          <label className="admin-search-field"><span>Search leads</span><input type="search" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Name, email, phone, or city" /></label>
          <label className="admin-select-field"><span>Status</span><select value={leadStage} onChange={(event) => setLeadStage(event.target.value)}><option value="all">All active</option><option value="open">New</option><option value="contacted">Contacted</option><option value="proposal">Estimate sent</option><option value="won">Won</option><option value="walkthrough_requested">Walkthrough requested</option></select></label>
        </div>
        {recentError ? <div style={styles.error}><strong>Unable to load recent leads:</strong> {recentError}</div> : null}
        {!recentBusy && !recentError && visibleRecentLeads.length === 0 ? <div style={styles.note}>No active saved leads found for this market.</div> : null}
        <div className="admin-data-table" role="table" aria-label="Recent saved leads">
          <div className="admin-data-table__head" role="row"><span role="columnheader">Customer</span><span role="columnheader">Service</span><span role="columnheader">Status</span><span role="columnheader">Next action</span></div>
        {visibleRecentLeads.map((row) => {
          const continueAllowed = canContinueRecentLead(row);
          const walkthroughRequested = isCommercialWalkthrough(row);
          const status = leadStatus(row);
          const requirements = row?.service_request?.requirements || {};
          return (
            <div className="admin-data-table__row" role="row" key={row.service_request.id}>
              <div role="cell"><strong>{leadLabel(row)}</strong><small>{requirements?.customer?.email || requirements?.customer?.phone || "Contact details pending"}</small></div>
              <div role="cell"><span>{walkthroughRequested ? "Commercial walkthrough" : requirements?.scope?.cleanType || requirements?.scope?.packageKey || "Residential cleaning"}</span><small>{requirements?.location?.city || "Location pending"}</small></div>
              <div role="cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
              <div role="cell"><button type="button" className="admin-table-action" onClick={() => setContinuationLead(row)}>{walkthroughRequested ? "Schedule walkthrough" : "Open lead"}</button></div>
              {!continueAllowed && !walkthroughRequested ? <span className="admin-table-note">Use Customer Response / Acceptance for sent quotes instead of creating another quote.</span> : null}
              <TechnicalDetails summary="Technical details"><span>Lead lifecycle: {row.service_request.lifecycle_status}</span><span>Opportunity stage: {row.opportunity?.stage || "unknown"}</span><span>Service request: {row.service_request.id}</span></TechnicalDetails>
            </div>
          );
        })}
        </div>
      </div>

      <ServiceOSLeadReviewDrawer
        key={`${continuationLead?.service_request?.id || "closed"}:${continuationRevenueContext?.primaryBusinessUnitId || "no-bu"}`}
        lead={continuationLead}
        session={session}
        revenueContext={continuationRevenueContext}
        onClose={() => setContinuationLead(null)}
        onRefresh={refreshRecentLeads}
        onNavigate={(target) => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
    </section>
  );
}
