import { canTransitionStatus, COMMERCIAL_STATUS_TRANSITIONS } from "../../core/status/statusTransitions";

export function getEmptyCommercialLeadForm() {
  return {
    bizName: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    serviceType: "Office Clean",
    sqft: 2000,
    floors: 1,
    addons: [],
    frequency: "Weekly",
    preferredDate: "",
    preferredTime: "",
    contractMonths: 12,
    notes: "",
  };
}

export function createCommercialLeadFromForm(form) {
  return {
    ...form,
    id: Date.now(),
    status: "new",
    workOrder: null,
    paymentConfirmed: false,
  };
}

export function buildCommercialProposalEmail({ lead, quote, brand, region, commercialAddons }) {
  const pkg = lead.serviceType;
  const addonList = lead.addons?.map((id) => commercialAddons.find((entry) => entry.id === id)?.label).filter(Boolean);
  const cur = region.id === "ON" ? "CA$" : "$";
  const f = (n) => `${cur}${Math.round(n).toLocaleString()}`;
  const subject = `Commercial Cleaning Proposal — ${brand.businessName}`;
  const body = [
    `Hi ${lead.contactName || "there"},`,
    "",
    "Thank you for considering Have Us Clean for your commercial cleaning needs. Here is your custom proposal:",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "PROPOSAL DETAILS",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Business:   ${lead.bizName}`,
    `Service:    ${pkg}`,
    `Address:    ${lead.address}`,
    `Size:       ${lead.sqft?.toLocaleString()} sqft · ${lead.floors} floor(s)`,
    `Frequency:  ${lead.frequency}`,
    addonList.length > 0 ? `Add-Ons:    ${addonList.join(", ")}` : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "PRICING",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Per Visit:      ${f(quote.total)}${quote.taxRate > 0 ? ` (incl. ${(quote.taxRate * 100).toFixed(0)}% HST)` : ""}`,
    `Monthly Est.:   ${f(quote.monthly)}`,
    lead.contractMonths > 1 ? `Contract Value: ${f(quote.contract)} (${lead.contractMonths} months)` : "",
    "",
    "To move forward, please reply to this email or call us directly.",
    "",
    "Best regards,",
    "Have Us Clean",
    `📧 ${brand.supportEmail}`,
  ].filter((line) => line !== null && line !== undefined).join("\n");

  return { subject, body };
}

export function createCommercialJobFromLead({ lead, quote, partners, partnerCostPerHour, commercialAddons }) {
  return {
    id: Date.now(),
    client: lead.bizName,
    address: lead.address,
    type: lead.serviceType,
    date: lead.preferredDate,
    time: lead.preferredTime,
    partnerId: partners[0]?.id || 1,
    partnerIds: [partners[0]?.id || 1],
    status: "scheduled",
    hours: Math.max(3, Math.round(quote.totalCost / partnerCostPerHour)),
    upsells: lead.addons?.map((id) => commercialAddons.find((entry) => entry.id === id)?.label).filter(Boolean),
    beforePics: [],
    afterPics: [],
    summary: "",
    clientPrice: Math.round(quote.total),
    partnerPay: quote.partnerPay,
    profit: quote.profit,
    checkIn: null,
    checkOut: null,
    checkInCoords: null,
    checkOutCoords: null,
    recurring: lead.frequency,
    nextDate: null,
  };
}

function patchLeadById(leads, leadId, patch) {
  return leads.map((lead) => (lead.id === leadId ? { ...lead, ...patch } : lead));
}

function transitionCommercialLead(leads, leadId, nextStatus, patch = {}) {
  return leads.map((lead) => {
    if (lead.id !== leadId) return lead;
    if (!canTransitionStatus(lead.status, nextStatus, COMMERCIAL_STATUS_TRANSITIONS)) return lead;
    return { ...lead, ...patch, status: nextStatus };
  });
}

export function markCommercialLeadQuoted(leads, leadId) {
  return transitionCommercialLead(leads, leadId, "quoted");
}

export function markCommercialLeadBooked(leads, leadId, workOrderId) {
  return transitionCommercialLead(leads, leadId, "booked", { workOrder: workOrderId });
}

export function markCommercialLeadPaid(leads, leadId) {
  return transitionCommercialLead(leads, leadId, "paid", { paymentConfirmed: true });
}
