// Growth Layer 1.0 / G1 contact-candidate normalization.
// Contact discovery remains Growth-owned until governed ServiceOS handoff.

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

export function normalizeEmail(value) {
  const email = lower(value);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function normalizeLinkedIn(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeContactCandidate(raw = {}, scope = {}) {
  const email = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  const linkedin_url = normalizeLinkedIn(raw.linkedin_url || raw.linkedin);

  if (!email && !phone && !linkedin_url) {
    throw new Error("Contact candidate requires a valid email, phone, or LinkedIn URL.");
  }

  if (!scope.organization_id || !scope.business_unit_id || !scope.jurisdiction_id || !scope.prospect_id) {
    throw new Error("Canonical Growth prospect scope is required for a contact candidate.");
  }

  const sourceUrl = text(raw.source_url) || null;
  const sourceLabel = text(raw.contact_source || raw.source_label) || null;
  const verification = lower(raw.verification_status);

  return {
    prospect_id: scope.prospect_id,
    organization_id: scope.organization_id,
    business_unit_id: scope.business_unit_id,
    jurisdiction_id: scope.jurisdiction_id,
    first_name: text(raw.first_name) || null,
    last_name: text(raw.last_name) || null,
    buyer_title: text(raw.buyer_title || raw.title) || null,
    email,
    phone,
    linkedin_url,
    contact_source: sourceLabel,
    source_url: sourceUrl,
    verification_status: ["unverified", "partially_verified", "verified", "invalid"].includes(verification)
      ? verification
      : "unverified",
    is_primary_candidate: Boolean(raw.is_primary_candidate),
    metadata: {
      ...(raw.metadata || {}),
      normalization_version: "g1-contact-v1",
      original_email: text(raw.email) || null,
      original_phone: text(raw.phone) || null,
      original_linkedin: text(raw.linkedin_url || raw.linkedin) || null,
    },
  };
}

export function contactIdentityKeys(contact) {
  const keys = [];
  if (contact?.email) keys.push(`email:${normalizeEmail(contact.email)}`);
  if (contact?.phone) keys.push(`phone:${normalizePhone(contact.phone)}`);
  if (contact?.linkedin_url) keys.push(`linkedin:${normalizeLinkedIn(contact.linkedin_url)}`);
  return keys.filter((key) => !key.endsWith(":null"));
}

export function evidenceFromContact(contact, { observed_at = null } = {}) {
  const evidence = [];
  const source = contact?.source_url || null;
  const sourceLabel = contact?.contact_source || "contact_discovery";
  const confidence = contact?.verification_status === "verified" ? 1 : contact?.verification_status === "partially_verified" ? 0.7 : 0.4;

  for (const field of ["first_name", "last_name", "buyer_title", "email", "phone", "linkedin_url"]) {
    if (!contact?.[field]) continue;
    evidence.push({
      evidence_type: "contact_fact",
      field_name: `contact.${field}`,
      field_value: contact[field],
      source_label: sourceLabel,
      source_url: source,
      observed_at,
      confidence,
      is_inferred: false,
      model_or_agent: null,
      metadata: { normalization_version: "g1-contact-v1" },
    });
  }
  return evidence;
}

export function contactReadiness(contact) {
  const reachable = Boolean(contact?.email || contact?.phone || contact?.linkedin_url);
  const verified = contact?.verification_status === "verified" || contact?.verification_status === "partially_verified";
  return {
    reachable,
    verified,
    ready_for_human_review: reachable,
    ready_for_outreach: false,
    reason: reachable
      ? verified ? "reachable_contact_requires_human_review" : "unverified_reachable_contact_requires_human_review"
      : "no_reachable_contact",
  };
}
