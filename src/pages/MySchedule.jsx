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
  mode = "schedule",
}) {
  const [activeTab, setActiveTab] = useState("today");
  const [checkedIn, setCheckedIn] = useState({});
  const [photoPreview, setPhotoPreview] = useState(null);
  const [proofReport, setProofReport] = useState(null); // local optimistic state until real GPS wired

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




  const getCompletionProof = (job) => {
    const beforeCount = (job.beforePics || []).length;
    const afterCount = (job.afterPics || []).length;
    const done = checklistDoneCount(job);
    const total = checklistTotalCount(job);

    const checks = [
      {
        id: "checkin",
        label: "Checked in",
        done: !!job.checkIn || !!checkedIn[job.id]?.time,
      },
      {
        id: "checklist",
        label: `Checklist complete (${done}/${total})`,
        done: checklistComplete(job),
      },
      {
        id: "before",
        label: `Before photo uploaded (${beforeCount})`,
        done: beforeCount > 0,
      },
      {
        id: "after",
        label: `After photo uploaded (${afterCount})`,
        done: afterCount > 0,
      },
    ];

    return {
      checks,
      complete: checks.every((item) => item.done),
      remaining: checks.filter((item) => !item.done),
    };
  };

  const canCompleteJob = (job) => getCompletionProof(job).complete;

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
    const proof = getCompletionProof(job);

    if (!proof.complete) {
      alert(
        "Complete proof-of-work before checkout.\n\nRemaining:\n- " +
          proof.remaining.map((item) => item.label).join("\n- ")
      );
      return;
    }

    setCheckedIn(prev => ({ ...prev, [job.id]: { ...prev[job.id], checkOutTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } }));
    onCheckOut(job);
  };


  const escapeReportHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const renderReportPhotos = (photos = []) => {
    if (!photos.length) {
      return '<div class="empty">No photos uploaded</div>';
    }

    return photos
      .map((photo, index) => {
        const src = getPhotoSrc(photo);
        if (!src) return '<div class="empty">Photo preview unavailable</div>';

        return `
          <div class="photo">
            <img src="${src}" alt="Job photo ${index + 1}" />
            <div class="caption">Photo ${index + 1}</div>
          </div>
        `;
      })
      .join("");
  };

  const exportClientProofReport = (job) => {
    const beforePhotos = job.beforePics || [];
    const afterPhotos = job.afterPics || [];
    const checklistItems = getChecklistItems(job);
    const proof = getCompletionProof(job);

    const checklistHtml = checklistItems
      .map((item) => {
        const checked = !!(job.checklist || {})[item];
        return `
          <div class="check ${checked ? "done" : ""}">
            <span>${checked ? "✓" : "□"}</span>
            <span>${escapeReportHtml(item)}</span>
          </div>
        `;
      })
      .join("");

    const proofHtml = proof.checks
      .map((item) => `
        <div class="check ${item.done ? "done" : ""}">
          <span>${item.done ? "✓" : "!"}</span>
          <span>${escapeReportHtml(item.label)}</span>
        </div>
      `)
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Have Us Clean Proof Report - ${escapeReportHtml(job.client)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:0;background:#f5f7fb;color:#111827;padding:28px}
  .wrap{max-width:900px;margin:0 auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.10)}
  .head{background:#0A0F1E;color:white;padding:28px}
  .brand{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#00D4AA;font-weight:800;margin-bottom:8px}
  h1{font-size:28px;margin:0 0 8px}
  .sub{color:#CBD5E1;font-size:14px;line-height:1.5}
  .body{padding:24px}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:20px}
  .card{border:1px solid #E5E7EB;border-radius:14px;padding:16px;background:#FAFAFA}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#64748B;font-weight:800;margin-bottom:4px}
  .value{font-size:15px;font-weight:800;color:#111827}
  .section{margin-top:24px}
  .section h2{font-size:18px;margin:0 0 12px;color:#0F172A}
  .check{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:8px;color:#64748B}
  .check.done{color:#047857;background:#ECFDF5;border-color:#A7F3D0}
  .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .photo{border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;background:#FAFAFA}
  .photo img{display:block;width:100%;height:180px;object-fit:cover}
  .caption{font-size:12px;color:#64748B;padding:8px 10px}
  .empty{border:1px dashed #CBD5E1;border-radius:14px;padding:20px;color:#64748B;text-align:center;background:#F8FAFC}
  .foot{padding:18px 24px;background:#F8FAFC;color:#64748B;font-size:12px;border-top:1px solid #E5E7EB}
  .print{position:fixed;right:18px;bottom:18px;border:none;border-radius:999px;background:#00D4AA;color:#0A0F1E;font-weight:900;padding:14px 18px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.18)}
  @media print{body{background:white;padding:0}.wrap{box-shadow:none;border-radius:0}.print{display:none}.photo img{height:auto;max-height:260px}}
  @media(max-width:680px){body{padding:12px}.grid{grid-template-columns:1fr}.head{padding:22px}.body{padding:18px}}
</style>
</head>
<body>
<button class="print" onclick="window.print()">Print / Save PDF</button>
<div class="wrap">
  <div class="head">
    <div class="brand">Have Us Clean</div>
    <h1>Job Completion Proof</h1>
    <div class="sub">${escapeReportHtml(job.client)}<br />${escapeReportHtml(job.address || "")}</div>
  </div>
  <div class="body">
    <div class="grid">
      <div class="card"><div class="label">Service</div><div class="value">${escapeReportHtml(job.type || "Cleaning Service")}</div></div>
      <div class="card"><div class="label">Date / Time</div><div class="value">${escapeReportHtml(job.date || "—")} · ${escapeReportHtml(job.time || "—")}</div></div>
      <div class="card"><div class="label">Check In</div><div class="value">${escapeReportHtml(job.checkIn || "—")}</div></div>
      <div class="card"><div class="label">Check Out</div><div class="value">${escapeReportHtml(job.checkOut || "—")}</div></div>
      <div class="card"><div class="label">Before Photos</div><div class="value">${beforePhotos.length}</div></div>
      <div class="card"><div class="label">After Photos</div><div class="value">${afterPhotos.length}</div></div>
    </div>

    <div class="section">
      <h2>Proof Requirements</h2>
      ${proofHtml}
    </div>

    <div class="section">
      <h2>Cleaning Checklist</h2>
      ${checklistHtml}
    </div>

    <div class="section">
      <h2>Before Photos</h2>
      <div class="photos">${renderReportPhotos(beforePhotos)}</div>
    </div>

    <div class="section">
      <h2>After Photos</h2>
      <div class="photos">${renderReportPhotos(afterPhotos)}</div>
    </div>
  </div>
  <div class="foot">
    Generated by Have Us Clean operating system on ${new Date().toLocaleString()}.
  </div>
</div>
</body>
</html>`;

    const reportWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!reportWindow) {
      alert("Pop-up blocked. Please allow pop-ups to export the proof report.");
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
  };

  const CompletionProofReport = ({ job }) => {
    const beforeCount = (job.beforePics || []).length;
    const afterCount = (job.afterPics || []).length;
    const done = checklistDoneCount(job);
    const total = checklistTotalCount(job);
    const proof = getCompletionProof(job);

    if (mode === "archive") {
    return <ProofArchive />;
  }

  return (
      <div
        style={{
          marginTop: 12,
          background: C.surface,
          border: `1px solid ${C.accent}44`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: C.accent, marginBottom: 10 }}>
          📋 Completion Proof Report
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.text }}>Check In</strong><br />
            {job.checkIn || "—"}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.text }}>Check Out</strong><br />
            {job.checkOut || "—"}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.text }}>Checklist</strong><br />
            {done}/{total} complete
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.text }}>Photos</strong><br />
            {beforeCount} before · {afterCount} after
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {proof.checks.map((item) => (
            <div
              key={item.id}
              style={{
                fontSize: 12,
                color: item.done ? C.accent : C.gold,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{item.done ? "✅" : "⚠️"}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setProofReport(job)}
          style={{
            marginTop: 12,
            minHeight: 44,
            width: "100%",
            borderRadius: 10,
            border: "none",
            background: C.accent,
            color: "#0A0F1E",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          👀 View Full Proof
        </button>

        <button
          type="button"
          onClick={() => exportClientProofReport(job)}
          style={{
            marginTop: 8,
            minHeight: 44,
            width: "100%",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.text,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          📤 Export Client Proof
        </button>
      </div>
    );
  };

  // ─── GPS action buttons ──────────────────────────────────────────────
  const GpsActions = ({ job }) => {
    const local = checkedIn[job.id];
    const alreadyIn = !!(local?.time || job.checkIn);
    const alreadyOut = !!(local?.checkOutTime || job.checkOut);
    const proof = getCompletionProof(job);
    const isReadyToComplete = canCompleteJob(job);

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
        <CompletionProofPanel job={job} />

        <div style={st.actionRow}>
          {!alreadyIn ? (
            <button style={st.btnCheckIn} onClick={() => handleCheckIn(job)}>
              📍 Check In
            </button>
          ) : !alreadyOut ? (
            isReadyToComplete ? (
              <button style={st.btnCheckOut} onClick={() => handleCheckOut(job)}>
                ✅ Check Out
              </button>
            ) : (
              <button
                type="button"
                style={{
                  ...st.btnDisabled,
                  color: C.gold,
                  border: `1px solid ${C.gold}44`,
                  background: `${C.gold}11`,
                }}
                onClick={() => handleCheckOut(job)}
              >
                🔒 Complete Proof First
              </button>
            )
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

        {alreadyIn && !alreadyOut && !isReadyToComplete && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: C.gold,
              lineHeight: 1.5,
              padding: "6px 10px",
              background: `${C.gold}11`,
              borderRadius: 8,
              border: `1px solid ${C.gold}33`,
            }}
          >
            🔒 Checkout unlocks after: {proof.remaining.map((item) => item.label).join(", ")}.
          </div>
        )}

        {alreadyIn && !alreadyOut && (
          <div style={st.checkedInBar}>
            ✅ Checked in at {local?.time || job.checkIn}
            <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>GPS captured</span>
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

        {job.status === "completed" && <CompletionProofReport job={job} />}
                {showGps && <ChecklistBox job={job} />}
        {showGps && <GpsActions job={job} />}
      </div>
    );
  };

  const ProofArchive = () => {
    const [query, setQuery] = useState("");

    const completed = myJobs
      .filter((job) => job.status === "completed")
      .filter((job) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;

        return [
          job.client,
          job.address,
          job.type,
          job.date,
          job.summary,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });

    const completeProofCount = completed.filter((job) => getCompletionProof(job).complete).length;
    const beforeTotal = completed.reduce((sum, job) => sum + (job.beforePics || []).length, 0);
    const afterTotal = completed.reduce((sum, job) => sum + (job.afterPics || []).length, 0);

    return (
      <div style={{ padding: "16px", maxWidth: 860, margin: "0 auto", paddingBottom: 88 }}>
        <div style={st.greeting}>📁 Proof Archive</div>
        <div style={st.date}>Completed job proof reports and export history</div>

        <div style={st.statsRow}>
          <div style={st.statBox(C.accent)}>
            <div style={st.statVal(C.accent)}>{completed.length}</div>
            <div style={st.statLabel}>Completed</div>
          </div>
          <div style={st.statBox(C.gold)}>
            <div style={st.statVal(C.gold)}>{completeProofCount}</div>
            <div style={st.statLabel}>Full Proof</div>
          </div>
          <div style={st.statBox(C.blue)}>
            <div style={st.statVal(C.blue)}>{beforeTotal}</div>
            <div style={st.statLabel}>Before Photos</div>
          </div>
          <div style={st.statBox(C.purple)}>
            <div style={st.statVal(C.purple)}>{afterTotal}</div>
            <div style={st.statLabel}>After Photos</div>
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search completed jobs..."
          style={{
            width: "100%",
            minHeight: 44,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.text,
            padding: "10px 12px",
            fontSize: 14,
            marginBottom: 14,
          }}
        />

        {completed.length === 0 ? (
          <Empty
            icon="📁"
            title="No completed proof reports yet"
            body="Completed jobs with proof will appear here."
          />
        ) : (
          completed.map((job) => {
            const proof = getCompletionProof(job);
            const beforeCount = (job.beforePics || []).length;
            const afterCount = (job.afterPics || []).length;
            const done = checklistDoneCount(job);
            const total = checklistTotalCount(job);

            return (
              <div key={job.id} style={st.jobCard(job.status)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <span style={st.badge(proof.complete ? C.accent : C.gold)}>
                      {proof.complete ? "Full Proof" : "Needs Review"}
                    </span>
                    <div style={st.jobClient}>{job.client}</div>
                    {job.address && <div style={st.jobMeta}>📍 {job.address}</div>}
                    <div style={st.jobMeta}>🕐 {job.date || "Date TBD"} · {job.time || "Time TBD"} · {job.type}</div>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <div style={{ background: C.surface, borderRadius: 10, padding: 10, fontSize: 12, color: C.muted }}>
                    <strong style={{ color: C.text }}>Check In</strong><br />{job.checkIn || "—"}
                  </div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 10, fontSize: 12, color: C.muted }}>
                    <strong style={{ color: C.text }}>Check Out</strong><br />{job.checkOut || "—"}
                  </div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 10, fontSize: 12, color: C.muted }}>
                    <strong style={{ color: C.text }}>Checklist</strong><br />{done}/{total}
                  </div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 10, fontSize: 12, color: C.muted }}>
                    <strong style={{ color: C.text }}>Photos</strong><br />{beforeCount} before · {afterCount} after
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setProofReport(job)}
                    style={{
                      minHeight: 44,
                      borderRadius: 10,
                      border: "none",
                      background: C.accent,
                      color: "#0A0F1E",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    👀 View Proof
                  </button>

                  <button
                    type="button"
                    onClick={() => exportClientProofReport(job)}
                    style={{
                      minHeight: 44,
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      background: C.surface,
                      color: C.text,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    📤 Export
                  </button>
                </div>
              </div>
            );
          })
        )}
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



      {proofReport && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setProofReport(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "92vh",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              overflow: "auto",
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.accent }}>
                  📋 Job Completion Proof
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                  {proofReport.client} · {proofReport.date || ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProofReport(null)}
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

            <div style={{ background: C.surface, borderRadius: 12, padding: 12, marginBottom: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>Job Details</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                <div><strong style={{ color: C.text }}>Service:</strong> {proofReport.type}</div>
                <div><strong style={{ color: C.text }}>Address:</strong> {proofReport.address || "—"}</div>
                <div><strong style={{ color: C.text }}>Time:</strong> {proofReport.time || "—"}</div>
                <div><strong style={{ color: C.text }}>Check In:</strong> {proofReport.checkIn || "—"}</div>
                <div><strong style={{ color: C.text }}>Check Out:</strong> {proofReport.checkOut || "—"}</div>
              </div>
            </div>

            <div style={{ background: C.surface, borderRadius: 12, padding: 12, marginBottom: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>Checklist</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {getChecklistItems(proofReport).map((item) => {
                  const checked = !!(proofReport.checklist || {})[item];
                  return (
                    <div key={item} style={{ fontSize: 12, color: checked ? C.accent : C.muted }}>
                      {checked ? "✅" : "⬜"} {item}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>Photos</div>
              <button
                type="button"
                onClick={() => exportClientProofReport(proofReport)}
                style={{
                  minHeight: 44,
                  gridColumn: "1 / -1",
                  borderRadius: 10,
                  border: "none",
                  background: C.accent,
                  color: "#0A0F1E",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                📤 Export Printable Report
              </button>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setPhotoPreview({ job: proofReport, type: "before", photos: proofReport.beforePics || [], index: 0 });
                    setProofReport(null);
                  }}
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    color: C.text,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  📷 Before ({(proofReport.beforePics || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhotoPreview({ job: proofReport, type: "after", photos: proofReport.afterPics || [], index: 0 });
                    setProofReport(null);
                  }}
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    color: C.text,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  🖼️ After ({(proofReport.afterPics || []).length})
                </button>
              </div>
            </div>
          </div>
        </div>
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
