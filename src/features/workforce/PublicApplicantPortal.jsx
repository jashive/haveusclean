import React, { useMemo, useRef, useState } from "react";
import ApplicantTrainingPlayer from "./ApplicantTrainingPlayer.jsx";

const PROGRAMS = {
  ON: {
    label: "Ontario",
    code: "HUC_ON_RESIDENTIAL_CLEANER",
    role: "residential_cleaner",
    currency: "CAD",
    standards: "WHMIS and Have Us Clean residential standards",
  },
  AZ: {
    label: "Arizona",
    code: "HUC_AZ_RESIDENTIAL_CLEANER",
    role: "residential_cleaner",
    currency: "USD",
    standards: "independent-contractor and 1099 compliance",
  },
};

const DOCUMENTS = [
  { code: "GOV_ID", name: "governmentId", label: "Government photo ID" },
  { code: "PROOF_OF_INSURANCE_BONDING", name: "insurance", label: "Proof of insurance / bonding" },
];

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function requestKey(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function toE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `1${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? `+${normalized}` : "";
}

async function api(body) {
  const response = await fetch("/api/workforce/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || "The request could not be completed.");
  return data;
}

async function uploadDocument(session, item, file, onProgress) {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error(`${item.label} must be a PDF, JPG, or PNG.`);
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error(`${item.label} must be smaller than 10 MB.`);
  onProgress("Preparing secure upload…");
  const signed = await api({
    action: "sign_upload",
    applicantReference: session.applicantReference,
    applicantAccessToken: session.applicantAccessToken,
    documentCode: item.code,
    fileName: file.name,
    mimeType: file.type,
    byteSize: file.size,
    idempotencyKey: requestKey(`intent-${item.code}`),
  });
  onProgress("Uploading to protected storage…");
  const upload = await fetch(signed.upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  if (!upload.ok) throw new Error(`${item.label} could not be uploaded securely.`);
  onProgress("Registering for Owner/Admin review…");
  await api({
    action: "finalize_upload",
    applicantReference: session.applicantReference,
    applicantAccessToken: session.applicantAccessToken,
    uploadIntentId: signed.upload.uploadIntentId,
    idempotencyKey: requestKey(`finalize-${item.code}`),
  });
  onProgress("Uploaded — pending review");
}

const css = `
  .huc-apply{min-height:100vh;background:linear-gradient(145deg,#07111f 0%,#10283a 52%,#0a1726 100%);color:#eef7f5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;padding:32px 16px 56px;box-sizing:border-box}
  .huc-apply *{box-sizing:border-box}.huc-apply-wrap{max-width:920px;margin:0 auto}.huc-apply-brand{font-size:14px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#56e5c2;margin:0 0 12px}.huc-apply h1{font-size:clamp(32px,6vw,52px);line-height:1.04;margin:0;max-width:720px}.huc-apply-lede{color:#b6c8d1;font-size:17px;line-height:1.6;max-width:720px;margin:16px 0 26px}.huc-apply-card{background:rgba(255,255,255,.97);color:#102033;border-radius:20px;padding:clamp(20px,4vw,38px);box-shadow:0 24px 70px rgba(0,0,0,.3)}
  .huc-training{margin-top:28px;padding-top:26px;border-top:1px solid #dce5e8;text-align:left}.huc-training-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.huc-training-heading h2{margin:2px 0 8px}.huc-training-eyebrow{margin:0;color:#087f68;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em}.huc-training-layout{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(0,1.6fr);gap:18px}.huc-training-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.huc-training-list button{width:100%;display:flex;gap:10px;text-align:left;border:1px solid #cad7dc;border-radius:10px;background:#f6fafb;padding:11px;color:#163044}.huc-training-list button[aria-current=step]{border-color:#087f68;background:#e9fbf6}.huc-training-list button:disabled{opacity:.58}.huc-training-list strong,.huc-training-list small{display:block}.huc-training-list small{color:#637687;margin-top:3px}.huc-training-stage{min-width:0}.huc-training-video{display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:12px;background:#06101c}.huc-training-confirm{display:flex;gap:9px;align-items:flex-start;margin:13px 0;font-size:14px;line-height:1.45}.huc-training-stage .huc-submit{width:100%}
  .huc-market-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:28px}.huc-market{border:2px solid #d7e0e5;background:#f6fafb;border-radius:14px;padding:16px;text-align:left;cursor:pointer;color:#24384b}.huc-market[aria-pressed=true]{border-color:#087f68;background:#e9fbf6;box-shadow:0 0 0 3px rgba(8,127,104,.12)}.huc-market strong,.huc-market span{display:block}.huc-market strong{font-size:18px}.huc-market span{font-size:13px;color:#5b7082;margin-top:4px;line-height:1.4}
  .huc-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.huc-field{display:flex;flex-direction:column;gap:7px;font-size:14px;font-weight:750}.huc-field-wide{grid-column:1/-1}.huc-field input,.huc-field textarea,.huc-field select{width:100%;border:1px solid #bac8d1;border-radius:10px;background:white;color:#102033;padding:12px 13px;font:inherit;font-weight:500}.huc-field textarea{resize:vertical}.huc-field input:focus,.huc-field textarea:focus,.huc-field select:focus{outline:3px solid rgba(8,127,104,.18);border-color:#087f68}.huc-section{grid-column:1/-1;border-top:1px solid #dce5e8;padding-top:22px;margin-top:4px}.huc-section h2{font-size:20px;margin:0 0 6px}.huc-help{font-size:13px;color:#637687;line-height:1.5;margin:0 0 15px}.huc-consent{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.5;color:#30465a}.huc-consent input{margin-top:4px;flex:0 0 auto}.huc-file-state{display:block;color:#087f68;font-size:12px;margin-top:5px}.huc-submit{grid-column:1/-1;border:0;border-radius:12px;background:#087f68;color:white;padding:15px 22px;font-size:16px;font-weight:900;cursor:pointer}.huc-submit:hover{background:#066a58}.huc-submit:disabled{opacity:.62;cursor:wait}.huc-alert{grid-column:1/-1;border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.5}.huc-alert-error{background:#fff0f0;color:#9b1c1c;border:1px solid #efb8b8}.huc-success{text-align:center;padding:12px 0}.huc-success-mark{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;background:#dff8f0;color:#087f68;font-size:28px;font-weight:900}.huc-reference{display:inline-block;background:#eaf1f4;color:#102033;border-radius:9px;padding:10px 14px;font:800 17px ui-monospace,SFMono-Regular,monospace;letter-spacing:.04em}.huc-privacy{color:#8fa4ae;font-size:12px;text-align:center;margin-top:18px}
  @media(max-width:650px){.huc-apply{padding:22px 12px 36px}.huc-market-grid,.huc-form-grid,.huc-training-layout{grid-template-columns:1fr}.huc-field-wide,.huc-section,.huc-submit{grid-column:auto}.huc-apply-card{border-radius:15px}}
`;

export default function PublicApplicantPortal() {
  const [market, setMarket] = useState("ON");
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [uploads, setUploads] = useState({});
  const submissionKey = useRef(requestKey("public-apply"));
  const program = PROGRAMS[market];
  const marketOptions = useMemo(() => Object.entries(PROGRAMS), []);

  async function submit(event) {
    event.preventDefault();
    setState("submitting");
    setError("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const phoneE164 = toE164(values.get("phone"));
    if (!phoneE164) { setState("idle"); setError("Enter a valid phone number, including area code."); return; }
    try {
      const response = await api({
        action: "apply",
        programCode: program.code,
        legalName: values.get("legalName"),
        email: values.get("email"),
        phoneE164,
        residentialAddress: values.get("address"),
        experienceSummary: values.get("experience"),
        availabilitySchedule: values.get("availability"),
        appliedRoleCode: program.role,
        privacyNoticeVersion: "1.0",
        backgroundConsentVersion: "1.0",
        privacyAccepted: values.get("privacyAccepted") === "on",
        backgroundConsentAccepted: values.get("backgroundConsentAccepted") === "on",
        consentToContact: true,
        idempotencyKey: submissionKey.current,
        website: values.get("website"),
      });
      const session = response.application;
      const files = Object.fromEntries(DOCUMENTS.map((item) => [item.code, values.get(item.name)]));
      for (const item of DOCUMENTS) {
        const file = files[item.code];
        if (file?.size) {
          await uploadDocument(session, item, file, (message) => setUploads((current) => ({ ...current, [item.code]: message })));
        }
      }
      sessionStorage.setItem("huc_applicant_reference", session.applicantReference);
      setResult(session);
      setState("success");
    } catch (err) {
      setError(err.message || "Your application could not be submitted.");
      setState("idle");
    }
  }

  return <main className="huc-apply">
    <style>{css}</style>
    <div className="huc-apply-wrap">
      <p className="huc-apply-brand">Have Us Clean · Workforce</p>
      <h1>Build a cleaner future with us.</h1>
      <p className="huc-apply-lede">Apply for residential cleaning opportunities in Ontario or Arizona. No account is required. Your information and documents stay within our restricted HR review process.</p>
      <section className="huc-apply-card" aria-labelledby="application-title">
        {state === "success" ? <div className="huc-success">
          <div className="huc-success-mark">✓</div>
          <h2 id="application-title">Application received</h2>
          <p>Keep this private reference for any follow-up with Have Us Clean.</p>
          <p className="huc-reference">{result?.applicantReference}</p>
          <p className="huc-help">Your application is now in Applicant screening. Uploaded files are pending restricted Owner/Admin review.</p>
          <ApplicantTrainingPlayer session={result} request={api} />
        </div> : <form onSubmit={submit} className="huc-form-grid">
          <div className="huc-field-wide"><h2 id="application-title">Residential cleaner application</h2><p className="huc-help">Choose the market where you want to work.</p></div>
          <div className="huc-market-grid huc-field-wide">
            {marketOptions.map(([code, item]) => <button key={code} type="button" className="huc-market" aria-pressed={market === code} onClick={() => setMarket(code)}><strong>{item.label}</strong><span>{item.currency} · {item.standards}</span></button>)}
          </div>
          <label className="huc-field">Full legal name<input name="legalName" required maxLength="200" autoComplete="name" /></label>
          <label className="huc-field">Email address<input name="email" type="email" required maxLength="320" autoComplete="email" /></label>
          <label className="huc-field">Phone number<input name="phone" type="tel" required maxLength="24" autoComplete="tel" placeholder="(905) 555-0123" /></label>
          <label className="huc-field">Market<select value={market} onChange={(event) => setMarket(event.target.value)}>{marketOptions.map(([code, item]) => <option key={code} value={code}>{item.label}</option>)}</select></label>
          <label className="huc-field huc-field-wide">Residential address<textarea name="address" required maxLength="500" rows="3" autoComplete="street-address" /></label>
          <label className="huc-field huc-field-wide">Residential cleaning experience<textarea name="experience" required maxLength="2000" rows="4" placeholder="Tell us how long you have cleaned professionally and the types of homes or services you know." /></label>
          <label className="huc-field huc-field-wide">Availability schedule<textarea name="availability" required maxLength="1200" rows="3" placeholder="List the days and times you are normally available, including weekends if applicable." /></label>
          <div className="huc-section"><h2>Verification documents</h2><p className="huc-help">PDF, JPG, or PNG · 10 MB maximum each. Uploads go directly to private applicant storage and cannot be read publicly.</p></div>
          {DOCUMENTS.map((item) => <label className="huc-field" key={item.code}>{item.label}<input name={item.name} type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />{uploads[item.code] ? <span className="huc-file-state">{uploads[item.code]}</span> : null}</label>)}
          <div className="huc-section"><h2>Required consents</h2><p className="huc-help">Both acknowledgements are required to submit this application.</p></div>
          <label className="huc-consent huc-field-wide"><input name="privacyAccepted" type="checkbox" required /> <span>I have read and accept the <strong>Have Us Clean Applicant Privacy Notice v1.0</strong>, and I consent to application-related contact.</span></label>
          <label className="huc-consent huc-field-wide"><input name="backgroundConsentAccepted" type="checkbox" required /> <span>I have read and accept the <strong>Background Check Consent v1.0</strong> and authorize Have Us Clean to begin its governed screening process.</span></label>
          <label style={{ position: "absolute", left: "-10000px" }} aria-hidden="true">Website<input name="website" tabIndex="-1" autoComplete="off" /></label>
          {error ? <div className="huc-alert huc-alert-error" role="alert">{error}</div> : null}
          <button className="huc-submit" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Securing your application…" : `Submit ${program.label} application`}</button>
        </form>}
      </section>
      <p className="huc-privacy">Have Us Clean · Private HEMS / HR applicant intake · ServiceOS activation occurs only after approval.</p>
    </div>
  </main>;
}
