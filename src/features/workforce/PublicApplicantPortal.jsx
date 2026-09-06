import React, { useEffect, useMemo, useRef, useState } from "react";
import ApplicantTrainingPlayer from "./ApplicantTrainingPlayer.jsx";
import { Button, StatusBadge } from "../../components/ui.jsx";

const PROGRAMS = {
  ON: { label: "Ontario", code: "HUC_ON_RESIDENTIAL_CLEANER", role: "residential_cleaner", currency: "CAD", standards: "WHMIS and Have Us Clean residential standards" },
  AZ: { label: "Arizona", code: "HUC_AZ_RESIDENTIAL_CLEANER", role: "residential_cleaner", currency: "USD", standards: "independent-contractor and 1099 compliance" },
};
const DOCUMENTS = [
  { code: "GOV_ID", name: "governmentId", label: "Government photo ID", description: "A clear image or PDF of a current government-issued ID." },
  { code: "PROOF_OF_INSURANCE_BONDING", name: "insurance", label: "Insurance / bonding", description: "Upload current proof if available for your worker classification." },
];
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const APPLICANT_SESSION_KEY = "huc_applicant_session_v1";

function validApplicantSession(value) {
  return /^APP-[A-Z0-9]+$/.test(String(value?.applicantReference || ""))
    && String(value?.applicantAccessToken || "").length >= 24;
}

function resumeUrl(session) {
  if (!validApplicantSession(session) || typeof window === "undefined") return "";
  const url = new URL("/apply", window.location.origin);
  url.hash = new URLSearchParams({ ref: session.applicantReference, token: session.applicantAccessToken }).toString();
  return url.toString();
}

function readApplicantSession() {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const linked = { applicantReference: hash.get("ref"), applicantAccessToken: hash.get("token") };
  if (validApplicantSession(linked)) return linked;
  try {
    const stored = JSON.parse(window.localStorage.getItem(APPLICANT_SESSION_KEY) || "null");
    return validApplicantSession(stored) ? stored : null;
  } catch { return null; }
}

function persistApplicantSession(session) {
  if (!validApplicantSession(session) || typeof window === "undefined") return;
  window.localStorage.setItem(APPLICANT_SESSION_KEY, JSON.stringify({
    applicantReference: session.applicantReference,
    applicantAccessToken: session.applicantAccessToken,
  }));
  window.history.replaceState(null, "", resumeUrl(session));
}

function requestKey(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}
function toE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `1${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? `+${normalized}` : "";
}
function readableBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
function validateFile(item, file) {
  if (!file || !ACCEPTED_TYPES.includes(file.type)) return `${item.label} must be a PDF, JPG, or PNG.`;
  if (!file.size || file.size > MAX_FILE_BYTES) return `${item.label} must be smaller than 10 MB.`;
  return "";
}
async function api(body) {
  const response = await fetch("/api/workforce/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || "The request could not be completed.");
  return data;
}
async function uploadDocument(session, item, file, onProgress) {
  const validationError = validateFile(item, file);
  if (validationError) throw new Error(validationError);
  onProgress({ phase: "uploading", message: "Preparing secure upload…" });
  const signed = await api({ action: "sign_upload", applicantReference: session.applicantReference, applicantAccessToken: session.applicantAccessToken, documentCode: item.code, fileName: file.name, mimeType: file.type, byteSize: file.size, idempotencyKey: requestKey(`intent-${item.code}`) });
  onProgress({ phase: "uploading", message: "Uploading to the private vault…" });
  const upload = await fetch(signed.upload.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
  if (!upload.ok) throw new Error(`${item.label} could not be uploaded securely.`);
  onProgress({ phase: "uploading", message: "Verifying protected file…" });
  await api({ action: "finalize_upload", applicantReference: session.applicantReference, applicantAccessToken: session.applicantAccessToken, uploadIntentId: signed.upload.uploadIntentId, idempotencyKey: requestKey(`finalize-${item.code}`) });
  onProgress({ phase: "verified", message: "Quarantined & verified" });
}

function FlowSteps({ submitted = false }) {
  const items = ["Application Intake", "Document Quarantine Vault", "Video Training Player", "Compliance Status"];
  return <nav className="apply-journey" aria-label="Candidate onboarding progress"><ol>{items.map((label, index) => {
    const complete = submitted && index < 2;
    const current = submitted ? index === 2 : index === 0;
    return <li key={label} className={complete ? "is-complete" : current ? "is-current" : ""} aria-current={current ? "step" : undefined}><span aria-hidden="true">{complete ? "✓" : index + 1}</span><small>{label}</small></li>;
  })}</ol></nav>;
}

function DocumentUploadZone({ item, file, status, disabled, onSelect }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const phase = status?.phase || (file ? "selected" : "empty");
  const tone = phase === "verified" ? "success" : phase === "error" ? "danger" : phase === "uploading" ? "info" : "neutral";
  const label = phase === "verified" ? "Quarantined & verified" : phase === "error" ? "Error / retry" : phase === "uploading" ? "Uploading" : file ? "Ready to upload" : "Empty";
  function acceptFile(nextFile) {
    const validationError = validateFile(item, nextFile);
    onSelect(nextFile || null, validationError ? { phase: "error", message: validationError } : null);
  }
  return <div className={`document-zone ${dragging ? "is-dragging" : ""} is-${phase}`}>
    <div className="document-zone__heading"><div className="document-zone__icon" aria-hidden="true">{phase === "verified" ? "✓" : "↑"}</div><StatusBadge tone={tone}>{label}</StatusBadge></div>
    <strong>{item.label}</strong><p>{item.description}</p>
    <input ref={inputRef} className="visually-hidden" name={item.name} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={disabled || phase === "verified"} onChange={(event) => acceptFile(event.target.files?.[0])} />
    <div className="document-zone__drop" onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) acceptFile(event.dataTransfer.files?.[0]); }}>
      {file ? <span><b>{file.name}</b><small>{readableBytes(file.size)}</small></span> : <span><b>Drop your file here</b><small>PDF, JPG or PNG · maximum 10 MB</small></span>}
      <Button type="button" variant="secondary" disabled={disabled || phase === "verified"} onClick={() => inputRef.current?.click()}>{file ? "Choose another file" : "Browse files"}</Button>
    </div>
    {status?.message ? <p className={`document-zone__message is-${tone}`} role={phase === "error" ? "alert" : "status"}>{status.message}</p> : null}
  </div>;
}

export default function PublicApplicantPortal() {
  const [result, setResult] = useState(readApplicantSession);
  const [market, setMarket] = useState("ON");
  const [state, setState] = useState(() => result ? "success" : "idle");
  const [error, setError] = useState("");
  const [files, setFiles] = useState({});
  const [uploads, setUploads] = useState({});
  const submissionKey = useRef(requestKey("public-apply"));
  const program = PROGRAMS[market];
  const marketOptions = useMemo(() => Object.entries(PROGRAMS), []);
  useEffect(() => { if (result) persistApplicantSession(result); }, [result]);
  function selectFile(item, file, status) {
    setFiles((current) => ({ ...current, [item.code]: file }));
    setUploads((current) => ({ ...current, [item.code]: status }));
  }
  async function submit(event) {
    event.preventDefault(); setState("submitting"); setError("");
    const values = new FormData(event.currentTarget);
    const phoneE164 = toE164(values.get("phone"));
    if (!phoneE164) { setState("idle"); setError("Enter a valid phone number, including area code."); return; }
    const missing = DOCUMENTS.find((item) => !files[item.code]);
    if (missing) { setState("idle"); setError(`Choose a file for ${missing.label}.`); return; }
    try {
      const response = await api({ action: "apply", programCode: program.code, legalName: values.get("legalName"), email: values.get("email"), phoneE164, residentialAddress: values.get("address"), experienceSummary: values.get("experience"), availabilitySchedule: values.get("availability"), appliedRoleCode: program.role, privacyNoticeVersion: "1.0", backgroundConsentVersion: "1.0", privacyAccepted: values.get("privacyAccepted") === "on", backgroundConsentAccepted: values.get("backgroundConsentAccepted") === "on", consentToContact: true, idempotencyKey: submissionKey.current, website: values.get("website") });
      const session = response.application;
      persistApplicantSession(session);
      for (const item of DOCUMENTS) {
        try { await uploadDocument(session, item, files[item.code], (status) => setUploads((current) => ({ ...current, [item.code]: status }))); }
        catch (uploadError) { setUploads((current) => ({ ...current, [item.code]: { phase: "error", message: uploadError.message } })); throw uploadError; }
      }
      setResult(session); setState("success");
    } catch (err) { setError(`${err.message || "Your application could not be submitted."} Your selections are retained so you can retry.`); setState("idle"); }
  }
  return <main className="candidate-portal">
    <div className="candidate-shell">
      <section className="candidate-hero"><p className="candidate-kicker">Join the Have Us Clean team</p><h1>Build a cleaner future with us.</h1><p>Apply, secure your documents, and complete orientation in one guided experience. No account is required.</p></section>
      <FlowSteps submitted={state === "success"} />
      {state === "success" ? <div className="candidate-success">
        <section className="candidate-card candidate-card--success" aria-labelledby="application-title"><div className="candidate-success__mark" aria-hidden="true">✓</div><div><StatusBadge tone="success">Application received</StatusBadge><h2 id="application-title">Welcome to candidate orientation</h2><p>Your application and protected documents are now in Owner/Admin screening.</p><div className="candidate-reference"><span>Private reference code</span><strong>{result?.applicantReference}</strong></div><div className="candidate-resume"><div><strong>Resume onboarding anytime</strong><p>Bookmark this private link. We also sent it to the email address on your application.</p></div><a className="huc-button huc-button--secondary" href={resumeUrl(result)}>Resume Onboarding</a></div>{result?.resumeEmailStatus === "failed" ? <p className="candidate-alert candidate-alert--warning" role="status">We could not send the resume email. Bookmark or copy the private link above before leaving this page.</p> : null}</div></section>
        <ApplicantTrainingPlayer session={result} request={api} />
        <section className="compliance-status" aria-labelledby="compliance-title"><div><p className="candidate-kicker">Step 4</p><h2 id="compliance-title">Compliance status</h2></div><StatusBadge tone="warning">Screening in progress</StatusBadge><p>Video completion satisfies the orientation milestone only. Document review, screening, practical observation, and compliance approval remain required before ServiceOS activation.</p></section>
      </div> : <form onSubmit={submit} className="candidate-card candidate-form" aria-labelledby="application-title">
        <div className="candidate-section-heading"><span>01</span><div><p className="candidate-kicker">Application intake</p><h2 id="application-title">Tell us about yourself</h2><p>Choose where you want to work, then provide the details our recruiting team needs.</p></div></div>
        <div className="candidate-market-grid">{marketOptions.map(([code, item]) => <button key={code} type="button" className="candidate-market" aria-pressed={market === code} onClick={() => setMarket(code)}><span className="candidate-market__check" aria-hidden="true">{market === code ? "✓" : ""}</span><strong>{item.label}</strong><small>{item.currency} · {item.standards}</small></button>)}</div>
        <div className="candidate-form-grid">
          <label className="huc-field"><span className="huc-field__label">Full legal name</span><input name="legalName" required maxLength="200" autoComplete="name" /></label><label className="huc-field"><span className="huc-field__label">Email address</span><input name="email" type="email" required maxLength="320" autoComplete="email" /></label>
          <label className="huc-field"><span className="huc-field__label">Phone number</span><input name="phone" type="tel" required maxLength="24" autoComplete="tel" placeholder="(905) 555-0123" /></label><label className="huc-field"><span className="huc-field__label">Market</span><select value={market} onChange={(event) => setMarket(event.target.value)}>{marketOptions.map(([code, item]) => <option key={code} value={code}>{item.label}</option>)}</select></label>
          <label className="huc-field candidate-form__wide"><span className="huc-field__label">Residential address</span><textarea name="address" required maxLength="500" rows="3" autoComplete="street-address" /></label><label className="huc-field candidate-form__wide"><span className="huc-field__label">Residential cleaning experience</span><textarea name="experience" required maxLength="2000" rows="4" placeholder="Tell us how long you have cleaned professionally and the types of homes or services you know." /></label><label className="huc-field candidate-form__wide"><span className="huc-field__label">Availability schedule</span><textarea name="availability" required maxLength="1200" rows="3" placeholder="List the days and times you are normally available, including weekends if applicable." /></label>
        </div>
        <section className="candidate-form-section" aria-labelledby="vault-title"><div className="candidate-section-heading"><span>02</span><div><p className="candidate-kicker">Document quarantine vault</p><h2 id="vault-title">Secure verification documents</h2><p>Files upload directly to restricted applicant storage and stay quarantined until governed review.</p></div></div><div className="document-zone-grid">{DOCUMENTS.map((item) => <DocumentUploadZone key={item.code} item={item} file={files[item.code]} status={uploads[item.code]} disabled={state === "submitting"} onSelect={(file, status) => selectFile(item, file, status)} />)}</div></section>
        <section className="candidate-form-section" aria-labelledby="consent-title"><div className="candidate-section-heading candidate-section-heading--compact"><span>03</span><div><p className="candidate-kicker">Required consents</p><h2 id="consent-title">Review and acknowledge</h2></div></div><div className="candidate-consents"><label><input name="privacyAccepted" type="checkbox" required /><span>I accept the <strong>Have Us Clean Applicant Privacy Notice v1.0</strong> and consent to application-related contact.</span></label><label><input name="backgroundConsentAccepted" type="checkbox" required /><span>I accept the <strong>Background Check Consent v1.0</strong> and authorize the governed screening process.</span></label></div></section>
        <label className="visually-hidden" aria-hidden="true">Website<input name="website" tabIndex="-1" autoComplete="off" /></label>
        {error ? <div className="candidate-alert candidate-alert--error" role="alert">{error}</div> : null}
        <div className="candidate-submit"><div><strong>Ready to apply?</strong><small>Your information is protected throughout review.</small></div><Button type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Securing your application…" : `Submit ${program.label} application`}</Button></div>
      </form>}
      <p className="candidate-privacy">Private HEMS / HR applicant intake · ServiceOS activation occurs only after governed approval.</p>
    </div>
  </main>;
}
