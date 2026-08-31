import React, { useMemo, useState } from "react";
import {
  capturePricingSnapshot,
  buildServiceRequestPayload,
  buildOpportunityPayload,
  buildEstimatePayload,
  buildQuotePayload,
  buildQuoteVersionPayload,
} from "../../lib/serviceosRevenueUtils.js";
import {
  createServiceRequest,
  createOpportunity,
  createEstimate,
  createPricingSnapshot,
  createQuote,
  createQuoteVersion,
  updateQuoteVersionStatus,
} from "../../lib/serviceosRevenueClient.js";
import {
  getGovernedResidentialRequiredVersion,
  fetchPublishedGovernedResidentialConfig,
} from "../../lib/governedResidentialConfig.js";
import {
  computeGovernedResidentialQuote,
  buildGovernedResidentialConfigurationSnapshot,
} from "../../lib/governedResidentialPricing.js";
import {
  OFFICE_ADDON_OPTIONS,
  applyGovernedResidentialAddons,
  buildCustomerFacingQuoteText,
  formatQuoteMoney,
  getDefaultApprovedSelections,
  getManagementReviewReason,
  isAddonBundledForPackage,
  removeBundledAddonsForPackage,
} from "../../lib/serviceosOfficeQuoteUtils.js";
import { canManageServiceOSRevenue } from "../../lib/serviceosUiPolicy.js";

const PACKAGE_OPTIONS = [
  { value: "essential_refresh", label: "Essential Refresh Clean" },
  { value: "kitchen_bath_refresh", label: "Kitchen & Bath Refresh Clean" },
  { value: "signature_initial_reset", label: "Signature Initial Reset Clean" },
  { value: "complete_deep", label: "Complete Deep Clean" },
  { value: "kitchen_bath_deep", label: "Kitchen & Bath Deep Clean" },
  { value: "move_in_move_out", label: "Move-In / Move-Out Clean" },
];
const DWELLING_OPTIONS = [
  { value: "Apartment / Condo", label: "Apartment / Condo" },
  { value: "Townhouse", label: "Townhouse" },
  { value: "Detached House", label: "Detached / Semi-Detached" },
];
const FREQUENCY_OPTIONS = [
  { value: "one_time", label: "One-Time" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
];
const CONDITION_OPTIONS = [
  { value: "light", label: "Light / Normal" },
  { value: "moderate", label: "Moderate" },
  { value: "heavy", label: "Heavy" },
  { value: "extreme", label: "Extreme — Management Review" },
];
const SQFT_OPTIONS = [
  { value: "", label: "Within normal matrix range" },
  { value: "additional_250_500_sqft", label: "About 250–500 sq ft above matrix range" },
  { value: "additional_500_1000_sqft", label: "About 500–1,000 sq ft above matrix range" },
  { value: "more_than_1000_sqft_above_typical", label: ">1,000 sq ft above matrix — Review" },
];
const initialForm = {
  customerName: "", phone: "", email: "", address: "", city: "", postalCode: "",
  leadSource: "Google LSA", dwellingType: "Detached House", beds: "3", baths: "2", sqft: "",
  packageKey: "essential_refresh", condition: "light", frequency: "one_time", sqftBand: "",
  preferredDate: "", preferredWindow: "", notes: "", addons: [],
};
const styles = {
  panel: { marginTop: 14, background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18 },
  heading: { margin: 0, fontSize: 20 },
  subheading: { margin: "5px 0 18px", color: "#9AA9BC", fontSize: 13, lineHeight: 1.5 },
  steps: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 },
  step: { padding: "6px 10px", borderRadius: 999, background: "#202B3C", color: "#AEBAC9", fontSize: 12, fontWeight: 800 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 }, span2: { gridColumn: "1 / -1" },
  label: { color: "#AEBAC9", fontSize: 12, fontWeight: 750 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3A4B62", borderRadius: 8, background: "#0E1524", color: "#F5F8FC", padding: "10px 11px", fontSize: 14 },
  section: { marginTop: 20, paddingTop: 18, borderTop: "1px solid #28364A" },
  sectionTitle: { margin: "0 0 12px", fontSize: 15, color: "#00D4AA" },
  addons: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 },
  check: { display: "flex", gap: 8, alignItems: "center", color: "#D9E2EE", fontSize: 13 },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 },
  primary: { border: 0, borderRadius: 8, padding: "11px 15px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #3D516B", borderRadius: 8, padding: "10px 14px", background: "#202B3C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  disabled: { opacity: 0.48, cursor: "not-allowed" },
  review: { marginTop: 14, border: "1px solid #C78A20", background: "#35270F", color: "#FFD78A", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  error: { marginTop: 14, border: "1px solid #8E3540", background: "#35151A", color: "#FF9EAA", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  result: { marginTop: 18, border: "1px solid #2B7A68", background: "#102A26", borderRadius: 10, padding: 16 },
  money: { fontSize: 28, fontWeight: 900, margin: "4px 0" },
  resultGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 12 },
  metric: { background: "#0C1E1B", borderRadius: 8, padding: 10 }, metricLabel: { color: "#89A8A1", fontSize: 11, textTransform: "uppercase", fontWeight: 850 }, metricValue: { marginTop: 4, fontWeight: 850 },
  text: { whiteSpace: "pre-wrap", background: "#0E1524", border: "1px solid #33445A", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13, lineHeight: 1.55, color: "#E8EFF7" },
  status: { display: "inline-flex", marginTop: 10, padding: "5px 9px", borderRadius: 999, background: "#173A33", color: "#60E7C6", fontSize: 12, fontWeight: 850 },
  note: { color: "#8FA0B5", fontSize: 12, marginTop: 8, lineHeight: 1.45 },
};

function packageLabel(key) { return PACKAGE_OPTIONS.find((item) => item.value === key)?.label || key; }
function frequencyLabel(key) { return FREQUENCY_OPTIONS.find((item) => item.value === key)?.label || key; }
function marketLabel(code) { return code === "HUC-AZ" ? "Arizona" : code === "HUC-ON" ? "Ontario" : code || "selected market"; }
function isKitchenBathPackage(key) { return key === "kitchen_bath_refresh" || key === "kitchen_bath_deep"; }

export default function ServiceOSRevenueWorkspace({ session, revenueContext }) {
  const [form, setForm] = useState(initialForm);
  const [configurationVersion, setConfigurationVersion] = useState(null);
  const [quote, setQuote] = useState(null);
  const [reviewReason, setReviewReason] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");

  const role = revenueContext?.roleCode ?? null;
  const authorized = canManageServiceOSRevenue(role);
  const accessToken = session?.access_token ?? null;
  const orgId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const jurisdictionId = revenueContext?.primaryJurisdictionId ?? null;
  const businessUnitCode = revenueContext?.activeBusinessUnitCode
    ?? revenueContext?.businessUnitRecords?.find((item) => item.id === businessUnitId)?.code
    ?? (revenueContext?.businessUnits?.length === 1 ? revenueContext.businessUnits[0] : null);
  const appUserId = revenueContext?.appUserId ?? null;
  const kitchenBathPackage = isKitchenBathPackage(form.packageKey);

  const customerText = useMemo(() => quote ? buildCustomerFacingQuoteText({ customerName: form.customerName, serviceLabel: packageLabel(form.packageKey), quote, frequencyLabel: frequencyLabel(form.frequency) }) : "", [quote, form.customerName, form.packageKey, form.frequency]);

  function resetComputed() { setQuote(null); setSaved(null); setConfigurationVersion(null); setReviewReason(null); setError(null); }
  function setField(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "packageKey") {
        next.addons = removeBundledAddonsForPackage({ packageKey: value, addons: current.addons, businessUnitCode, configurationVersion });
      }
      return next;
    });
    resetComputed();
  }
  function toggleAddon(id) {
    if (isAddonBundledForPackage({ packageKey: form.packageKey, addonId: id, businessUnitCode, configurationVersion })) return;
    setForm((current) => ({ ...current, addons: current.addons.includes(id) ? current.addons.filter((item) => item !== id) : [...current.addons, id] }));
    resetComputed();
  }

  async function handleGenerateQuote() {
    if (busy || !authorized) return;
    setBusy(true); setError(null); setReviewReason(null); setQuote(null); setSaved(null); setConfigurationVersion(null);
    try {
      if (!form.customerName.trim()) throw new Error("Customer name is required.");
      if (!form.phone.trim() && !form.email.trim()) throw new Error("Enter at least a phone number or email address.");
      if (!form.address.trim() || !form.city.trim()) throw new Error("Service address and city are required.");
      if (!form.baths) throw new Error("Bathrooms are required for residential pricing.");
      if (!kitchenBathPackage && !form.beds) throw new Error("Bedrooms are required for full-home residential matrix pricing.");
      if (!businessUnitCode) throw new Error("Active business unit is required before quoting.");

      const basicReviewReason = getManagementReviewReason({ condition: form.condition, notes: form.notes, packageKey: form.packageKey, addons: form.addons, businessUnitCode });
      if (basicReviewReason) { setReviewReason(basicReviewReason); return; }

      const requiredVersion = getGovernedResidentialRequiredVersion(businessUnitCode);
      const config = await fetchPublishedGovernedResidentialConfig({ accessToken, organizationId: orgId, businessUnitId, jurisdictionId, requiredVersion });
      const packageReviewReason = getManagementReviewReason({ condition: form.condition, notes: form.notes, packageKey: form.packageKey, addons: form.addons, configurationVersion: config, businessUnitCode });
      if (packageReviewReason) { setReviewReason(packageReviewReason); return; }
      const approvedSelections = getDefaultApprovedSelections(config, { condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand });
      const rawQuote = computeGovernedResidentialQuote({
        configurationVersion: config, dwellingType: form.dwellingType, beds: Number(form.beds || 0), baths: Number(form.baths), packageKey: form.packageKey,
        condition: form.condition, frequency: form.frequency, addons: form.addons, approvedSelections,
      });
      if (rawQuote?.requiresOfficeReview) { setReviewReason(rawQuote.reason || "Requires Management Review / Custom Pricing"); return; }
      const completedQuote = applyGovernedResidentialAddons(rawQuote, config, form.addons);
      completedQuote.input = { dwellingType: form.dwellingType, beds: Number(form.beds || 0), baths: Number(form.baths), sqft: form.sqft ? Number(form.sqft) : null, packageKey: form.packageKey, condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand || null, addons: form.addons, businessUnitCode };
      setConfigurationVersion(config); setQuote(completedQuote);
    } catch (err) {
      const message = err?.message || "Unable to generate quote.";
      if (/matrix row not found|office review|approved selection/i.test(message)) setReviewReason(message); else setError(message);
    } finally { setBusy(false); }
  }

  async function handleSaveDraft() {
    if (busy || !quote || !configurationVersion || saved) return;
    setBusy(true); setError(null);
    try {
      const requirements = {
        customer: { name: form.customerName.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null },
        location: { address: form.address.trim(), city: form.city.trim(), postalCode: form.postalCode.trim() || null, jurisdictionId },
        scope: { dwellingType: form.dwellingType, sqft: form.sqft ? Number(form.sqft) : null, beds: Number(form.beds || 0), baths: Number(form.baths), packageKey: form.packageKey, condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand || null, addons: form.addons, preferredDate: form.preferredDate || null, preferredWindow: form.preferredWindow || null, notes: form.notes.trim() || null },
      };
      const metadata = { source: "serviceos_native_quote", lead_source: form.leadSource || null, business_unit_code: businessUnitCode };
      const title = `${form.customerName.trim()} — ${packageLabel(form.packageKey)}`;
      const serviceRequest = await createServiceRequest(buildServiceRequestPayload({ organizationId: orgId, businessUnitId, serviceCategory: "residential", lifecycleStatus: "qualified", intakeChannel: "office_native_quote", title, description: form.notes.trim() || null, requirements, metadata, appUserId }), accessToken);
      const opportunity = await createOpportunity(buildOpportunityPayload({ organizationId: orgId, businessUnitId, serviceRequestId: serviceRequest.id, stage: "proposal", title, summary: `Native residential quote for ${form.customerName.trim()}`, metadata, appUserId }), accessToken);
      const estimate = await createEstimate(buildEstimatePayload({ organizationId: orgId, businessUnitId, opportunityId: opportunity.id, lifecycleStatus: "prepared", versionNo: 1, assumptions: { pricing_authority: configurationVersion.version, pricing_mode: "published_configuration", business_unit_code: businessUnitCode }, scopeSnapshot: requirements.scope, notes: form.notes.trim() || null, metadata, appUserId }), accessToken);
      const configurationSnapshot = buildGovernedResidentialConfigurationSnapshot(configurationVersion);
      const pricingSnapshot = await createPricingSnapshot(capturePricingSnapshot({ quote, organizationId: orgId, businessUnitId, opportunityId: opportunity.id, estimateId: estimate.id, appUserId, configurationVersionId: configurationVersion.id, configurationSnapshot, governedResidential: true }), accessToken);
      const quoteRecord = await createQuote(buildQuotePayload({ organizationId: orgId, businessUnitId, opportunityId: opportunity.id, estimateId: estimate.id, lifecycleStatus: "active", metadata, appUserId }), accessToken);
      const quoteVersion = await createQuoteVersion(buildQuoteVersionPayload({
        organizationId: orgId, businessUnitId, quoteId: quoteRecord.id, pricingSnapshotId: pricingSnapshot.id, estimateId: estimate.id, versionNo: 1, title: packageLabel(form.packageKey),
        lineItemsSnapshot: [{ service: packageLabel(form.packageKey), subtotal: quote.preTaxTotal, tax: quote.taxAmount, total: quote.total, currency_code: quote.currencyCode, tax_name: quote.taxName, addons: quote.addonLines || [] }],
        commercialSnapshot: { customerFacingText: customerText, business_unit_code: businessUnitCode }, metadata, appUserId,
      }), accessToken);
      setSaved({ serviceRequest, opportunity, estimate, pricingSnapshot, quote: quoteRecord, quoteVersion, sent: false });
    } catch (err) { setError(err?.message || "Unable to save canonical draft."); }
    finally { setBusy(false); }
  }

  async function handleRecordSent() {
    if (busy || !saved?.quoteVersion?.id || saved.sent) return;
    setBusy(true); setError(null);
    try { const quoteVersion = await updateQuoteVersionStatus(saved.quoteVersion.id, "sent", accessToken); setSaved((current) => ({ ...current, quoteVersion, sent: true })); }
    catch (err) { setError(err?.message || "Unable to record quote as sent."); }
    finally { setBusy(false); }
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(customerText); setCopyStatus("Copied"); }
    catch { setCopyStatus("Select and copy the message manually"); }
  }

  if (!authorized) return null;
  const selectedMarket = marketLabel(businessUnitCode);
  const currencyCode = quote?.currencyCode ?? quote?.currency ?? configurationVersion?.configuration?.currency_code ?? (businessUnitCode === "HUC-AZ" ? "USD" : "CAD");
  const taxLabel = quote?.taxName ?? configurationVersion?.configuration?.tax?.label ?? (businessUnitCode === "HUC-AZ" ? "Service tax" : "HST");

  return (
    <section style={styles.panel} data-testid="serviceos-native-revenue-workspace" data-business-unit={businessUnitCode || "unknown"}>
      <h2 style={styles.heading}>Guided Intake + Quick Quote</h2>
      <p style={styles.subheading}>Use this for ordinary {selectedMarket} residential leads. Pricing comes from the HEMS-published configuration for the active business unit. Customer acceptance and job creation remain separate real-world steps.</p>
      <div style={styles.steps} aria-label="Quote workflow"><span style={styles.step}>1 · Qualify</span><span style={styles.step}>2 · Generate Quote</span><span style={styles.step}>3 · Save Draft</span><span style={styles.step}>4 · Send + Record</span></div>

      <div style={styles.grid}>
        <label style={styles.field}><span style={styles.label}>Customer name *</span><input style={styles.input} value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Phone</span><input style={styles.input} value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Email</span><input style={styles.input} type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Lead source</span><input style={styles.input} value={form.leadSource} onChange={(e) => setField("leadSource", e.target.value)} /></label>
        <label style={{ ...styles.field, ...styles.span2 }}><span style={styles.label}>Service address *</span><input style={styles.input} value={form.address} onChange={(e) => setField("address", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>City *</span><input style={styles.input} value={form.city} onChange={(e) => setField("city", e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>{businessUnitCode === "HUC-AZ" ? "ZIP code" : "Postal code"}</span><input style={styles.input} value={form.postalCode} onChange={(e) => setField("postalCode", e.target.value)} /></label>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Residential qualification · {selectedMarket}</h3>
        <div style={styles.grid}>
          <label style={styles.field}><span style={styles.label}>Property type *</span><select style={styles.input} value={form.dwellingType} onChange={(e) => setField("dwellingType", e.target.value)}>{DWELLING_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label style={styles.field}><span style={styles.label}>{kitchenBathPackage ? "Bedrooms (not used for Kitchen & Bath)" : "Bedrooms *"}</span><input style={{ ...styles.input, ...(kitchenBathPackage ? styles.disabled : {}) }} type="number" min="0" step="1" value={form.beds} disabled={kitchenBathPackage} onChange={(e) => setField("beds", e.target.value)} /></label>
          <label style={styles.field}><span style={styles.label}>Bathrooms *</span><input style={styles.input} type="number" min="0" step="0.5" value={form.baths} onChange={(e) => setField("baths", e.target.value)} /></label>
          <label style={styles.field}><span style={styles.label}>Approx. sq ft</span><input style={styles.input} type="number" min="0" value={form.sqft} onChange={(e) => setField("sqft", e.target.value)} /></label>
          <label style={styles.field}><span style={styles.label}>Service *</span><select style={styles.input} value={form.packageKey} onChange={(e) => setField("packageKey", e.target.value)}>{PACKAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label style={styles.field}><span style={styles.label}>Condition *</span><select style={styles.input} value={form.condition} onChange={(e) => setField("condition", e.target.value)}>{CONDITION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label style={styles.field}><span style={styles.label}>Frequency *</span><select style={styles.input} value={form.frequency} onChange={(e) => setField("frequency", e.target.value)}>{FREQUENCY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label style={styles.field}><span style={styles.label}>Size adjustment</span><select style={styles.input} value={form.sqftBand} onChange={(e) => setField("sqftBand", e.target.value)}>{SQFT_OPTIONS.map((item) => <option key={item.value || "normal"} value={item.value}>{item.label}</option>)}</select></label>
          <label style={styles.field}><span style={styles.label}>Preferred date</span><input style={styles.input} type="date" value={form.preferredDate} onChange={(e) => setField("preferredDate", e.target.value)} /></label>
          <label style={styles.field}><span style={styles.label}>Preferred time/window</span><input style={styles.input} value={form.preferredWindow} placeholder="e.g. 11:00 AM" onChange={(e) => setField("preferredWindow", e.target.value)} /></label>
          <label style={{ ...styles.field, ...styles.span2 }}><span style={styles.label}>Scope / access / parking / pets / safety notes</span><textarea style={{ ...styles.input, minHeight: 82, resize: "vertical" }} value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></label>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Add-ons</h3>
        <div style={styles.addons}>{OFFICE_ADDON_OPTIONS.map((item) => {
          const bundled = isAddonBundledForPackage({ packageKey: form.packageKey, addonId: item.id, businessUnitCode, configurationVersion });
          return <label key={item.id} style={{ ...styles.check, ...(bundled ? styles.disabled : {}) }} title={bundled ? "Included in selected package — no additional charge" : undefined}><input type="checkbox" checked={form.addons.includes(item.id)} disabled={bundled} onChange={() => toggleAddon(item.id)} />{item.label}{bundled ? " — Included" : ""}</label>;
        })}</div>
        <div style={styles.note}>Published starting/minimum add-on prices for {selectedMarket} are used only where the active configuration supports them. Complete Deep bundled items are disabled; Kitchen & Bath Deep includes refrigerator and oven while cabinets remain selectable. Specialty work routes to management review.</div>
      </div>

      <div style={styles.actions}><button type="button" style={{ ...styles.primary, ...(busy ? styles.disabled : {}) }} disabled={busy} onClick={handleGenerateQuote}>{busy ? "Working…" : `Generate ${selectedMarket} Quote`}</button></div>
      {reviewReason ? <div style={styles.review}><strong>{reviewReason.includes("Requires Management Review / Custom Pricing") ? "Requires Management Review / Custom Pricing" : "Management review required"}:</strong> {reviewReason}</div> : null}
      {error ? <div style={styles.error}><strong>Unable to continue:</strong> {error}</div> : null}

      {quote ? (
        <div style={styles.result} data-testid="serviceos-native-quote-result">
          <div style={styles.label}>Recommended customer total · {currencyCode}</div>
          <div style={styles.money}>{formatQuoteMoney(quote.total, currencyCode)}</div>
          <div style={styles.status}>READY TO QUOTE · {businessUnitCode}</div>
          <div style={styles.resultGrid}>
            <div style={styles.metric}><div style={styles.metricLabel}>Pre-tax</div><div style={styles.metricValue}>{formatQuoteMoney(quote.preTaxTotal, currencyCode)}</div></div>
            <div style={styles.metric}><div style={styles.metricLabel}>{taxLabel}</div><div style={styles.metricValue}>{formatQuoteMoney(quote.taxAmount, currencyCode)}</div></div>
            <div style={styles.metric}><div style={styles.metricLabel}>Pricing version</div><div style={styles.metricValue}>{configurationVersion?.version || "—"}</div></div>
            <div style={styles.metric}><div style={styles.metricLabel}>Add-ons</div><div style={styles.metricValue}>{formatQuoteMoney(quote.addonTotal, currencyCode)}</div></div>
          </div>
          <div style={styles.text}>{customerText}</div>
          <div style={styles.actions}>
            <button type="button" style={styles.secondary} onClick={handleCopy}>Copy Customer Message</button>
            <button type="button" style={{ ...styles.primary, ...(busy || saved ? styles.disabled : {}) }} disabled={busy || !!saved} onClick={handleSaveDraft}>{saved ? "Draft Saved" : "Save Canonical Draft"}</button>
          </div>
          {copyStatus ? <div style={styles.note}>{copyStatus}</div> : null}
          {saved ? (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Canonical quote record · {businessUnitCode}</h3>
              <div style={styles.note}>Service Request: {saved.serviceRequest?.id}<br />Quote Version: {saved.quoteVersion?.id}</div>
              <div style={styles.actions}><button type="button" style={{ ...styles.primary, ...(busy || saved.sent ? styles.disabled : {}) }} disabled={busy || saved.sent} onClick={handleRecordSent}>{saved.sent ? "Quote Recorded as Sent" : "I Sent This Quote — Record Sent"}</button></div>
              <div style={styles.note}>This button records the real office action. It does not send email/SMS and it does not mark the customer accepted.</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
