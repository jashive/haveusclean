const ONTARIO_CITIES = ["brampton","mississauga","vaughan","markham","richmond hill","oakville","burlington","toronto","hamilton","newmarket","aurora","north york","etobicoke","scarborough","pickering","ajax","whitby","oshawa","stouffville","barrie"];
const ARIZONA_CITIES = ["phoenix","scottsdale","tempe","mesa","chandler","gilbert","glendale","peoria","surprise","goodyear","avondale","fountain hills","paradise valley"];

export function normalizeLeadPhone(value = "") {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeLeadMarket(lead) {
  const market = String(lead?.market || "").trim().toLowerCase();
  if (market.includes("ontario")) return "Ontario";
  if (market.includes("arizona")) return "Arizona";

  const leadId = String(lead?.lead_id || lead?.id || "").toUpperCase();
  if (leadId.startsWith("ON-") || leadId.startsWith("ON-M")) return "Ontario";
  if (leadId.startsWith("AZ-")) return "Arizona";

  const city = String(lead?.city || "").toLowerCase();
  if (ONTARIO_CITIES.some((cityName) => city.includes(cityName))) return "Ontario";
  if (ARIZONA_CITIES.some((cityName) => city.includes(cityName))) return "Arizona";
  return "";
}

export function normalizeLeadRecord(lead, fallback = {}) {
  const normalizedMarket = normalizeLeadMarket(lead);
  return {
    ...fallback,
    ...lead,
    lead_id: String(lead?.lead_id || lead?.id || fallback?.lead_id || "").trim(),
    id: lead?.id || lead?.lead_id || fallback?.id || undefined,
    company: lead?.company || fallback?.company || "",
    city: lead?.city || fallback?.city || "",
    market: normalizedMarket || lead?.market || fallback?.market || "Ontario",
    segment: lead?.segment || fallback?.segment || "Office",
    status: lead?.status || fallback?.status || "New",
    notes: lead?.notes ?? fallback?.notes ?? "",
    cold_email: lead?.cold_email ?? fallback?.cold_email ?? "",
    follow_up_email: lead?.follow_up_email ?? fallback?.follow_up_email ?? "",
    linkedin_note: lead?.linkedin_note ?? fallback?.linkedin_note ?? "",
    call_opener: lead?.call_opener ?? fallback?.call_opener ?? "",
    assigned_rep: lead?.assigned_rep ?? fallback?.assigned_rep ?? "",
    last_contacted_at: lead?.last_contacted_at ?? fallback?.last_contacted_at ?? null,
    updated_at: lead?.updated_at || fallback?.updated_at || new Date().toISOString(),
    source_lane: lead?.source_lane || fallback?.source_lane || "n8n",
  };
}

export function mergeLeadLists(prevLeads = [], incomingLeads = []) {
  const merged = new Map();
  prevLeads.forEach((lead) => {
    const key = String(lead?.lead_id || lead?.id || "").trim();
    if (key) merged.set(key, normalizeLeadRecord(lead));
  });

  incomingLeads.forEach((lead) => {
    const key = String(lead?.lead_id || lead?.id || "").trim();
    if (!key) return;
    const current = merged.get(key);
    const incoming = normalizeLeadRecord(lead, current || {});
    if (!current) {
      merged.set(key, incoming);
      return;
    }
    const currentTime = new Date(current.updated_at || 0).getTime();
    const incomingTime = new Date(incoming.updated_at || 0).getTime();
    merged.set(key, incomingTime > currentTime ? incoming : { ...current, ...incoming, market: incoming.market || current.market, status: incoming.status || current.status });
  });

  return Array.from(merged.values()).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

export function getLeadIdentityTokens(lead = {}) {
  const tokens = [];
  const leadId = String(lead.lead_id || lead.id || "").trim().toLowerCase();
  const email = String(lead.email || lead.contact_email || "").trim().toLowerCase();
  const phone = normalizeLeadPhone(lead.phone || lead.contact_phone || "");
  const company = String(lead.company || "").trim().toLowerCase();
  const city = String(lead.city || "").trim().toLowerCase();

  if (leadId) tokens.push(`id:${leadId}`);
  if (email) tokens.push(`email:${email}`);
  if (phone.length >= 10) tokens.push(`phone:${phone}`);
  if (email && phone.length >= 10) tokens.push(`email_phone:${email}|${phone}`);
  if (!leadId && !email && phone.length < 10 && company && city) tokens.push(`company_city:${company}|${city}`);
  return tokens;
}

export function ensureUniqueLeadId(baseId, usedIds = new Set()) {
  const cleanBase = String(baseId || "").trim() || `LD-${Date.now()}`;
  if (!usedIds.has(cleanBase)) {
    usedIds.add(cleanBase);
    return cleanBase;
  }

  let index = 2;
  let candidate = `${cleanBase}-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${cleanBase}-${index}`;
  }

  usedIds.add(candidate);
  return candidate;
}