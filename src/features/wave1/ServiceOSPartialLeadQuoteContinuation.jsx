import React, { useMemo, useState } from "react";
import {
  capturePricingSnapshot,
  buildEstimatePayload,
  buildQuotePayload,
  buildQuoteVersionPayload,
} from "../../lib/serviceosRevenueUtils.js";
import {
  createEstimate,
  createPricingSnapshot,
  createQuote,
  createQuoteVersion,
} from "../../lib/serviceosRevenueClient.js";
import { promoteExistingLeadForQuote } from "../../lib/serviceosLeadQuoteContinuationClient.js";
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

const DWELLINGS = ["Apartment / Condo", "Townhouse", "Detached House"];
const PACKAGES = [
  ["essential_refresh", "Essential Refresh Clean"],
  ["signature_initial_reset", "Signature Initial Reset Clean"],
  ["complete_deep", "Complete Deep Clean"],
  ["move_in_move_out", "Move-In / Move-Out Clean"],
];
const FREQUENCIES = [["one_time", "One-Time"], ["weekly", "Weekly"], ["biweekly", "Biweekly"], ["monthly", "Monthly"]];
const CONDITIONS = [["light", "Light / Normal"], ["moderate", "Moderate"], ["heavy", "Heavy"], ["extreme", "Extreme — Management Review"]];
const SIZE_BANDS = [
  ["", "Within normal matrix range"],
  ["additional_250_500_sqft", "About 250–500 sq ft above matrix range"],
  ["additional_500_1000_sqft", "About 500–1,000 sq ft above matrix range"],
  ["more_than_1000_sqft_above_typical", ">1,000 sq ft above typical — Review"],
];

const s = {
  panel: { marginTop: 14, border: "1px solid #2B7A68", borderRadius: 10, background: "#102A26", padding: 16 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(205px,1fr))", gap: 10 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { color: "#AEBAC9", fontSize: 12, fontWeight: 750 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3A4B62", borderRadius: 8, background: "#0E1524", color: "#F5F8FC", padding: "9px 10px", fontSize: 14 },
  actions: { display: "flex", gap: 9, flexWrap: "wrap", marginTop: 14 },
  primary: { border: 0, borderRadius: 8, padding: "10px 14px", background: "#00D4AA", color: "#07110F", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #3D516B", borderRadius: 8, padding: "9px 13px", background: "#202B3C", color: "#F5F8FC", fontWeight: 800, cursor: "pointer" },
  disabled: { opacity: 0.48, cursor: "not-allowed" },
  note: { color: "#9AA9BC", fontSize: 12, lineHeight: 1.5, marginTop: 8 },
  warning: { marginTop: 12, border: "1px solid #C78A20", background: "#35270F", color: "#FFD78A", borderRadius: 8, padding: 10, fontSize: 13 },
  error: { marginTop: 12, border: "1px solid #8E3540", background: "#35151A", color: "#FF9EAA", borderRadius: 8, padding: 10, fontSize: 13 },
  quote: { marginTop: 14, borderTop: "1px solid #2B7A68", paddingTop: 14 },
  money: { fontSize: 26, fontWeight: 900, margin: "4px 0" },
  checklist: { margin: "8px 0 0 18px", padding: 0, color: "#FFD78A", fontSize: 13 },
};

function text(v) { return typeof v === "string" ? v : ""; }
function numberText(v) { return v === null || v === undefined ? "" : String(v); }
function packageLabel(key) { return PACKAGES.find(([value]) => value === key)?.[1] || key; }
function frequencyLabel(key) { return FREQUENCIES.find(([value]) => value === key)?.[1] || key; }
function normalizeDwelling(value) {
  const raw = text(value).toLowerCase();
  if (raw.includes("condo") || raw.includes("apartment")) return "Apartment / Condo";
  if (raw.includes("town")) return "Townhouse";
  return "Detached House";
}
function normalizePackage(value) {
  const raw = text(value).toLowerCase();
  if (raw.includes("move")) return "move_in_move_out";
  if (raw.includes("deep")) return "complete_deep";
  if (raw.includes("reset") || raw.includes("initial")) return "signature_initial_reset";
  return "essential_refresh";
}
function normalizeFrequency(value) {
  const raw = text(value).toLowerCase().replace(/[ -]/g, "_");
  if (raw.includes("biweekly") || raw.includes("bi_weekly")) return "biweekly";
  if (raw.includes("weekly")) return "weekly";
  if (raw.includes("monthly")) return "monthly";
  return "one_time";
}

export default function ServiceOSPartialLeadQuoteContinuation({ leadResult, session, revenueContext, onClose }) {
  const sr = leadResult?.service_request || null;
  const opp = leadResult?.opportunity || null;
  const req = sr?.requirements || {};
  const customer = req.customer || {};
  const location = req.location || {};
  const scope = req.scope || {};
  const [form, setForm] = useState(() => ({
    customerName: text(customer.name), phone: text(customer.phone), email: text(customer.email),
    address: text(location.address), city: text(location.city), postalCode: text(location.postalCode),
    dwellingType: normalizeDwelling(scope.propertyType || scope.dwellingType), beds: numberText(scope.beds), baths: numberText(scope.baths), sqft: numberText(scope.sqft),
    packageKey: normalizePackage(scope.cleanType || scope.packageKey), condition: "light", frequency: normalizeFrequency(scope.frequency), sqftBand: "",
    preferredDate: text(scope.preferredDate), preferredWindow: text(scope.preferredWindow), notes: text(scope.notes), addons: [],
  }));
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const accessToken = session?.access_token || null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId || null;
  const jurisdictionId = revenueContext?.primaryJurisdictionId || null;
  const businessUnitCode = revenueContext?.activeBusinessUnitCode || revenueContext?.businessUnits?.[0] || null;
  const orgId = revenueContext?.orgId || null;
  const appUserId = revenueContext?.appUserId || null;
  const currencyCode = quote?.currencyCode || (businessUnitCode === "HUC-AZ" ? "USD" : "CAD");

  const bookingMissing = useMemo(() => {
    const items = [];
    if (!form.customerName.trim()) items.push("customer name");
    if (!form.phone.trim() && !form.email.trim()) items.push("phone or email");
    if (!form.address.trim()) items.push("service address");
    if (!form.city.trim()) items.push("city");
    if (!form.preferredDate.trim()) items.push("preferred service date");
    return items;
  }, [form]);

  const customerText = useMemo(() => quote ? buildCustomerFacingQuoteText({
    customerName: form.customerName.trim() || "there",
    serviceLabel: packageLabel(form.packageKey),
    quote,
    frequencyLabel: frequencyLabel(form.frequency),
  }) : "", [quote, form.customerName, form.packageKey, form.frequency]);

  function setField(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "packageKey") {
        next.addons = removeBundledAddonsForPackage({ packageKey: value, addons: current.addons, businessUnitCode, configurationVersion: config });
      }
      return next;
    });
    setQuote(null); setConfig(null); setSaved(null); setError(null); setReview(null);
  }
  function toggleAddon(id) {
    if (isAddonBundledForPackage({ packageKey: form.packageKey, addonId: id, businessUnitCode, configurationVersion: config })) return;
    setForm((current) => ({ ...current, addons: current.addons.includes(id) ? current.addons.filter((x) => x !== id) : [...current.addons, id] }));
    setQuote(null); setConfig(null); setSaved(null); setError(null); setReview(null);
  }

  async function generateQuote() {
    if (busy) return;
    setBusy(true); setError(null); setReview(null); setQuote(null); setSaved(null);
    try {
      if (!sr?.id || !opp?.id) throw new Error("This saved lead is missing its canonical service request or opportunity.");
      if (!form.beds || !form.baths) throw new Error("Bedrooms and bathrooms are required to price this residential lead.");
      if (!businessUnitCode) throw new Error("Active business unit is required before quoting.");
      const firstReview = getManagementReviewReason({ condition: form.condition, notes: form.notes, packageKey: form.packageKey, addons: form.addons, businessUnitCode });
      if (firstReview) { setReview(firstReview); return; }
      const requiredVersion = getGovernedResidentialRequiredVersion(businessUnitCode);
      const configurationVersion = await fetchPublishedGovernedResidentialConfig({ accessToken, organizationId: orgId, businessUnitId, jurisdictionId, requiredVersion });
      const secondReview = getManagementReviewReason({ condition: form.condition, notes: form.notes, packageKey: form.packageKey, addons: form.addons, configurationVersion, businessUnitCode });
      if (secondReview) { setReview(secondReview); return; }
      const approvedSelections = getDefaultApprovedSelections(configurationVersion, { condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand });
      const raw = computeGovernedResidentialQuote({ configurationVersion, dwellingType: form.dwellingType, beds: Number(form.beds), baths: Number(form.baths), packageKey: form.packageKey, condition: form.condition, frequency: form.frequency, addons: form.addons, approvedSelections });
      if (raw?.requiresOfficeReview) { setReview(raw.reason || "Requires Management Review / Custom Pricing"); return; }
      const completed = applyGovernedResidentialAddons(raw, configurationVersion, form.addons);
      completed.input = { dwellingType: form.dwellingType, beds: Number(form.beds), baths: Number(form.baths), sqft: form.sqft ? Number(form.sqft) : null, packageKey: form.packageKey, condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand || null, addons: form.addons, businessUnitCode };
      setConfig(configurationVersion); setQuote(completed);
    } catch (err) {
      const message = err?.message || "Unable to generate quote.";
      if (/matrix row not found|office review|approved selection/i.test(message)) setReview(message); else setError(message);
    } finally { setBusy(false); }
  }

  async function saveDraft() {
    if (busy || !quote || !config || saved) return;
    setBusy(true); setError(null);
    try {
      const requirements = {
        customer: { name: form.customerName.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null },
        location: { address: form.address.trim() || null, city: form.city.trim() || null, postalCode: form.postalCode.trim() || null, jurisdictionId },
        scope: { dwellingType: form.dwellingType, sqft: form.sqft ? Number(form.sqft) : null, beds: Number(form.beds), baths: Number(form.baths), packageKey: form.packageKey, condition: form.condition, frequency: form.frequency, sqftBand: form.sqftBand || null, addons: form.addons, preferredDate: form.preferredDate || null, preferredWindow: form.preferredWindow || null, notes: form.notes.trim() || null },
      };
      const metadata = { ...(sr.metadata || {}), source: "serviceos_partial_lead_quote_continuation", business_unit_code: businessUnitCode, booking_ready: bookingMissing.length === 0, booking_missing: bookingMissing };
      const title = `${form.customerName.trim() || "Saved lead"} — ${packageLabel(form.packageKey)}`;
      const promoted = await promoteExistingLeadForQuote({ serviceRequest: sr, opportunity: opp, requirements, metadata, title, summary: "Existing partial lead continued to governed residential quote", appUserId, businessUnitId, accessToken });
      const estimate = await createEstimate(buildEstimatePayload({ organizationId: orgId, businessUnitId, opportunityId: promoted.opportunity.id, lifecycleStatus: "prepared", versionNo: 1, assumptions: { pricing_authority: config.version, pricing_mode: "published_configuration", business_unit_code: businessUnitCode, continued_from_partial_intake: true }, scopeSnapshot: requirements.scope, notes: form.notes.trim() || null, metadata, appUserId }), accessToken);
      const configurationSnapshot = buildGovernedResidentialConfigurationSnapshot(config);
      const pricingSnapshot = await createPricingSnapshot(capturePricingSnapshot({ quote, organizationId: orgId, businessUnitId, opportunityId: promoted.opportunity.id, estimateId: estimate.id, appUserId, configurationVersionId: config.id, configurationSnapshot, governedResidential: true }), accessToken);
      const quoteRecord = await createQuote(buildQuotePayload({ organizationId: orgId, businessUnitId, opportunityId: promoted.opportunity.id, estimateId: estimate.id, lifecycleStatus: "active", metadata, appUserId }), accessToken);
      const quoteVersion = await createQuoteVersion(buildQuoteVersionPayload({ organizationId: orgId, businessUnitId, quoteId: quoteRecord.id, pricingSnapshotId: pricingSnapshot.id, estimateId: estimate.id, versionNo: 1, title: packageLabel(form.packageKey), lineItemsSnapshot: [{ service: packageLabel(form.packageKey), subtotal: quote.preTaxTotal, tax: quote.taxAmount, total: quote.total, currency_code: quote.currencyCode, tax_name: quote.taxName, addons: quote.addonLines || [] }], commercialSnapshot: { customerFacingText: customerText, business_unit_code: businessUnitCode, booking_ready: bookingMissing.length === 0, booking_missing: bookingMissing }, metadata, appUserId }), accessToken);
      setSaved({ ...promoted, estimate, pricingSnapshot, quote: quoteRecord, quoteVersion });
    } catch (err) { setError(err?.message || "Unable to save quote on this lead."); }
    finally { setBusy(false); }
  }

  return (
    <div style={s.panel} data-testid="serviceos-partial-lead-quote-continuation">
      <strong>Continue Saved Lead to Quote</strong>
      <div style={s.note}>Same Service Request: {sr?.id || "Unavailable"}. Pricing can proceed before booking details are complete; customer acceptance and job creation remain separate.</div>
      <div style={{ ...s.grid, marginTop: 12 }}>
        <label style={s.field}><span style={s.label}>Customer name</span><input style={s.input} value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Phone</span><input style={s.input} value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Email</span><input style={s.input} value={form.email} onChange={(e) => setField("email", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Service address</span><input style={s.input} value={form.address} onChange={(e) => setField("address", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>City</span><input style={s.input} value={form.city} onChange={(e) => setField("city", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>{businessUnitCode === "HUC-AZ" ? "ZIP code" : "Postal code"}</span><input style={s.input} value={form.postalCode} onChange={(e) => setField("postalCode", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Property type *</span><select style={s.input} value={form.dwellingType} onChange={(e) => setField("dwellingType", e.target.value)}>{DWELLINGS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label style={s.field}><span style={s.label}>Bedrooms *</span><input style={s.input} type="number" min="0" value={form.beds} onChange={(e) => setField("beds", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Bathrooms *</span><input style={s.input} type="number" min="0" step="0.5" value={form.baths} onChange={(e) => setField("baths", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Approx. sq ft</span><input style={s.input} type="number" min="0" value={form.sqft} onChange={(e) => setField("sqft", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Service *</span><select style={s.input} value={form.packageKey} onChange={(e) => setField("packageKey", e.target.value)}>{PACKAGES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={s.field}><span style={s.label}>Condition *</span><select style={s.input} value={form.condition} onChange={(e) => setField("condition", e.target.value)}>{CONDITIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={s.field}><span style={s.label}>Frequency *</span><select style={s.input} value={form.frequency} onChange={(e) => setField("frequency", e.target.value)}>{FREQUENCIES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={s.field}><span style={s.label}>Size adjustment</span><select style={s.input} value={form.sqftBand} onChange={(e) => setField("sqftBand", e.target.value)}>{SIZE_BANDS.map(([v,l]) => <option key={v || "normal"} value={v}>{l}</option>)}</select></label>
        <label style={s.field}><span style={s.label}>Preferred date</span><input style={s.input} type="date" value={form.preferredDate} onChange={(e) => setField("preferredDate", e.target.value)} /></label>
        <label style={s.field}><span style={s.label}>Preferred time/window</span><input style={s.input} value={form.preferredWindow} onChange={(e) => setField("preferredWindow", e.target.value)} /></label>
      </div>
      <div style={{ marginTop: 12 }}><span style={s.label}>Add-ons</span><div style={{ ...s.grid, marginTop: 6 }}>{OFFICE_ADDON_OPTIONS.map((item) => {
        const bundled = isAddonBundledForPackage({ packageKey: form.packageKey, addonId: item.id, businessUnitCode, configurationVersion: config });
        return <label key={item.id} style={{ color: "#D9E2EE", fontSize: 13, ...(bundled ? s.disabled : {}) }} title={bundled ? "Included in Complete Deep Clean — no additional charge" : undefined}><input type="checkbox" checked={form.addons.includes(item.id)} disabled={bundled} onChange={() => toggleAddon(item.id)} /> {item.label}{bundled ? " — Included" : ""}</label>;
      })}</div></div>
      <div style={s.note}>Complete Deep bundled items are disabled automatically to prevent double charging.</div>
      <label style={{ ...s.field, marginTop: 12 }}><span style={s.label}>Scope / access / pets / safety notes</span><textarea style={{ ...s.input, minHeight: 70 }} value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></label>

      {bookingMissing.length ? <div style={s.warning}><strong>Quote allowed — booking information still incomplete.</strong><ul style={s.checklist}>{bookingMissing.map((item) => <li key={item}>{item}</li>)}</ul></div> : <div style={{ ...s.note, color: "#60E7C6" }}>Booking information checklist is complete.</div>}
      {review ? <div style={s.warning}><strong>{review.includes("Requires Management Review / Custom Pricing") ? "Requires Management Review / Custom Pricing" : "Management review required"}:</strong> {review}</div> : null}
      {error ? <div style={s.error}><strong>Unable to continue:</strong> {error}</div> : null}
      <div style={s.actions}><button type="button" style={s.primary} disabled={busy} onClick={generateQuote}>{busy ? "Working…" : "Generate Governed Quote"}</button><button type="button" style={s.secondary} disabled={busy} onClick={onClose}>Close</button></div>

      {quote ? <div style={s.quote}>
        <div style={s.label}>Customer total · {currencyCode}</div><div style={s.money}>{formatQuoteMoney(quote.total, currencyCode)}</div>
        <div style={s.note}>{customerText}</div>
        <div style={s.actions}><button type="button" style={s.primary} disabled={busy || !!saved} onClick={saveDraft}>{saved ? "Quote Saved on Existing Lead" : "Save Quote on This Lead"}</button></div>
        {saved ? <div style={s.note}>Reused Service Request: {saved.serviceRequest?.id}<br />Quote Version: {saved.quoteVersion?.id}<br /><strong>Next:</strong> use Quote Delivery + Customer Decision below, refresh the quote queue, then choose Send Quote by Email. ServiceOS marks the quote Sent only after Microsoft 365 accepts the delivery.</div> : null}
      </div> : null}
    </div>
  );
}