import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List as VirtualList } from "react-window";
import { validateLead } from "../../lib/leadValidation";

const C = {
  bg: "#0B1020",
  surface: "#121A2B",
  card: "#121826",
  border: "#243047",
  text: "#E5EEF8",
  muted: "#94A3B8",
  dim: "#64748B",
  accent: "#00D4AA",
  accentDim: "rgba(0, 212, 170, 0.14)",
  gold: "#FBBF24",
  goldDim: "rgba(251,191,36,0.15)",
  blue: "#60A5FA",
  blueDim: "rgba(96,165,250,0.15)",
  purple: "#A78BFA",
  red: "#FF4757",
};

const S = {
  h2: { fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" },
  h3: { fontSize: 16, fontWeight: 800, marginBottom: 10 },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 },
  cardSm: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 },
  divider: { height: 1, background: C.border, margin: "18px 0" },
  label: { fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" },
  input: { width: "100%", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" },
  select: { width: "100%", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" },
  btn: (tone) => {
    const map = {
      primary: { background: C.accent, color: "#06261F", border: "none" },
      ghost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}` },
      sm: { background: C.blue, color: "#08101E", border: "none" },
      danger: { background: C.red, color: "#fff", border: "none" },
    };
    const pick = map[tone] || map.ghost;
    return { padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, ...pick };
  },
};

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ ...S.cardSm, display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: `${color}22`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
        {sub ? <div style={{ fontSize: 11, color: C.dim }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width: "100%", maxWidth: wide ? 960 : 640, maxHeight: "90vh", overflowY: "auto", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, boxSizing: "border-box" }}>
        {title ? <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

const COLD_STATUSES = ["New","Contacted","Follow Up","Meeting Booked","Won","Lost"];
const COLD_STATUS_COLOR = {
  "New": C.blue,
  "Contacted": C.gold,
  "Follow Up": "#FF6B6B",
  "Meeting Booked": C.accent,
  "Won": C.accent,
  "Lost": C.dim,
};
const SEGMENT_META = {
  "Office": { icon:"🏢", color:"#3B82F6", tone:"professional office management" },
  "Medical": { icon:"🏥", color:"#EF4444", tone:"medical / clinical environment" },
  "Industrial-Office": { icon:"🏭", color:"#F59E0B", tone:"industrial facility operations" },
  "Property Manager": { icon:"🏘️", color:"#8B5CF6", tone:"property management / tenant services" },
  "Dental": { icon:"🦷", color:"#06B6D4", tone:"dental practice / patient environment" },
};
const COLD_SYNC_AT_KEY = "cp:last_synced_at:cold_leads";
const LEAD_PAGE_SIZE = 100;
const LEAD_VIRTUALIZE_THRESHOLD = 80;
const LEAD_ROW_HEIGHT = 96;

const normalizeLeadPhone = (value = "") => String(value || "").replace(/\D/g, "");
const normalizeLeadMarket = (lead) => {
  const m = (lead?.market || "").trim().toLowerCase();
  if (m.includes("ontario")) return "Ontario";
  if (m.includes("arizona")) return "Arizona";
  const id = (lead?.lead_id || lead?.id || "").toUpperCase();
  if (id.startsWith("ON-") || id.startsWith("ON-M")) return "Ontario";
  if (id.startsWith("AZ-")) return "Arizona";
  return "";
};
const normalizeLeadRecord = (lead, fallback = {}) => ({
  ...fallback,
  ...lead,
  lead_id: String(lead?.lead_id || lead?.id || fallback?.lead_id || "").trim(),
  id: lead?.id || lead?.lead_id || fallback?.id || undefined,
  company: lead?.company || fallback?.company || "",
  city: lead?.city || fallback?.city || "",
  market: normalizeLeadMarket(lead) || lead?.market || fallback?.market || "Ontario",
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
});
const mergeLeadLists = (prevLeads, incomingLeads) => {
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
    merged.set(key, incomingTime > currentTime ? incoming : { ...current, ...incoming });
  });
  return Array.from(merged.values()).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
};
const getLeadIdentityTokens = (lead = {}) => {
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
};
const ensureUniqueLeadId = (baseId, usedIds) => {
  const cleanBase = String(baseId || "").trim() || `LD-${Date.now()}`;
  if (!usedIds.has(cleanBase)) {
    usedIds.add(cleanBase);
    return cleanBase;
  }
  let i = 2;
  let candidate = `${cleanBase}-${i}`;
  while (usedIds.has(candidate)) {
    i += 1;
    candidate = `${cleanBase}-${i}`;
  }
  usedIds.add(candidate);
  return candidate;
};
const formatLeadContactBadge = (value) => {
  if (!value) return "";
  try {
    const date = new Date(value);
    return `Contacted ${date.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })}`;
  } catch {
    return "Contacted recently";
  }
};
const parseOutreachSections = (text) => {
  const extract = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    cold_email: extract("COLD_EMAIL"),
    follow_up_email: extract("FOLLOW_UP_EMAIL"),
    linkedin_note: extract("LINKEDIN_NOTE"),
    call_opener: extract("CALL_OPENER"),
  };
};

async function sbFetch(path, opts = {}) {
  try {
    const { getSupabaseConfig } = await import("../../lib/supabaseConfig");
    const config = getSupabaseConfig(typeof import.meta !== "undefined" ? import.meta.env : {});
    const headers = {
      apikey: config.anon,
      Authorization: `Bearer ${config.anon}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };
    return fetch(`${config.url}/rest/v1/${path}`, { ...opts, headers });
  } catch {
    return null;
  }
}

async function generateUpgradedOutreach(lead) {
  const prompt = `Write improved commercial cleaning outreach for ${lead.company} in ${lead.city}, ${lead.market}. Return sections COLD_EMAIL, FOLLOW_UP_EMAIL, LINKEDIN_NOTE, CALL_OPENER.`;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

export default function ColdOutreachView({ region, coldLeads, setColdLeads, page = 0, setPage = () => {}, deletedLeadIds = new Set(), setDeletedLeadIds = () => {}, filterMktProp = "All", setFilterMktProp = () => {} }) {
  const leads = coldLeads;
  const setLeads = setColdLeads;
  const [viewLead, setViewLead] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSeg, setFilterSeg] = useState("All");
  const filterMkt = filterMktProp;
  const handleSetFilterMkt = (v) => { setFilterMktProp(v); setPage(0); };
  const [upgrading, setUpgrading] = useState(false);
  const [upgradedContent, setUpgradedContent] = useState(null);
  const [copied, setCopied] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [lastSynced, setLastSynced] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => { try { return localStorage.getItem(COLD_SYNC_AT_KEY) || null; } catch { return null; } });
  const [syncStats, setSyncStats] = useState({ fetched:0, valid:0, invalid:0, skipped:0, saved:0 });
  const [syncProgress, setSyncProgress] = useState({ loaded:0, total:0, stage:"Idle" });
  const persistQueueRef = useRef(new Map());
  const persistQueueTimerRef = useRef(null);
  const snapshotTimerRef = useRef(null);
  const [manualForm, setManualForm] = useState({ company:"", city:"", market:"Ontario", segment:"Office", buyer_title:"", pain_point:"", first_offer:"office cleaning", priority_score:3, notes:"" });

  const persistLeadSnapshot = useCallback((nextLeads) => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      try { localStorage.setItem("cp:cold_leads", JSON.stringify(nextLeads)); } catch {}
    }, 200);
  }, []);

  const queueLeadPersist = useCallback((lead) => {
    const lid = String(lead?.lead_id || lead?.id || "").trim();
    if (!lid) return;
    persistQueueRef.current.set(lid, { lead_id: lid, data: normalizeLeadRecord(lead), updated_at: new Date().toISOString() });
    if (persistQueueTimerRef.current) clearTimeout(persistQueueTimerRef.current);
    persistQueueTimerRef.current = setTimeout(async () => {
      const rows = Array.from(persistQueueRef.current.values());
      persistQueueRef.current.clear();
      if (!rows.length) return;
      try {
        await sbFetch("huc_leads_cold?on_conflict=lead_id", { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      } catch {}
    }, 300);
  }, []);

  const loadCachedColdLeads = useCallback(async () => {
    try {
      const raw = localStorage.getItem("cp:cold_leads");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    try {
      const r = await sbFetch("huc_leads_cold?select=*");
      if (!r || !r.ok) return [];
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) return [];
      return rows.map(row => normalizeLeadRecord(row?.data || row, row?.data || row)).filter(Boolean).filter((lead) => validateLead(lead).valid);
    } catch {
      return [];
    }
  }, []);

  const refreshFromSupabase = useCallback(async () => {
    try {
      const incoming = await loadCachedColdLeads();
      if (incoming.length === 0) return false;
      setLeads(prev => {
        const next = mergeLeadLists(prev, incoming);
        persistLeadSnapshot(next);
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, [loadCachedColdLeads, persistLeadSnapshot, setLeads]);

  const loadCloudLeadIndex = useCallback(async () => {
    try {
      const r = await sbFetch("huc_leads_cold?select=lead_id,data,updated_at");
      if (!r || !r.ok) return { leads: [], tokens: new Set(), ids: new Set() };
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) return { leads: [], tokens: new Set(), ids: new Set() };
      const loadedLeads = rows.map(row => normalizeLeadRecord(row?.data || {}, { lead_id: row?.lead_id, updated_at: row?.updated_at })).filter(Boolean);
      const tokens = new Set();
      const ids = new Set();
      loadedLeads.forEach((lead) => {
        const lid = String(lead.lead_id || lead.id || "").trim();
        if (lid) ids.add(lid);
        getLeadIdentityTokens(lead).forEach(token => tokens.add(token));
      });
      return { leads: loadedLeads, tokens, ids };
    } catch {
      return { leads: [], tokens: new Set(), ids: new Set() };
    }
  }, []);

  const syncSheet = useCallback(async () => {
    setLoadingSheet(true);
    setSyncError("");
    setSyncProgress({ loaded: 0, total: 0, stage: "Fetching leads..." });
    try {
      const res = await fetch("/api/leads/sync?start=0&limit=5000");
      const data = await res.json().catch(() => ({}));
      const fallbackToCachedLeads = async (reason = "") => {
        const cachedLeads = await loadCachedColdLeads();
        if (cachedLeads.length > 0) {
          const mergedCached = mergeLeadLists(coldLeads || [], cachedLeads);
          setColdLeads(mergedCached);
          persistLeadSnapshot(mergedCached);
          setSyncError(reason || "The live sheet sync is unavailable right now. Showing your cached leads instead.");
          setLastSynced(`Cached ${mergedCached.length} leads`);
          setSyncStats({ fetched: 0, valid: mergedCached.length, invalid: 0, skipped: 0, saved: 0 });
          setSyncProgress({ loaded: mergedCached.length, total: mergedCached.length, stage: "Using cached leads" });
          return true;
        }
        setSyncError(reason || "The live sheet sync is unavailable right now and no cached leads were found.");
        return false;
      };
      if (!res.ok || data?.error || data?.fallback === "missing_env") {
        await fallbackToCachedLeads(data?.message || data?.error || "The live sheet sync is unavailable right now.");
        return;
      }
      const rawLeads = Array.isArray(data.leads) ? data.leads : [];
      if (!rawLeads.length) {
        await fallbackToCachedLeads(data?.message || "The sheet returned no leads right now.");
        return;
      }
      const validLeads = [];
      const invalidLeads = [];
      let skipped = 0;
      const seenLeadIds = new Set();
      const totalCount = data.total_count || data.raw_count || data.count || rawLeads.length;
      for (const lead of rawLeads) {
        const lid = String(lead?.lead_id || lead?.id || "").trim();
        if (deletedLeadIds.has(lid)) { skipped += 1; continue; }
        const normalizedLead = { ...lead, lead_id: lid || `lead-${validLeads.length + invalidLeads.length + 1}`, id: lead?.id || lid || `lead-${validLeads.length + invalidLeads.length + 1}` };
        const validation = validateLead(normalizedLead);
        if (!validation.valid) { invalidLeads.push({ lead: normalizedLead, reason: validation.reason }); continue; }
        if (seenLeadIds.has(normalizedLead.lead_id)) {
          normalizedLead.lead_id = `${normalizedLead.lead_id}-${seenLeadIds.size + 1}`;
          normalizedLead.id = normalizedLead.lead_id;
        }
        seenLeadIds.add(normalizedLead.lead_id);
        validLeads.push(normalizedLead);
      }
      if (!validLeads.length) {
        await fallbackToCachedLeads(`Sheet returned ${rawLeads.length} rows but none passed validation.`);
        return;
      }
      setSyncProgress({ loaded: validLeads.length, total: totalCount || validLeads.length, stage: "Checking existing leads..." });
      const prevLeads = coldLeads || [];
      const cloudIndex = await loadCloudLeadIndex();
      const existingTokens = new Set(cloudIndex.tokens);
      const usedLeadIds = new Set(cloudIndex.ids);
      prevLeads.forEach((lead) => {
        const lid = String(lead?.lead_id || lead?.id || "").trim();
        if (lid) usedLeadIds.add(lid);
        getLeadIdentityTokens(lead).forEach(token => existingTokens.add(token));
      });
      const newLeads = [];
      let existingSkipped = 0;
      for (const sheetLead of validLeads) {
        const tokens = getLeadIdentityTokens(sheetLead);
        if (tokens.some(token => existingTokens.has(token))) { existingSkipped += 1; continue; }
        const nextLeadId = ensureUniqueLeadId(sheetLead.lead_id || sheetLead.id, usedLeadIds);
        const nextLead = { ...sheetLead, lead_id: nextLeadId, id: nextLeadId, status: sheetLead.status || "New", notes: sheetLead.notes || "", source_lane: sheetLead.source_lane || "n8n", updated_at: new Date().toISOString() };
        newLeads.push(nextLead);
        getLeadIdentityTokens(nextLead).forEach(token => existingTokens.add(token));
      }
      const final = mergeLeadLists(mergeLeadLists(prevLeads, cloudIndex.leads), newLeads);
      setColdLeads(final);
      persistLeadSnapshot(final);
      const rows = newLeads.map((lead) => ({ lead_id: String(lead.lead_id || lead.id || "").trim(), data: lead, updated_at: new Date().toISOString() }));
      if (rows.length) await sbFetch("huc_leads_cold?on_conflict=lead_id", { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }).catch(() => null);
      const nowIso = new Date().toISOString();
      try { localStorage.setItem(COLD_SYNC_AT_KEY, nowIso); } catch {}
      setLastSyncedAt(nowIso);
      setLastSynced(`v5.41 · ${new Date().toLocaleTimeString()} · fetched ${rawLeads.length} · valid ${validLeads.length} · invalid ${invalidLeads.length} · existing ${existingSkipped} · new ${newLeads.length}`);
      setSyncStats({ fetched: rawLeads.length, valid: validLeads.length, invalid: invalidLeads.length, skipped: skipped + existingSkipped, saved: newLeads.length });
      setSyncProgress({ loaded: rawLeads.length, total: totalCount || rawLeads.length, stage: "Sync complete" });
    } catch {
      setSyncError("The live sheet sync hit an unexpected error.");
    } finally {
      setLoadingSheet(false);
    }
  }, [coldLeads, deletedLeadIds, loadCachedColdLeads, loadCloudLeadIndex, persistLeadSnapshot, setColdLeads]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshFromSupabase();
    };
    tick();
    const timer = setInterval(tick, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refreshFromSupabase]);

  useEffect(() => { syncSheet(); }, [syncSheet]);

  useEffect(() => () => {
    if (persistQueueTimerRef.current) clearTimeout(persistQueueTimerRef.current);
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
  }, []);

  const normalizedLeads = useMemo(() => {
    const normalizeCompany = (name) => String(name || "").trim().toLowerCase().replace(/[.,'"`\-–—&()/\\|:;!?*#]/g, " ").replace(/\s+/g, " ").trim();
    return leads.map((lead) => ({ lead, market: normalizeLeadMarket(lead), status: lead?.status || "New", segment: lead?.segment || "", companyKey: `${normalizeCompany(lead?.company || "")}|${String(lead?.city || "").trim().toLowerCase()}` }));
  }, [leads]);
  const filterLeadRows = useCallback((status, market, segment) => {
    const seenCompanies = new Set();
    const results = [];
    for (const row of normalizedLeads) {
      const { lead, market: normalizedMarket, status: leadStatus, segment: leadSegment, companyKey } = row;
      if (!lead?.company?.trim()) continue;
      const marketMatch = market === "All" || (market === "Ontario" && normalizedMarket === "Ontario") || (market === "Arizona" && normalizedMarket === "Arizona");
      if (!marketMatch) continue;
      if (status !== "All" && leadStatus !== status) continue;
      if (segment !== "All" && leadSegment !== segment) continue;
      if (!companyKey || seenCompanies.has(companyKey)) continue;
      seenCompanies.add(companyKey);
      results.push(lead);
    }
    return results;
  }, [normalizedLeads]);
  const filtered = useMemo(() => filterLeadRows(filterStatus, filterMkt, filterSeg), [filterLeadRows, filterStatus, filterMkt, filterSeg]);
  const statusCounts = useMemo(() => {
    const counts = new Map();
    counts.set("All", filterLeadRows("All", filterMkt, filterSeg).length);
    COLD_STATUSES.forEach((status) => counts.set(status, filterLeadRows(status, filterMkt, filterSeg).length));
    return counts;
  }, [filterLeadRows, filterMkt, filterSeg]);
  const marketCounts = useMemo(() => {
    const counts = new Map();
    ["All", "Ontario", "Arizona"].forEach((market) => counts.set(market, filterLeadRows(filterStatus, market, filterSeg).length));
    return counts;
  }, [filterLeadRows, filterStatus, filterSeg]);
  const segmentCounts = useMemo(() => {
    const counts = new Map();
    ["All","Office","Medical","Dental","Industrial-Office","Property Manager"].forEach((segment) => counts.set(segment, filterLeadRows(filterStatus, filterMkt, segment).length));
    return counts;
  }, [filterLeadRows, filterStatus, filterMkt]);
  const totalPages = Math.ceil(filtered.length / LEAD_PAGE_SIZE) || 1;
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = filtered.slice(safePage * LEAD_PAGE_SIZE, (safePage + 1) * LEAD_PAGE_SIZE);
  const total = leads.length;
  const hot = filtered.filter(l => l.priority_score >= 4).length;
  const booked = filtered.filter(l => l.status === "Meeting Booked").length;
  const won = filtered.filter(l => l.status === "Won").length;
  const convRate = total > 0 ? Math.round((won / total) * 100) : 0;

  const updateStatus = async (id, status, extra = {}) => {
    let updatedLead = null;
    setLeads(ls => {
      const next = ls.map(l => {
        const match = l.id === id || l.lead_id === id;
        if (!match) return l;
        updatedLead = { ...l, status, ...extra, ...(status === "Contacted" ? { last_contacted_at: extra.last_contacted_at || new Date().toISOString(), assigned_rep: extra.assigned_rep || l.assigned_rep || "Current Rep" } : {}) };
        return updatedLead;
      });
      persistLeadSnapshot(next);
      return next;
    });
    if (updatedLead) queueLeadPersist(updatedLead);
  };

  const updateNotes = (id, notes) => {
    let updatedLead = null;
    setLeads(ls => {
      const next = ls.map(l => {
        if (l.lead_id !== id) return l;
        updatedLead = { ...l, notes, updated_at: new Date().toISOString() };
        return updatedLead;
      });
      persistLeadSnapshot(next);
      return next;
    });
    if (viewLead?.lead_id === id) setViewLead(v => ({ ...v, notes }));
    if (updatedLead) queueLeadPersist(updatedLead);
  };

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  const upgradeOutreach = async (lead) => {
    setUpgrading(true);
    setUpgradedContent(null);
    try {
      const text = await generateUpgradedOutreach(lead);
      const sections = parseOutreachSections(text);
      let updatedLead = null;
      setLeads(ls => {
        const next = ls.map(l => {
          if (l.lead_id !== lead.lead_id) return l;
          updatedLead = { ...l, ...sections, updated_at: new Date().toISOString() };
          return updatedLead;
        });
        persistLeadSnapshot(next);
        return next;
      });
      setUpgradedContent(sections);
      setViewLead(v => ({ ...v, ...sections }));
      if (updatedLead) queueLeadPersist(updatedLead);
    } catch {
      alert("Upgrade failed. Check your API connection.");
    }
    setUpgrading(false);
  };

  const addManualLead = async () => {
    if (!manualForm.company.trim()) return;
    const prefix = manualForm.market === "Arizona" ? "AZ" : "ON";
    const num = String(leads.length + 1).padStart(4, "0");
    const newLead = normalizeLeadRecord({ ...manualForm, lead_id: `${prefix}-M${num}`, status: "New", owner: "Jason", cold_email: "", follow_up_email: "", linkedin_note: "", call_opener: "", source_lane: "Manual Entry", updated_at: new Date().toISOString() });
    setLeads(ls => {
      const next = [newLead, ...ls];
      persistLeadSnapshot(next);
      return next;
    });
    queueLeadPersist(newLead);
    setShowManual(false);
    setManualForm({ company:"", city:"", market:"Ontario", segment:"Office", buyer_title:"", pain_point:"", first_offer:"office cleaning", priority_score:3, notes:"" });
    setViewLead(newLead);
  };

  const deleteLead = async (id) => {
    if (!id) return;
    const lid = String(id);
    setLeads(ls => {
      const next = ls.filter(l => l.lead_id !== lid && l.id !== lid);
      persistLeadSnapshot(next);
      return next;
    });
    if (viewLead?.lead_id === lid || viewLead?.id === lid) setViewLead(null);
    setDeletedLeadIds(prev => new Set([...prev, lid]));
    try { await sbFetch(`huc_leads_cold?lead_id=eq.${encodeURIComponent(lid)}`, { method: "DELETE" }); } catch {}
  };

  const LeadRow = useCallback(({ index, style, ariaAttributes, leads: rowLeads, onOpen, onDelete, lastSyncedLabel, lastSyncAt }) => {
    const lead = rowLeads[index];
    const lid = lead.lead_id || lead.id || `${lead.company || ""}-${lead.city || ""}-${lead.segment || ""}`;
    const realId = lead.lead_id || lead.id;
    const seg = SEGMENT_META[lead.segment] || SEGMENT_META.Office;
    const statusColor = COLD_STATUS_COLOR[lead.status] || C.muted;
    const hasOutreach = !!(lead.cold_email || lead.follow_up_email);
    return (
      <div style={{ ...style, boxSizing: "border-box", paddingBottom: 10 }} {...ariaAttributes}>
        <div style={{ ...S.card, padding:0, overflow:"hidden", borderLeft:`3px solid ${seg.color}`, display:"flex", alignItems:"stretch", height: LEAD_ROW_HEIGHT - 10 }}>
          <div style={{ flex:1, padding:"13px 14px", cursor:"pointer", minWidth:0 }} onClick={() => onOpen(lead)}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ width:34, height:34, borderRadius:8, background:`${seg.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{seg.icon}</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:lead.company?C.text:C.red }}>{lead.company || "⚠️ No company name"}</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>🔄 Live Google Sheet Connection{lastSyncedLabel ? ` · Last synced ${lastSyncedLabel}` : " · Not yet synced"}{lastSyncAt ? ` · last_synced_at ${new Date(lastSyncAt).toLocaleString()}` : ""}</div>
                <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                  <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{lead.status || "New"}</span>
                  {lead.status === "Contacted" && lead.last_contacted_at ? <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:C.goldDim, color:C.gold }}>{formatLeadContactBadge(lead.last_contacted_at)}</span> : null}
                  {hasOutreach ? <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:C.accentDim, color:C.accent }}>✉️</span> : null}
                </div>
              </div>
            </div>
          </div>
          <div style={{ width:56, borderLeft:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <button style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.dim, padding:"8px 0", lineHeight:1 }} onClick={() => realId && onDelete(realId)}>🗑</button>
          </div>
        </div>
      </div>
    );
  }, []);

  if (viewLead) {
    const seg = SEGMENT_META[viewLead.segment] || SEGMENT_META.Office;
    const outreach = upgradedContent || viewLead;
    const statusColor = COLD_STATUS_COLOR[viewLead.status] || C.muted;
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <button style={{ ...S.btn("ghost"), fontSize:13 }} onClick={() => { setViewLead(null); setUpgradedContent(null); }}>← All Leads</button>
          <button style={{ ...S.btn("ghost"), fontSize:12, color:C.red, borderColor:`${C.red}55` }} onClick={() => deleteLead(viewLead.lead_id || viewLead.id)}>🗑 Delete Lead</button>
        </div>
        <div style={{ ...S.card, marginBottom:18, background:"linear-gradient(135deg,#0A0F1E,#1A2235)", borderLeft:`4px solid ${seg.color}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12, marginBottom:14 }}>
            <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
              <div style={{ width:52, height:52, borderRadius:14, background:`${seg.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, border:`1px solid ${seg.color}44`, flexShrink:0 }}>{seg.icon}</div>
              <div>
                <div style={{ fontWeight:800, fontSize:22 }}>{viewLead.company}</div>
                <div style={{ fontSize:14, color:C.muted }}>📍 {viewLead.city}, {viewLead.market} · {viewLead.segment}</div>
                <div style={{ fontSize:13, color:C.muted }}>👤 {viewLead.buyer_title}</div>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
              <span style={{ padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{viewLead.status}</span>
              <div style={{ fontSize:11, color:C.dim }}>{viewLead.lead_id}</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button style={{ ...S.btn("primary"), fontSize:12, padding:"8px 14px", background: upgrading ? C.dim : "#7C3AED" }} onClick={() => upgradeOutreach(viewLead)} disabled={upgrading}>{upgrading ? "✨ Upgrading..." : "✨ Upgrade Outreach with AI"}</button>
          </div>
        </div>
        <div style={{ ...S.card, marginBottom:18 }}>
          <div style={S.label}>Pipeline Status</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
            {COLD_STATUSES.map(s => {
              const col = COLD_STATUS_COLOR[s];
              const active = viewLead.status === s;
              return <button key={s} onClick={() => updateStatus(viewLead.lead_id, s, s === "Contacted" ? { assigned_rep: viewLead.assigned_rep || "Current Rep" } : {})} style={{ padding:"6px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700, background: active ? `${col}33` : C.surface, color: active ? col : C.muted, border: `1px solid ${active ? col : C.border}` }}>{active ? "● " : ""}{s}</button>;
            })}
          </div>
          <div style={{ marginTop:12 }}>
            <div style={S.label}>Notes</div>
            <textarea style={{ ...S.input, minHeight:60, resize:"vertical", marginTop:4 }} value={viewLead.notes || ""} onChange={e => updateNotes(viewLead.lead_id, e.target.value)} placeholder="Call notes, meeting outcome, follow-up date..." />
          </div>
        </div>
        {[
          { key:"cold_email", label:"📧 Cold Email", icon:"📋" },
          { key:"follow_up_email", label:"📧 Follow-Up Email", icon:"📋" },
          { key:"linkedin_note", label:"💼 LinkedIn Note", icon:"📋" },
          { key:"call_opener", label:"📞 Call Opener Script", icon:"📋" },
        ].map(({ key, label, icon }) => {
          const val = outreach[key] || viewLead[key];
          if (!val) return null;
          return (
            <div key={key} style={{ ...S.card, marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontWeight:700, fontSize:14 }}>{label}</div>
                <button style={{ ...S.btn("sm"), background: copied===key ? C.accentDim : C.surface, color: copied===key ? C.accent : C.muted, fontSize:11 }} onClick={() => copy(val, key)}>{copied === key ? "✅ Copied!" : `${icon} Copy`}</button>
              </div>
              <div style={{ background:C.surface, borderRadius:10, padding:14, fontSize:13, color:C.muted, lineHeight:1.8, whiteSpace:"pre-wrap", maxHeight:220, overflowY:"auto", border:`1px solid ${C.border}` }}>{val}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🎯 Cold Outreach Pipeline</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>Leads generated daily by your n8n AI agent · Ontario & Arizona</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={S.btn("ghost")} onClick={syncSheet} disabled={loadingSheet} title="Pull latest leads from Google Sheet">{loadingSheet ? "🔄 Syncing..." : `🔄 Sync Sheet${lastSynced ? ` · ${lastSynced}` : ""}`}</button>
          <button style={S.btn("primary")} onClick={() => setShowManual(true)}>+ Add Lead</button>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,180px),1fr))", gap:12 }}>
        <StatCard label="Total Pipeline" value={total} icon="🎯" color={C.blue} />
        <StatCard label="Hot Leads (4-5)" value={hot} icon="🔥" color={C.red} />
        <StatCard label="Meetings Booked" value={booked} icon="📅" color={C.accent} />
        <StatCard label="Won" value={won} icon="🏆" color={C.gold} sub={`${convRate}% conv.`} />
        <StatCard label="Validation" value={`${syncStats.valid}/${syncStats.fetched}`} icon="✅" color={C.purple} sub={`${syncStats.invalid} invalid · ${syncStats.skipped} skipped`} />
      </div>
      <div style={S.divider} />
      <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.blue}`, padding:"12px 16px" }}>
        <div style={{ fontWeight:700, color:C.blue, fontSize:14, marginBottom:4 }}>🔄 Live Google Sheet Connection{lastSynced ? ` · Last synced ${lastSynced}` : " · Not yet synced"}</div>
        {loadingSheet ? <div style={{ fontSize:12, color:C.text }}>{syncProgress.stage} · {syncProgress.loaded.toLocaleString()} / {syncProgress.total.toLocaleString()}</div> : null}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
        {["All", ...COLD_STATUSES].map(s => {
          const col = COLD_STATUS_COLOR[s] || C.accent;
          const count = statusCounts.get(s) || 0;
          const active = filterStatus === s;
          return <button key={s} onClick={() => { setFilterStatus(s); setPage(0); }} style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700, background: active ? `${col}22` : C.surface, color: active ? col : C.muted, border: `1px solid ${active ? col : C.border}` }}>{s} {count > 0 ? <span style={{ marginLeft:4, background:`${col}33`, borderRadius:20, padding:"1px 7px", fontSize:11 }}>{count}</span> : null}</button>;
        })}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
        {["All", "Ontario", "Arizona"].map(m => <button key={m} onClick={() => handleSetFilterMkt(m)} style={{ padding:"4px 12px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600, background: filterMkt===m ? C.accentDim : C.surface, color: filterMkt===m ? C.accent : C.muted, border: `1px solid ${filterMkt===m ? C.accent : C.border}` }}>{m} ({marketCounts.get(m) || 0})</button>)}
        {["All","Office","Medical","Dental","Industrial-Office","Property Manager"].map(seg => <button key={seg} onClick={() => { setFilterSeg(seg); setPage(0); }} style={{ padding:"4px 12px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600, background: filterSeg===seg ? C.accentDim : C.surface, color: filterSeg===seg ? C.accent : C.muted, border: `1px solid ${filterSeg===seg ? C.accent : C.border}` }}>{seg} ({segmentCounts.get(seg) || 0})</button>)}
      </div>
      {filtered.length > LEAD_PAGE_SIZE ? <div style={{ fontSize:12, color:C.muted, marginBottom:8, textAlign:"right" }}>Page {safePage+1} of {totalPages} · {filtered.length} leads</div> : null}
      <div id="cold-leads-list" style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.length === 0 ? <div style={{ ...S.card, textAlign:"center", padding:40 }}><div style={{ fontSize:40, marginBottom:12 }}>🎯</div><div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>No leads in this view</div></div> : filtered.length > LEAD_VIRTUALIZE_THRESHOLD ? (
          <VirtualList rowComponent={LeadRow} rowCount={paginated.length} rowHeight={LEAD_ROW_HEIGHT} rowProps={{ leads: paginated, onOpen: (lead) => { setViewLead(lead); setUpgradedContent(null); setConfirmDelete(null); }, onDelete: deleteLead, lastSyncedLabel: lastSynced, lastSyncAt: lastSyncedAt }} style={{ height: 760 }} />
        ) : paginated.map((lead) => {
          const lid = lead.lead_id || lead.id || `${lead.company||""}-${lead.city||""}-${lead.segment||""}`;
          const realId = lead.lead_id || lead.id;
          const seg = SEGMENT_META[lead.segment] || SEGMENT_META.Office;
          const statusColor = COLD_STATUS_COLOR[lead.status] || C.muted;
          const hasOutreach = !!(lead.cold_email || lead.follow_up_email);
          return (
            <div key={lid} style={{ ...S.card, padding:0, overflow:"hidden", borderLeft:`3px solid ${seg.color}`, display:"flex", alignItems:"stretch" }}>
              <div style={{ flex:1, padding:"13px 14px", cursor:"pointer", minWidth:0 }} onClick={() => { setViewLead(lead); setUpgradedContent(null); setConfirmDelete(null); }}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <div style={{ width:34, height:34, borderRadius:8, background:`${seg.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{seg.icon}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:lead.company?C.text:C.red }}>{lead.company || "⚠️ No company name"}</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>🔄 Live Google Sheet Connection{lastSynced ? ` · Last synced ${lastSynced}` : " · Not yet synced"}{lastSyncedAt ? ` · last_synced_at ${new Date(lastSyncedAt).toLocaleString()}` : ""}</div>
                    <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                      <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{lead.status || "New"}</span>
                      {hasOutreach ? <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:C.accentDim, color:C.accent }}>✉️</span> : null}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ width:56, borderLeft:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.dim, padding:"8px 0", lineHeight:1 }} onClick={() => realId && deleteLead(realId)}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length > LEAD_PAGE_SIZE ? <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:8, marginTop:16, flexWrap:"wrap" }}><button style={{ ...S.btn("ghost"), fontSize:13, padding:"8px 16px" }} disabled={safePage===0} onClick={() => setPage(Math.max(0, safePage - 1))}>← Prev</button><span style={{ fontSize:13, color:C.muted }}>Page {safePage+1} of {totalPages}</span><button style={{ ...S.btn(safePage<totalPages-1?"primary":"ghost"), fontSize:13, padding:"8px 16px" }} disabled={safePage>=totalPages-1} onClick={() => setPage(safePage + 1)}>Next →</button></div> : null}
      {showManual ? <Modal title="+ Add Lead Manually" onClose={() => setShowManual(false)} wide><div style={{ display:"flex", flexDirection:"column", gap:12 }}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}><div><div style={S.label}>Company Name</div><input style={S.input} value={manualForm.company} onChange={e=>setManualForm({...manualForm,company:e.target.value})} /></div><div><div style={S.label}>City</div><input style={S.input} value={manualForm.city} onChange={e=>setManualForm({...manualForm,city:e.target.value})} /></div></div><button style={{ ...S.btn("primary"), width:"100%" }} onClick={addManualLead} disabled={!manualForm.company.trim()}>💾 Add to Pipeline</button></div></Modal> : null}
    </div>
  );
}
