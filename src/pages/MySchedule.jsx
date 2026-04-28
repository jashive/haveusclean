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
 * Mobile-first schedule page wired to smartViews.
 * Today tab shows GPS action buttons for field workers.
 * Real GPS check-in/check-out logic stays in App.jsx until Phase 2D.
 *
 * Props:
 *  jobs       — full jobs array
 *  partners   — full partners array
 *  partner    — authenticated partner object (or null for admin view)
 *  region     — active region object
 *  S          — shared style object (kept for API consistency)
 *  onCheckIn  — (jobId) => void — called when Check In tapped (wired Phase 2D)
 *  onCheckOut — (jobId) => void — called when Check Out tapped (wired Phase 2D)
 */
export default function MySchedule({
  jobs = [],
  partners = [],
  partner = null,
  region,
  onCheckIn  = () => {},
  onCheckOut = () => {},
  onPhotoUpload = () => {},
  onToggleChecklist = () => {},
}) {
  const [activeTab, setActiveTab] = useState("today");
  const [checkedIn, setCheckedIn] = useState({});
  const [photoPreview, setPhotoPreview] = useState(null); // local optimistic state until real GPS wired

  const cur = region?.currencySymbol || "$";

  // ── Scope to partner if authenticated ──
  const myJobs = partner
    ? jobs.filter(j => (j.partnerIds || [j.partnerId]).includes(partner.id))
    : jobs;

  // ── Smart views ──
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

  // ─── Styles ────────────────────────────────────────────────────────────
  const st = {
    page:       { padding: "16px", maxWidth: 640, margin: "0 auto", paddingBottom: 88 },
    greeting:   { fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.3px" },
    date:       { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 20 },
    statsRow:   { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 },
    statBox:    (c) => ({ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${c}`, borderRadius: 12, padding: "12px 14px" }),
    statVal:    (c) => ({ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1 }),
    statLabel:  { fontSize: 11, color: C.muted, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
    tabs:       { display: "flex", gap: 6, marginBottom: 20, overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" },
    tab:        (a) => ({ padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", background: a ? C.accent : C.card, color: a ? "#0A0F1E" : C.muted, flexShrink: 0, minHeight: 36 }),
    sectionLbl: { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, marginTop: 4 },
    jobCard:    (s) => ({ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${s === "in-progress" ? C.gold : s === "completed" ? C.accent : C.blue}`, borderRadius: 12, padding: 16, marginBottom: 14 }),
    jobClient:  { fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 },
    jobMeta:    { fontSize: 13, color: C.muted, marginBottom: 2, lineHeight: 1.5 },
    jobPay:     { fontSize: 18, fontWeight: 800, color: C.accent, marginTop: 10, marginBottom: 14 },
    badge:      (c) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${c}22`, color: c, marginBottom: 8 }),
    upsellTag:  { display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${C.gold}22`, color: C.gold, marginRight: 4, marginTop: 4 },
    // GPS action buttons — large for field use
    actionRow:  { display: "flex", gap: 8, marginTop: 2 },
    btnCheckIn: { flex: 1, minHeight: 48, borderRadius: 10, border: "none", background: C.accent, color: "#0A0F1E", fontSize: 14, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, WebkitTapHighlightColor: "transparent" },
    btnCheckOut:{ flex: 1, minHeight: 48, borderRadius: 10, border: "none", background: C.gold, color: "#0A0F1E", fontSize: 14, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, WebkitTapHighlightColor: "transparent" },
    btnMap:     { minHeight: 48, minWidth: 56, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" },
    btnDisabled:{ flex: 1, minHeight: 48, borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 700, cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
    checkedInBar:{ marginTop: 8, fontSize: 12, color: C.accent, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: `${C.accent}11`, borderRadius: 8, border: `1px solid ${C.accent}33` },
    completedBar:{ marginTop: 8, fontSize: 13, color: C.accent, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 },
    emptyWrap:  { textAlign: "center", padding: "56px 24px" },
    emptyIcon:  { fontSize: 48, marginBottom: 14 },
    emptyTitle: { fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 },
    emptyBody:  { fontSize: 14, color: C.muted, lineHeight: 1.6, maxWidth: 280, margin: "0 auto" },
  };

  // ─── Helpers ──────────────────────────────────────────────────────────
  const fmtDate = (d) => {
    if (!d) return "";
    try { return new Date(d + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }); }
    catch { return d; }
  };

  const handleCheckInClick = (job) => {
    if (typeof onCheckIn === "function") {
      onCheckIn(job);
      return;
    }

    alert(
      "Check In for " +
        (job?.client || "this job") +
        "\n\nGPS database wiring comes in the next phase."
    );
  };

  const handleCheckOutClick = (job) => {
    if (typeof onCheckOut === "function") {
      onCheckOut(job);
      return;
    }

    alert(
      "Check Out for " +
        (job?.client || "this job") +
        "\n\nGPS database wiring comes in the next phase."
    );
  };



  const photoInputId = (job, type) => `photo-${type}-${job.id}`;

  const openPhotoPicker = (type, job) => {
    const input = document.getElementById(photoInputId(job, type));
    if (input) input.click();
  };



  const getChecklistItems = (job) => {
    const base = [
      "Arrive and confirm access",
      "Walkthrough before starting",
      "Kitchen cleaned",
      "Bathrooms cleaned",
      "Dusting completed",
      "Floors vacuumed / swept",
      "Floors mopped",
      "Final walkthrough",
    ];

    const deep = [
      "Baseboards/detail areas checked",
      "Buildup/detail spots addressed",
      "High-touch surfaces sanitized",
    ];

    const move = [
      "Inside cabinets/drawers checked",
      "Closets checked",
      "Empty-unit final scan completed",
    ];

    const type = job?.type || "";
    if (type.includes("Deep")) return [...base, ...deep];
    if (type.includes("Move")) return [...base, ...move];
    return base;
  };

  const getChecklistState = (job) => job.checklist || {};

  const checklistDoneCount = (job) => {
    const state = getChecklistState(job);
    return getChecklistItems(job).filter((item) => state[item]).length;
  };

  const checklistTotalCount = (job) => getChecklistItems(job).length;

  const checklistComplete = (job) =>
    checklistDoneCount(job) === checklistTotalCount(job);

  const openPhotoPreview = (job, type) => {
    const photos = type === "before" ? (job.beforePics || []) : (job.afterPics || []);

    if (!photos.length) {
      alert(
        (type === "before" ? "Before" : "After") +
          " photos for " +
          (job?.client || "this job") +
          "\n\nNo photos uploaded yet."
      );
      return;
    }

    setPhotoPreview({
      job,
      type,
      photos,
      index: 0,
    });
  };

  const closePhotoPreview = () => setPhotoPreview(null);

  const movePhotoPreview = (direction) => {
    setPhotoPreview((prev) => {
      if (!prev) return prev;
      const total = prev.photos.length;
      if (total <= 1) return prev;

      return {
        ...prev,
        index: (prev.index + direction + total) % total,
      };
    });
  };

  const getPhotoSrc = (photo) => {
    if (!photo) return "";
    if (typeof photo === "string") return photo;
    return photo.dataUrl || photo.url || photo.src || "";
  };

  const handlePhotoFiles = (type, job, files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    if (typeof onPhotoUpload === "function") {
      onPhotoUpload(job, type, fileList);
    }
  };

  const getPartners = (job) =>
    (job.partnerIds || [job.partnerId]).map(id => partners.find(p => p.id === id)).filter(Boolean);

  const mapsUrl = (address) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;

  const handleCheckIn = (job) => {
    setCheckedIn(prev => ({ ...prev, [job.id]: { time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } }));
    onCheckIn(job.id);
  };

  const handleCheckOut = (job) => {
    const done = checklistDoneCount(job);
    const total = checklistTotalCount(job);

    if (done < total) {
      alert(
        "Please finish the checklist before checking out.\n\n" +
          (total - done) +
          " task" +
          (total - done === 1 ? "" : "s") +
          " remaining."
      );
      return;
    }

    setCheckedIn(prev => ({ ...prev, [job.id]: { ...prev[job.id], checkOutTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } }));
    onCheckOut(job);
  };

  // ─── GPS action buttons ──────────────────────────────────────────────
  const GpsActions = ({ job }) => {
    const local = checkedIn[job.id];
    const alreadyIn  = !!(local?.time   || job.checkIn);
    const alreadyOut = !!(local?.checkOutTime || job.checkOut);

    if (job.status === "completed") {
      return (
        <div style={st.completedBar}>
          🎉 Job completed
          {(job.checkIn || job.checkOut) && (
            <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>
              · In: {job.checkIn || "—"}{job.checkOut ? ` · Out: ${job.checkOut}` : ""}
            </span>
          )}
        </div>
      );
    }

    return (
      <div>
        <div style={st.actionRow}>
          {!alreadyIn ? (
            <button style={st.btnCheckIn} onClick={() => handleCheckIn(job)}>
              📍 Check In
            </button>
          ) : !alreadyOut ? (
            {checklistComplete(job) ? (
              <button style={st.btnCheckOut} onClick={() => handleCheckOut(job)}>
                ✅ Check Out
              </button>
            ) : (
              <button
                style={{
                  ...st.btnDisabled,
                  color: C.gold,
                  border: `1px solid ${C.gold}44`,
                  background: `${C.gold}11`,
                }}
                onClick={() => handleCheckOut(job)}
              >
                🔒 Checklist Required
              </button>
            )}
          ) : (
            <div style={st.btnDisabled}>✅ Checked Out</div>
          )}
          {job.address && (
            <a
              href={mapsUrl(job.address)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...st.btnMap, textDecoration: "none" }}
              title="Open in Google Maps"
            >
              🗺️
            </a>
          )}
        </div>

        {/* Optimistic check-in confirmation */}
        {alreadyIn && !alreadyOut && (
          <div style={st.checkedInBar}>
            ✅ Checked in at {local?.time || job.checkIn}
            <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>GPS wired Phase 2D</span>
          </div>
        )}
        {alreadyIn && alreadyOut && (
          <div style={st.checkedInBar}>
            ✅ In: {local?.time || job.checkIn} · Out: {local?.checkOutTime || job.checkOut}
          </div>
        )}
      </div>
    );
  };


  const ChecklistBox = ({ job }) => {
    const items = getChecklistItems(job);
    const state = getChecklistState(job);
    const done = checklistDoneCount(job);
    const total = checklistTotalCount(job);

    return (
      <div
        style={{
          marginTop: 12,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
            ✅ Cleaning Checklist
          </div>
          <div style={{ fontSize: 12, color: done === total ? C.accent : C.muted, fontWeight: 800 }}>
            {done}/{total}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => {
            const checked = !!state[item];
            return (
              <button
                key={item}
                type="button"
                onClick={() => onToggleChecklist(job, item)}
                style={{
                  minHeight: 44,
                  borderRadius: 10,
                  border: `1px solid ${checked ? C.accent + "66" : C.border}`,
                  background: checked ? C.accentDim : C.card,
                  color: checked ? C.accent : C.text,
                  fontSize: 13,
                  fontWeight: 700,
                  textAlign: "left",
                  padding: "10px 12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{checked ? "✅" : "⬜"}</span>
                <span>{item}</span>
              </button>
            );
          })}
        {done < total && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.gold, lineHeight: 1.5 }}>
            🔒 Checkout unlocks when all tasks are done.
          </div>
        )}
        </div>
      </div>
    );
  };

  // ─── Job card ────────────────────────────────────────────────────────
  const JobRow = ({ job, showDate = false, showGps = false }) => {
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
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>
            📝 {job.notes}
          </div>
        )}
        {job.summary && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>
            ✅ {job.summary}
          </div>
        )}
        <div style={st.jobPay}>
          {cur}{job.partnerPay || job.pay || 0}
          <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 6 }}>partner pay</span>
        </div>
        <input
          id={photoInputId(job, "before")}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { handlePhotoFiles("before", job, e.target.files); e.target.value = ""; }}
        />
        <input
          id={photoInputId(job, "after")}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { handlePhotoFiles("after", job, e.target.files); e.target.value = ""; }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            style={{
              minHeight: 46,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
              padding: "10px 12px",
            }}
            onClick={() => openPhotoPicker("before", job)}
          >
            📷 Before Photos ({(job.beforePics || []).length})
          </button>

          <button
            type="button"
            style={{
              minHeight: 46,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
              padding: "10px 12px",
            }}
            onClick={() => openPhotoPicker("after", job)}
          >
            🖼️ After Photos ({(job.afterPics || []).length})
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            style={{
              minHeight: 42,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.muted,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              padding: "9px 10px",
            }}
            onClick={() => openPhotoPreview(job, "before")}
          >
            👀 View Before
          </button>

          <button
            type="button"
            style={{
              minHeight: 42,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.muted,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              padding: "9px 10px",
            }}
            onClick={() => openPhotoPreview(job, "after")}
          >
            👀 View After
          </button>
        </div>

        {showGps && <ChecklistBox job={job} />}
        {showGps && <GpsActions job={job} />}
      </div>
    );
  };

  // ─── Empty state ─────────────────────────────────────────────────────
  const Empty = ({ icon, title, body }) => (
    <div style={st.emptyWrap}>
      <div style={st.emptyIcon}>{icon}</div>
      <div style={st.emptyTitle}>{title}</div>
      <div style={st.emptyBody}>{body}</div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* Header */}
      <div style={st.greeting}>
        {partner ? `👋 Hey, ${partner.name.split(" ")[0]}!` : "📅 My Schedule"}
      </div>
      <div style={st.date}>
        {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </div>

      {/* Stats */}
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

      {/* Today — GPS buttons shown */}
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
                {inProgress.map(j => <JobRow key={j.id} job={j} showGps />)}
              </>
            )}
            {todayJobs.filter(j => j.status !== "in-progress").length > 0 && (
              <>
                {inProgress.length > 0 && <div style={st.sectionLbl}>📋 Scheduled Today</div>}
                {todayJobs.filter(j => j.status !== "in-progress").map(j => (
                  <JobRow key={j.id} job={j} showGps />
                ))}
              </>
            )}
          </>
        )
      )}

      {/* Upcoming — no GPS buttons needed */}
      {activeTab === "upcoming" && (
        upcomingJobs.length > 0
          ? upcomingJobs.map(j => <JobRow key={j.id} job={j} showDate />)
          : <Empty icon="📅" title="Nothing scheduled yet" body="New jobs will appear here once they're booked." />
      )}

      {/* Done — no GPS buttons, just summary */}
      {activeTab === "done" && (
        completedJobs.length > 0
          ? completedJobs.map(j => <JobRow key={j.id} job={j} showDate />)
          : <Empty icon="🏆" title="No completed jobs yet" body="Completed jobs will show up here after you mark them done." />
      )}


      {photoPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={closePhotoPreview}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "92vh",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${C.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                  {photoPreview.type === "before" ? "📷 Before Photos" : "🖼️ After Photos"}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {photoPreview.job?.client} · {photoPreview.index + 1} of {photoPreview.photos.length}
                </div>
              </div>

              <button
                type="button"
                onClick={closePhotoPreview}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontSize: 22,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 260,
                background: C.bg,
              }}
            >
              {getPhotoSrc(photoPreview.photos[photoPreview.index]) ? (
                <img
                  src={getPhotoSrc(photoPreview.photos[photoPreview.index])}
                  alt="Job upload preview"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "68vh",
                    objectFit: "contain",
                    borderRadius: 12,
                  }}
                />
              ) : (
                <div style={{ color: C.muted, padding: 40, textAlign: "center" }}>
                  Preview unavailable for this photo.
                </div>
              )}
            </div>

            <div
              style={{
                padding: 12,
                borderTop: `1px solid ${C.border}`,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => movePhotoPreview(-1)}
                disabled={photoPreview.photos.length <= 1}
                style={{
                  minHeight: 44,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: photoPreview.photos.length <= 1 ? C.dim : C.text,
                  fontWeight: 800,
                  cursor: photoPreview.photos.length <= 1 ? "default" : "pointer",
                }}
              >
                ← Previous
              </button>

              <button
                type="button"
                onClick={() => movePhotoPreview(1)}
                disabled={photoPreview.photos.length <= 1}
                style={{
                  minHeight: 44,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: photoPreview.photos.length <= 1 ? C.dim : C.text,
                  fontWeight: 800,
                  cursor: photoPreview.photos.length <= 1 ? "default" : "pointer",
                }}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
