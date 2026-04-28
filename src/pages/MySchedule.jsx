import React, { useState } from "react";
import { C } from "../lib/constants";

/**
 * MySchedule
 *
 * Mobile-first schedule page for cleaners/partners.
 * Shows today's jobs and upcoming scheduled jobs for the authenticated partner.
 * Falls back to showing all today's scheduled jobs if no partner is specified.
 *
 * This is a page shell — GPS check-in logic and Stripe are NOT moved here yet.
 * Those will be wired in Phase 2+.
 *
 * Props:
 *  jobs       — full jobs array
 *  partners   — full partners array
 *  partner    — currently authenticated partner object (or null for admin/all view)
 *  region     — active region object
 *  S          — shared style object from App.jsx
 */
export default function MySchedule({ jobs = [], partners = [], partner = null, region, S }) {
  const [activeTab, setActiveTab] = useState("today");

  const today = new Date().toISOString().split("T")[0];
  const cur = region?.currencySymbol || "$";

  // ── Filter jobs by partner assignment (or show all if no partner) ──
  const myJobs = partner
    ? jobs.filter(j => (j.partnerIds || [j.partnerId]).includes(partner.id))
    : jobs;

  const todayJobs = myJobs.filter(j => j.date === today);
  const upcomingJobs = myJobs
    .filter(j => j.status === "scheduled" && j.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const completedJobs = myJobs.filter(j => j.status === "completed");
  const inProgressJobs = myJobs.filter(j => j.status === "in-progress");
  const pendingPay = myJobs
    .filter(j => ["scheduled", "in-progress"].includes(j.status))
    .reduce((a, b) => a + (b.partnerPay || b.pay || 0), 0);
  const totalEarned = completedJobs
    .reduce((a, b) => a + (b.partnerPay || b.pay || 0), 0);

  // ── Styles ──
  const st = {
    page: {
      padding: "16px",
      maxWidth: 640,
      margin: "0 auto",
      paddingBottom: 80,
    },
    header: {
      marginBottom: 20,
    },
    greeting: {
      fontSize: 22,
      fontWeight: 800,
      color: C.text,
      letterSpacing: "-0.3px",
    },
    date: {
      fontSize: 13,
      color: C.muted,
      marginTop: 2,
    },
    statsRow: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 10,
      marginBottom: 20,
    },
    statBox: (color) => ({
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 12,
      padding: "12px 14px",
    }),
    statVal: (color) => ({
      fontSize: 22,
      fontWeight: 800,
      color,
    }),
    statLabel: {
      fontSize: 11,
      color: C.muted,
      marginTop: 2,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    },
    tabs: {
      display: "flex",
      gap: 6,
      marginBottom: 16,
      overflowX: "auto",
      scrollbarWidth: "none",
    },
    tab: (active) => ({
      padding: "8px 16px",
      borderRadius: 20,
      border: "none",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
      whiteSpace: "nowrap",
      background: active ? C.accent : C.card,
      color: active ? "#0A0F1E" : C.muted,
      flexShrink: 0,
    }),
    jobCard: (status) => ({
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${
        status === "in-progress" ? C.gold :
        status === "completed"   ? C.accent :
        C.blue
      }`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    }),
    jobClient: {
      fontSize: 16,
      fontWeight: 800,
      color: C.text,
      marginBottom: 4,
    },
    jobMeta: {
      fontSize: 13,
      color: C.muted,
      marginBottom: 2,
    },
    jobPay: {
      fontSize: 18,
      fontWeight: 800,
      color: C.accent,
      marginTop: 8,
    },
    statusBadge: (status) => ({
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: status === "in-progress" ? C.goldDim :
                  status === "completed"   ? C.accentDim :
                  C.blueDim,
      color: status === "in-progress" ? C.gold :
             status === "completed"   ? C.accent :
             C.blue,
      marginBottom: 8,
    }),
    emptyState: {
      textAlign: "center",
      padding: "48px 20px",
      color: C.muted,
    },
    emptyIcon: {
      fontSize: 40,
      marginBottom: 12,
    },
    emptyText: {
      fontSize: 15,
      fontWeight: 700,
      color: C.text,
      marginBottom: 6,
    },
    emptySubtext: {
      fontSize: 13,
    },
    // Note pill for GPS/check-in placeholder
    comingSoon: {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: C.purpleDim,
      color: C.purple,
      marginLeft: 8,
    },
  };

  // ── Friendly date formatter ──
  const fmtDate = (dateStr) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString("en-CA", {
        weekday: "short", month: "short", day: "numeric"
      });
    } catch { return dateStr; }
  };

  // ── Job card renderer ──
  const renderJobCard = (job) => {
    const jobPartners = (job.partnerIds || [job.partnerId])
      .map(id => partners.find(p => p.id === id))
      .filter(Boolean);

    return (
      <div key={job.id} style={st.jobCard(job.status)}>
        <span style={st.statusBadge(job.status)}>{job.status}</span>
        <div style={st.jobClient}>{job.client}</div>
        {job.address && <div style={st.jobMeta}>📍 {job.address}</div>}
        <div style={st.jobMeta}>🕐 {job.time || "Time TBD"} · {job.hours || "?"}h</div>
        {job.date !== today && (
          <div style={st.jobMeta}>📅 {fmtDate(job.date)}</div>
        )}
        {jobPartners.length > 0 && (
          <div style={st.jobMeta}>👷 {jobPartners.map(p => p.name).join(", ")}</div>
        )}
        {(job.upsells || []).length > 0 && (
          <div style={{ fontSize: 12, color: C.gold, marginTop: 4 }}>
            ✨ {job.upsells.join(" · ")}
          </div>
        )}
        {job.notes && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>
            📝 {job.notes}
          </div>
        )}
        <div style={st.jobPay}>
          {cur}{job.partnerPay || job.pay || 0}
          <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 6 }}>partner pay</span>
        </div>
        {/* GPS check-in placeholder — wired in Phase 2 */}
        {job.status === "scheduled" && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
            📍 GPS check-in <span style={st.comingSoon}>Coming Phase 2</span>
          </div>
        )}
        {job.checkIn && (
          <div style={{ marginTop: 8, fontSize: 12, color: C.accent }}>
            ✅ Checked in: {job.checkIn}
            {job.checkOut && <span> · Out: {job.checkOut}</span>}
          </div>
        )}
      </div>
    );
  };

  // ── Tab content ──
  const tabContent = {
    today: (
      <>
        {inProgressJobs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              🔄 In Progress
            </div>
            {inProgressJobs.map(renderJobCard)}
          </div>
        )}
        {todayJobs.filter(j => j.status !== "in-progress").length > 0 ? (
          todayJobs.filter(j => j.status !== "in-progress").map(renderJobCard)
        ) : inProgressJobs.length === 0 ? (
          <div style={st.emptyState}>
            <div style={st.emptyIcon}>☀️</div>
            <div style={st.emptyText}>No jobs today</div>
            <div style={st.emptySubtext}>Check upcoming for your next scheduled clean.</div>
          </div>
        ) : null}
      </>
    ),
    upcoming: (
      upcomingJobs.length > 0 ? upcomingJobs.map(renderJobCard) : (
        <div style={st.emptyState}>
          <div style={st.emptyIcon}>📅</div>
          <div style={st.emptyText}>No upcoming jobs</div>
          <div style={st.emptySubtext}>New jobs will appear here once scheduled.</div>
        </div>
      )
    ),
    completed: (
      completedJobs.length > 0 ? completedJobs.slice().reverse().map(renderJobCard) : (
        <div style={st.emptyState}>
          <div style={st.emptyIcon}>🏆</div>
          <div style={st.emptyText}>No completed jobs yet</div>
          <div style={st.emptySubtext}>Completed jobs will show here.</div>
        </div>
      )
    ),
  };

  return (
    <div style={st.page}>

      {/* ── Header ── */}
      <div style={st.header}>
        <div style={st.greeting}>
          {partner
            ? `👋 Hey, ${partner.name.split(" ")[0]}!`
            : "📋 My Schedule"}
        </div>
        <div style={st.date}>
          {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={st.statsRow}>
        <div style={st.statBox(C.accent)}>
          <div style={st.statVal(C.accent)}>{todayJobs.length}</div>
          <div style={st.statLabel}>Jobs Today</div>
        </div>
        <div style={st.statBox(C.gold)}>
          <div style={st.statVal(C.gold)}>{cur}{pendingPay}</div>
          <div style={st.statLabel}>Pending Pay</div>
        </div>
        <div style={st.statBox(C.blue)}>
          <div style={st.statVal(C.blue)}>{upcomingJobs.length}</div>
          <div style={st.statLabel}>Upcoming</div>
        </div>
        <div style={st.statBox(C.purple)}>
          <div style={st.statVal(C.purple)}>{cur}{totalEarned}</div>
          <div style={st.statLabel}>Total Earned</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={st.tabs}>
        {[
          { id: "today",     label: `Today (${todayJobs.length + inProgressJobs.filter(j => j.date === today).length})` },
          { id: "upcoming",  label: `Upcoming (${upcomingJobs.length})` },
          { id: "completed", label: `Done (${completedJobs.length})` },
        ].map(t => (
          <button key={t.id} style={st.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tabContent[activeTab]}

    </div>
  );
}
