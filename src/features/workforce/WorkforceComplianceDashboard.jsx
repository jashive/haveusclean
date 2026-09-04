import React, { useCallback, useEffect, useMemo, useState } from "react";

const STAGES = [
  "Applicant",
  "Screening",
  "Documents Pending",
  "Training / Standards",
  "Compliance Approved",
  "ServiceOS Ready",
];

const styles = {
  shell: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18, marginBottom: 14 },
  header: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 16 },
  title: { margin: 0, fontSize: 19 },
  copy: { margin: "5px 0 0", color: "#AEBAC9", lineHeight: 1.5, fontSize: 14 },
  button: { border: "1px solid #2B7A68", borderRadius: 8, background: "#19352F", color: "#54E5C2", padding: "8px 11px", fontWeight: 800, cursor: "pointer" },
  disabledButton: { border: "1px solid #344359", borderRadius: 8, background: "#101827", color: "#6F7F94", padding: "8px 11px", fontWeight: 800 },
  error: { border: "1px solid #8E3A3A", background: "#351D22", borderRadius: 8, padding: 12, marginBottom: 14, color: "#FFC0C0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 },
  stage: { border: "1px solid #344359", borderRadius: 10, background: "#101827", minHeight: 130, padding: 10 },
  stageTitle: { fontSize: 12, color: "#8291A6", fontWeight: 850, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 },
  candidate: { width: "100%", textAlign: "left", border: "1px solid #2B405C", borderRadius: 8, background: "#182336", color: "#F5F8FC", padding: 10, marginBottom: 7, cursor: "pointer" },
  muted: { color: "#8291A6", fontSize: 12 },
  inspector: { marginTop: 16, borderTop: "1px solid #344359", paddingTop: 16 },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 },
  panel: { border: "1px solid #344359", borderRadius: 10, padding: 12, background: "#101827" },
  row: { padding: "8px 0", borderBottom: "1px solid #243149", fontSize: 13 },
  badge: { display: "inline-flex", padding: "3px 7px", borderRadius: 999, background: "#19352F", color: "#54E5C2", fontSize: 11, fontWeight: 800, marginLeft: 6 },
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function WorkforceComplianceDashboard({ session, revenueContext }) {
  const accessToken = session?.access_token || null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId || null;
  const businessUnitCode = revenueContext?.activeBusinessUnitCode || revenueContext?.businessUnits?.[0] || "HUC";
  const [pipeline, setPipeline] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [applicantInspector, setApplicantInspector] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const candidates = safeArray(pipeline?.candidates);
  const byStage = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage, candidates.filter((item) => item.pipeline_stage === stage)])), [candidates]);

  const api = useCallback(async (url, options = {}) => {
    if (!accessToken) throw new Error("Workforce dashboard requires an authenticated ServiceOS session.");
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) throw new Error(data?.error || "Workforce request failed.");
    return data;
  }, [accessToken]);

  const loadPipeline = useCallback(async () => {
    if (!businessUnitId || !accessToken) return;
    setLoading(true); setError(null);
    try {
      const data = await api(`/api/workforce/dashboard?action=pipeline&businessUnitId=${encodeURIComponent(businessUnitId)}`);
      setPipeline(data.pipeline || null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [api, businessUnitId, accessToken]);

  useEffect(() => { setSelectedId(null); setInspector(null); setApplicantInspector(null); loadPipeline(); }, [loadPipeline]);

  async function inspect(candidate) {
    const id = candidate.engagement_id || candidate.applicant_submission_id;
    if (!id) return;
    setSelectedId(id); setInspector(null); setApplicantInspector(null); setError(null);
    try {
      if (candidate.engagement_id) {
        const data = await api(`/api/workforce/dashboard?action=inspector&businessUnitId=${encodeURIComponent(businessUnitId)}&engagementId=${encodeURIComponent(candidate.engagement_id)}`);
        setInspector(data.inspector || null);
      } else {
        const data = await api(`/api/workforce/dashboard?action=applicant_inspector&businessUnitId=${encodeURIComponent(businessUnitId)}&applicantSubmissionId=${encodeURIComponent(candidate.applicant_submission_id)}`);
        setApplicantInspector(data.applicantInspector || null);
      }
    } catch (err) { setError(err.message); }
  }

  async function openEvidence(evidenceId) {
    setError(null);
    try {
      const data = await api(`/api/workforce/dashboard?action=evidence&businessUnitId=${encodeURIComponent(businessUnitId)}&evidenceId=${encodeURIComponent(evidenceId)}`);
      if (data.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) { setError(err.message); }
  }

  async function openApplicantDocument(documentCaptureId) {
    setError(null);
    try {
      const data = await api(`/api/workforce/dashboard?action=applicant_evidence&businessUnitId=${encodeURIComponent(businessUnitId)}&documentCaptureId=${encodeURIComponent(documentCaptureId)}`);
      if (data.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) { setError(err.message); }
  }

  async function activate() {
    if (!inspector?.engagement_id) return;
    setLoading(true); setError(null);
    try {
      const key = `w9-ui-${inspector.engagement_id}-${Date.now()}`;
      const data = await api("/api/workforce/dashboard", {
        method: "POST",
        body: JSON.stringify({ action: "activate", businessUnitId, engagementId: inspector.engagement_id, idempotencyKey: key }),
      });
      if (data.activation?.activation_status !== "succeeded") throw new Error(`Activation ${data.activation?.activation_status || "did not succeed"}.`);
      await loadPipeline();
      await inspect({ engagement_id: inspector.engagement_id });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <section style={styles.shell} data-workforce-dashboard="true" data-business-unit={businessUnitCode}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Workforce Onboarding & Compliance</h2>
          <p style={styles.copy}>HEMS governs recruiting, evidence, training, compliance and approval. ServiceOS receives a worker only through the controlled activation bridge. Newly activated workers remain <strong>NOT_AVAILABLE</strong> until Operations separately enables availability.</p>
        </div>
        <button type="button" style={styles.button} onClick={loadPipeline} disabled={loading}>{loading ? "Refreshing…" : `Refresh ${businessUnitCode}`}</button>
      </div>
      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
      <div style={styles.grid} aria-label="Workforce onboarding pipeline">
        {STAGES.map((stage) => (
          <div key={stage} style={styles.stage}>
            <div style={styles.stageTitle}>{stage} · {byStage[stage]?.length || 0}</div>
            {(byStage[stage] || []).map((candidate) => (
              <button key={`${candidate.applicant_submission_id || "a"}-${candidate.engagement_id || "e"}`} type="button" style={styles.candidate} onClick={() => inspect(candidate)}>
                <div style={{ fontWeight: 800 }}>{candidate.display_name || candidate.applicant_reference}</div>
                <div style={styles.muted}>{candidate.applied_role_code || "Applicant"}{candidate.engagement_type ? ` · ${candidate.engagement_type}` : ""}</div>
                {candidate.availability_status ? <span style={styles.badge}>{candidate.availability_status}</span> : null}
              </button>
            ))}
            {(byStage[stage] || []).length === 0 ? <div style={styles.muted}>No records</div> : null}
          </div>
        ))}
      </div>

      {selectedId && !inspector && !applicantInspector ? <div style={{ ...styles.muted, marginTop: 14 }}>Loading compliance inspector…</div> : null}
      {applicantInspector ? (
        <div style={styles.inspector} data-applicant-inspector="true">
          <div style={styles.header}>
            <div>
              <h3 style={{ margin: 0 }}>{applicantInspector.display_name}</h3>
              <p style={styles.copy}>{applicantInspector.applicant_reference} · {applicantInspector.current_stage} · {applicantInspector.applied_role_code}</p>
            </div>
            <button type="button" style={styles.disabledButton} disabled title="Screening, training, and compliance approval are required first">Activate to ServiceOS</button>
          </div>
          <div style={styles.twoCol}>
            <div style={styles.panel}>
              <strong>Applicant details</strong>
              <div style={styles.row}><strong>Email</strong><div style={styles.muted}>{applicantInspector.email}</div></div>
              <div style={styles.row}><strong>Phone</strong><div style={styles.muted}>{applicantInspector.phone}</div></div>
              <div style={styles.row}><strong>Address</strong><div style={styles.muted}>{applicantInspector.residential_address}</div></div>
              <div style={styles.row}><strong>Experience</strong><div style={styles.muted}>{applicantInspector.experience_summary}</div></div>
              <div style={styles.row}><strong>Availability</strong><div style={styles.muted}>{applicantInspector.availability_schedule}</div></div>
              <div style={styles.row}><strong>Background consent v1.0</strong><span style={styles.badge}>{applicantInspector.background_consent_recorded ? "recorded" : "missing"}</span></div>
            </div>
            <div style={styles.panel}>
              <strong>Applicant documents</strong>
              <div style={{ ...styles.muted, marginTop: 6, marginBottom: 8 }}>Early uploads remain quarantined until governed compliance review.</div>
              {safeArray(applicantInspector.documents).map((item) => <div key={item.document_capture_id} style={styles.row}>
                <div><strong>{item.document_code}</strong> <span style={styles.badge}>{item.capture_status}</span></div>
                <div style={styles.muted}>Uploaded {item.uploaded_at ? new Date(item.uploaded_at).toLocaleString() : "—"}</div>
                {item.viewable ? <button type="button" style={{ ...styles.button, marginTop: 6 }} onClick={() => openApplicantDocument(item.document_capture_id)}>Open restricted document (2 min)</button> : null}
              </div>)}
              {safeArray(applicantInspector.documents).length === 0 ? <div style={{ ...styles.muted, marginTop: 8 }}>No documents uploaded.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {inspector ? (
        <div style={styles.inspector}>
          <div style={styles.header}>
            <div><h3 style={{ margin: 0 }}>{inspector.display_name}</h3><p style={styles.copy}>{inspector.engagement_type} · {inspector.legal_classification} · {inspector.engagement_status}</p></div>
            <button type="button" style={inspector.readiness?.status === "ready" ? styles.button : styles.disabledButton} disabled={loading || inspector.readiness?.status !== "ready"} onClick={activate}>Activate to ServiceOS</button>
          </div>
          <div style={styles.twoCol}>
            <div style={styles.panel}>
              <strong>Documents & Compliance</strong>
              {safeArray(inspector.documents).map((item) => <div key={item.evidence_id} style={styles.row}><div><strong>{item.requirement_code}</strong> <span style={styles.badge}>{item.status}</span></div><div style={styles.muted}>Review: {item.review_decision || "pending"}{item.expiry_date ? ` · expires ${item.expiry_date} · ${item.days_remaining} days` : ""}</div>{item.evidence_accessible ? <button type="button" style={{ ...styles.button, marginTop: 6 }} onClick={() => openEvidence(item.evidence_id)}>Open verified evidence</button> : null}</div>)}
              {safeArray(inspector.documents).length === 0 ? <div style={{ ...styles.muted, marginTop: 8 }}>No document evidence yet.</div> : null}
            </div>
            <div style={styles.panel}>
              <strong>Training & Standards</strong>
              {safeArray(inspector.certifications).map((item) => <div key={`${item.module_code}-${item.completed_at}`} style={styles.row}><div><strong>{item.title || item.module_code}</strong> <span style={styles.badge}>{item.status}</span></div><div style={styles.muted}>Score: {item.score ?? "—"} / minimum {item.minimum_score ?? "—"} · practical: {item.practical_observation || "—"}{item.expiry_date ? ` · expires ${item.expiry_date}` : ""}</div></div>)}
              {safeArray(inspector.certifications).length === 0 ? <div style={{ ...styles.muted, marginTop: 8 }}>No verified certifications yet.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
