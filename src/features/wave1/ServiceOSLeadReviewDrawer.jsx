import React, { useState } from "react";
import { Button, DetailDrawer, StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import { scheduleCommercialWalkthrough } from "../../lib/serviceosLeadIntakeClient.js";
import ServiceOSPartialLeadQuoteContinuation from "./ServiceOSPartialLeadQuoteContinuation.jsx";

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return "Not quoted";
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", { style: "currency", currency }).format(Number(value));
}

function Detail({ label, children }) {
  return <div className="lead-review-detail"><dt>{label}</dt><dd>{children || "Not provided"}</dd></div>;
}

export default function ServiceOSLeadReviewDrawer({ lead, session, revenueContext, onClose, onRefresh, onNavigate }) {
  const serviceRequest = lead?.service_request || null;
  const opportunity = lead?.opportunity || null;
  const requirements = serviceRequest?.requirements || {};
  const customer = requirements.customer || {};
  const location = requirements.location || {};
  const scope = requirements.scope || requirements;
  const booking = lead?.booking || null;
  const bookingSnapshotUnavailable = Boolean(lead?.booking_snapshot_unavailable);
  const canonicalCustomer = lead?.canonical_customer || null;
  const canonicalContact = lead?.canonical_contact || null;
  const canonicalLocation = lead?.canonical_location || null;
  const canonicalRelationsUnavailable = lead?.canonical_relations_unavailable || {};
  const commercial = serviceRequest?.service_category === "commercial" || serviceRequest?.lifecycle_status === "walkthrough_requested";
  const market = revenueContext?.activeBusinessUnitCode || "HUC";
  const currency = market === "HUC-AZ" ? "USD" : "CAD";
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(market === "HUC-AZ" ? "America/Phoenix" : "America/Toronto");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const addons = Array.isArray(scope.addons) ? scope.addons : [];
  const canBuildResidentialQuote = !commercial && serviceRequest?.lifecycle_status === "intake" && opportunity?.stage === "open";
  const canScheduleWalkthrough = commercial && serviceRequest?.lifecycle_status === "walkthrough_requested";
  const canonicalContactName = [canonicalContact?.first_name, canonicalContact?.last_name].filter(Boolean).join(" ");
  const contactName = customer.name || canonicalContactName || canonicalCustomer?.display_name || serviceRequest?.title || "Lead review";
  const address = [location.address || location.address_line1 || canonicalLocation?.address_line1, location.city || canonicalLocation?.city, location.subdivision || canonicalLocation?.subdivision, location.postalCode || location.postal_code || canonicalLocation?.postal_code].filter(Boolean).join(", ");
  const serviceLabel = commercial ? `${humanize(scope.facility_type)} commercial cleaning` : humanize(scope.cleanType || scope.packageKey || booking?.service_package || "Residential cleaning");
  const preferred = commercial
    ? [scope.preferred_walkthrough_date, scope.preferred_walkthrough_time_window].filter(Boolean).join(" · ")
    : [scope.preferredDate || booking?.requested_service_date, scope.preferredWindow || booking?.requested_arrival_window].filter(Boolean).join(" · ");
  const stageLabel = opportunity?.stage === "proposal" ? "ESTIMATE SENT" : serviceRequest?.lifecycle_status === "walkthrough_requested" ? "WALKTHROUGH REQUESTED" : "NEW";

  async function scheduleWalkthrough() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await scheduleCommercialWalkthrough({ accessToken: session?.access_token, serviceRequestId: serviceRequest.id, scheduledAt, timezone, notes });
      setNotice("Walkthrough scheduled. The lead is now qualified for a formal commercial proposal.");
      await onRefresh?.();
    } catch (err) {
      setError(err?.message || "Unable to schedule walkthrough.");
    } finally { setBusy(false); }
  }

  function goTo(target) {
    onNavigate?.(target);
    onClose?.();
  }

  return <DetailDrawer open={Boolean(lead)} title={contactName} subtitle={`${market} · ${serviceLabel}`} onClose={onClose}>
    <div className="lead-review-summary">
      <div className="lead-review-summary__heading"><p className="admin-eyebrow">Lead lifecycle</p><StatusBadge tone={opportunity?.stage === "proposal" ? "info" : "warning"}>{stageLabel}</StatusBadge></div>
      <p>Review the request, prepare and deliver the governed quote, then record the customer&apos;s explicit decision before dispatch.</p>
    </div>

    <section className="lead-review-section" aria-labelledby="lead-contact-heading">
      <h3 id="lead-contact-heading">Customer and site</h3>
      <dl className="lead-review-grid">
        <Detail label="Customer">{customer.name || canonicalContactName || canonicalCustomer?.display_name || serviceRequest?.title}</Detail>
        <Detail label="Email">{customer.email || canonicalContact?.email}</Detail>
        <Detail label="Phone">{customer.phone || canonicalContact?.phone}</Detail>
        <Detail label="Address">{address}</Detail>
        <Detail label="Access notes">{scope.access_requirements || scope.accessRequirements || canonicalLocation?.access_notes || canonicalLocation?.metadata?.access_notes || canonicalLocation?.metadata?.access_instructions || scope.notes || scope.customer_notes}</Detail>
        <Detail label="Requested time">{preferred}</Detail>
      </dl>
      {Object.values(canonicalRelationsUnavailable).some(Boolean) ? <p className="form-message form-message--warning" role="status">Some saved contact or site details are temporarily unavailable. The original lead request remains available for follow-up.</p> : null}
    </section>

    <section className="lead-review-section" aria-labelledby="lead-scope-heading">
      <h3 id="lead-scope-heading">Scope and pricing snapshot</h3>
      {bookingSnapshotUnavailable ? <p className="form-message form-message--warning" role="status">Pricing snapshot is temporarily unavailable. Lead details remain available below so follow-up can continue.</p> : null}
      <dl className="lead-review-grid">
        <Detail label="Service">{serviceLabel}</Detail>
        <Detail label="Frequency">{humanize(scope.frequency || booking?.frequency)}</Detail>
        <Detail label="Facility / home">{commercial ? `${Number(scope.estimated_square_feet || 0).toLocaleString()} sq ft` : [scope.dwellingType, scope.beds != null ? `${scope.beds} bed` : null, scope.baths != null ? `${scope.baths} bath` : null].filter(Boolean).join(" · ")}</Detail>
        <Detail label="Add-ons">{addons.length ? addons.map(humanize).join(", ") : "None"}</Detail>
        <Detail label={`Estimate (${booking?.currency_code || currency})`}>{commercial ? "Custom proposal after walkthrough" : money(booking?.estimated_total, booking?.currency_code || currency)}</Detail>
        <Detail label="Tax">{commercial ? "Calculated on formal proposal" : booking ? `${booking.tax_name || "Tax"} · ${money(booking.estimated_tax, booking.currency_code || currency)}` : "Not quoted"}</Detail>
      </dl>
    </section>

    {canScheduleWalkthrough ? <section className="lead-review-section" aria-labelledby="walkthrough-heading">
      <h3 id="walkthrough-heading">Schedule walkthrough</h3>
      <p className="lead-review-help">Confirm the site visit before preparing a custom commercial proposal. This action does not create pricing or an operational job.</p>
      <div className="lead-review-form">
        <label><span>Date and time</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
        <label><span>Timezone</span><select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="America/Toronto">Ontario · America/Toronto</option><option value="America/Phoenix">Arizona · America/Phoenix</option></select></label>
        <label className="lead-review-form__wide"><span>Internal walkthrough notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <Button onClick={scheduleWalkthrough} disabled={busy || !scheduledAt}>{busy ? "Scheduling…" : "Confirm Walkthrough"}</Button>
    </section> : null}

    {canBuildResidentialQuote ? <ServiceOSPartialLeadQuoteContinuation leadResult={lead} session={session} revenueContext={revenueContext} onClose={onClose} /> : null}

    <section className="lead-review-section lead-review-next" aria-labelledby="lead-next-heading">
      <h3 id="lead-next-heading">Governed next actions</h3>
      <ol className="lead-review-steps"><li className={opportunity?.stage === "proposal" ? "is-complete" : "is-current"}>Prepare the formal quote</li><li>Send the quote and receive the customer decision</li><li>Record explicit acceptance to create the Operations handoff</li><li>Schedule and assign an eligible cleaner</li></ol>
      <div className="lead-review-actions">
        <Button variant="secondary" onClick={() => goTo("quote-delivery")}>Send Formal Quote</Button>
        <Button variant="secondary" onClick={() => goTo("customer-response")}>Record Customer Decision</Button>
        <Button onClick={() => goTo("operations-dispatch")}>Assign Cleaner</Button>
      </div>
      <p className="lead-review-help">Assignment remains fail-closed until explicit customer acceptance has produced a ready Operations handoff. “Start Job” remains cleaner-controlled after dispatch.</p>
    </section>

    {notice ? <p className="form-message form-message--success" role="status">{notice}</p> : null}
    {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    <TechnicalDetails><span>Service request: {serviceRequest?.id}</span><span>Opportunity: {opportunity?.id}</span>{booking?.id ? <span>Booking: {booking.id}</span> : null}</TechnicalDetails>
  </DetailDrawer>;
}
