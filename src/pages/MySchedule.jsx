import React, { useState } from "react";
import { C } from "../lib/constants";
import {
  getTodayJobs,
  getUpcomingJobs,
  getCompletedJobs,
} from "../features/views/smartViews";

/**
 * MySchedule
 *
 * Mobile-first schedule page wired to smartViews helpers.
 * getTodayJobs() is the primary data source for the Today tab.
 *
 * Props:
 *  jobs       — full jobs array
 *  partners   — full partners array
 *  partner    — authenticated partner object (or null for admin/all view)
 *  region     — active region object
 *  S          — shared style object (kept for API consistency, not used directly)
 */
export default function MySchedule({ jobs = [], partners = [], partner = null, region }) {
  const [activeTab, setActiveTab] = useState("today");
  const cur = region?.currencySymbol || "$";

  // ── Scope to partner if authenticated ──
  const myJobs = partner
    ? jobs.filter(j => (j.partnerIds || [j.partnerId]).includes(partner.id))
    : jobs;

  // ── Smart views — single source of truth ──
  const todayJobs     = getTodayJobs(myJobs);
  const upcomingJobs  = getUpcomingJobs(myJobs);
  const completedJobs = getCompletedJobs(myJobs);
  const inProgress    = todayJobs.filter(j => j.status === "in-progress");

  // ── Stats ──
  const pendingPay = myJobs
    .filter(j => ["scheduled", "in-progress"].includes(j.status))
    .reduce((sum, j) => sum + (j.partnerPay || j.pay || 0), 0);
  const totalEarned = completedJobs
    .reduce((sum, j) => sum + (j.partnerPay || j.pay || 0), 0);

  // ─── Styles ──────────────────────────────────────────────────────────────
  const st = {
    page:        { padding: "16px", maxWidth: 640, margin: "0 auto", paddingBottom: 88 },
    greeting:    { fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.3px" },
    date:        { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 20 },
    statsRow:    { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 },
    statBox:     (c) => ({ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${c}`, borderRadius: 12, padding: "12px 14px" }),
    statVal:     (c) => ({ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1 }),
    statLabel:   { fontSize: 11, color: C.muted, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
    tabs:        { display: "flex", gap: 6, marginBottom: 20, overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" },
    tab:         (a) => ({ padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", background: a ? C.accent : C.card, color: a ? "#0A0F1E" : C.muted, flexShrink: 0, minHeight: 36 }),
    sectionLbl:  { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, marginTop: 4 },
    jobCard:     (s) => ({ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${s === "in-progress" ? C.gold : s === "completed" ? C.accent : C.blue}`, borderRadius: 12, padding: 16, marginBottom: 12 }),
    jobClient:   { fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 },
    jobMeta:     { fontSize: 13, color: C.muted, marginBottom: 2, lineHeight: 1.5 },
    jobPay:      { fontSize: 18, fontWeight: 800, color: C.accent, marginTop: 10 },
    badge:       (c) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${c}22`, color: c, marginBottom: 8 }),
    upsellTag:   { display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${C.gold}22`, color: C.gold, marginRight: 4, marginTop: 4 },
    emptyWrap:   { textAlign: "center", padding: "56px 24px" },
    emptyIcon:   { fontSize: 48, marginBottom: 14 },
    emptyTitle:  { fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 },
    emptyBody:   { fontSize: 14, color: C.muted, lineHeight: 1.6, maxWidth: 280, margin: "0 auto" },
    gpsPill:     { fontSize: 12, color: C.muted, marginTop: 10, display: "flex", alignItems: "center", gap: 6 },
    comingSoon:  { display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${C.purple}22`, color: C.purple },
  };

  const fmtDate = (d) => {
    if (!d) return "";
    try { return new Date(d + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }); }
    catch { return d; }
  };

  const getPartners = (job) =>
    (job.partnerIds || [job.partnerId]).map(id => partners.find(p => p.id === id)).filter(Boolean);

  // ─── Job card component ──────────────────────────────────────────────────
  const JobRow = ({ job, showDate = false }) => {
    const jp = getPartners(job);
    const statusColor = job.status === "in-progress" ? C.gold : job.status === "completed" ? C.accent : C.blue;
    return (
      <div style={st.jobCard(job.status)}>
        <span style={st.badge(statusColor)}>{job.status}</span>
        <div style={st.jobClient}>{job.client}</div>
        {job.address && <div style={st.jobMeta}>📍 {job.address}</div>}
        <div style={st.jobMeta}>
          🕐 {job.time || "Time TBD"} · {job.hours || "?"}h
          {showDate && job.date && ` · 📅 ${fmtDate(job.date)}`}
        </div>
        {jp.length > 0 && <div style={st.jobMeta}>👷 {jp.map(p => p.name).join(", ")}</div>}
        {(job.upsells || []).length > 0 && (
          <div style={{ marginTop: 6 }}>
            {job.upsells.map(u => <span key={u} style={st.upsellTag}>{u}</span>)}
          </div>
        )}
        {job.notes && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>📝 {job.notes}</div>
        )}
        {job.summary && job.status === "completed" && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>✅ {job.summary}</div>
        )}
        <div style={st.jobPay}>
          {cur}{job.partnerPay || job.pay || 0}
          <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 6 }}>partner pay</span>
        </div>
        {job.status === "scheduled" && (
          <div style={st.gpsPill}>📍 GPS check-in <span style={st.comingSoon}>Coming Phase 2C</span></div>
        )}
        {job.checkIn && (
          <div style={{ marginTop: 8, fontSize: 12, color: C.accent }}>
            ✅ In: {job.checkIn}{job.checkOut ? ` · Out: ${job.checkOut}` : ""}
          </div>
        )}
      </div>
    );
  };

  // ─── Empty states ────────────────────────────────────────────────────────
  const Empty = ({ icon, title, body }) => (
    <div style={st.emptyWrap}>
      <div style={st.emptyIcon}>{icon}</div>
      <div style={st.emptyTitle}>{title}</div>
      <div style={st.emptyBody}>{body}</div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* Header */}
      <div style={st.greeting}>
        {partner ? `👋 Hey, ${partner.name.split(" ")[0]}!` : "📅 My Schedule"}
      </div>
      <div style={st.date}>
        {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </div>

      {/* Stats row */}
      <div style={st.statsRow}>
        <div style={st.statBox(C.accent)}><div style={st.statVal(C.accent)}>{todayJobs.length}</div><div style={st.statLabel}>Today</div></div>
        <div style={st.statBox(C.gold)}><div style={st.statVal(C.gold)}>{cur}{pendingPay}</div><div style={st.statLabel}>Pending Pay</div></div>
        <div style={st.statBox(C.blue)}><div style={st.statVal(C.blue)}>{upcomingJobs.length}</div><div style={st.statLabel}>Upcoming</div></div>
        <div style={st.statBox(C.purple)}><div style={st.statVal(C.purple)}>{cur}{totalEarned}</div><div style={st.statLabel}>Earned</div></div>
      </div>

      {/* Tabs */}
      <div style={st.tabs}>
        {[
          { id: "today",    label: `Today (${todayJobs.length})` },
          { id: "upcoming", label: `Upcoming (${upcomingJobs.length})` },
          { id: "done",     label: `Done (${completedJobs.length})` },
        ].map(t => (
          <button key={t.id} style={st.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Today tab */}
      {activeTab === "today" && (
        todayJobs.length === 0 ? (
          <Empty
            icon="☀️"
            title="No jobs today"
            body={upcomingJobs.length > 0
              ? `You're all clear. Next job: ${fmtDate(upcomingJobs[0]?.date)}.`
              : "You're all clear for today. Check back tomorrow!"}
          />
        ) : (
          <>
            {inProgress.length > 0 && (
              <>
                <div style={st.sectionLbl}>🔄 In Progress</div>
                {inProgress.map(j => <JobRow key={j.id} job={j} />)}
              </>
            )}
            {todayJobs.filter(j => j.status !== "in-progress").length > 0 && (
              <>
                {inProgress.length > 0 && <div style={st.sectionLbl}>📋 Scheduled Today</div>}
                {todayJobs.filter(j => j.status !== "in-progress").map(j => <JobRow key={j.id} job={j} />)}
              </>
            )}
          </>
        )
      )}

      {/* Upcoming tab */}
      {activeTab === "upcoming" && (
        upcomingJobs.length > 0
          ? upcomingJobs.map(j => <JobRow key={j.id} job={j} showDate />)
          : <Empty icon="📅" title="Nothing scheduled yet" body="New jobs will appear here once they're booked." />
      )}

      {/* Done tab */}
      {activeTab === "done" && (
        completedJobs.length > 0
          ? completedJobs.map(j => <JobRow key={j.id} job={j} showDate />)
          : <Empty icon="🏆" title="No completed jobs yet" body="Completed jobs will show up here after you mark them done." />
      )}

    </div>
  );
}
