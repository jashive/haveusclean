import React from "react";
import { C } from "../../lib/constants";
import { getJobPartners } from "./jobUtils";

/**
 * JobCard
 *
 * Renders a single job card.
 * All state handlers are passed as props — no local state.
 *
 * Props:
 *  job            — job object
 *  partners       — full partners array (for name lookup)
 *  styles         — shared style object from App.jsx (Jobs uses `styles` alias of S)
 *  onViewPhotos   — (job) => void — open photo/details modal
 *  onUpdateStatus — (id, status) => void — update job status
 *  onUpdateSummary — (id, summary) => void — save end-of-job summary
 */
export default function JobCard({
  job,
  partners,
  styles,
  onViewPhotos,
  onUpdateStatus,
  onUpdateSummary,
}) {
  if (!job) return null;

  const jobPartners = getJobPartners(job, partners);

  return (
    <div key={job.id} style={styles.card}>

      {/* ── Top row: job info left, status + pay right ── */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
      }}>
        {/* Left: client, address, date, partners */}
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{job.client}</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>📍 {job.address}</div>
          <div style={{ color: C.muted, fontSize: 13 }}>📅 {job.date} at {job.time}</div>
          {jobPartners.length > 0 && (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              👷 {jobPartners.map(p => p.name).join(", ")}
            </div>
          )}
        </div>

        {/* Right: status badge, pay, hours */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={styles.badge(
            job.status === "completed" ? "green" :
            job.status === "in-progress" ? "gold" : "blue"
          )}>
            {job.status}
          </div>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.accent }}>
            ${job.pay || job.partnerPay || 0}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {job.hours}h · {(job.upsells || []).length} upsells
          </div>
        </div>
      </div>

      {/* ── Upsells ── */}
      {(job.upsells || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={styles.label}>Upsells</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(job.upsells || []).map(u => (
              <span key={u} style={styles.badge("gold")}>{u}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── End-of-job summary ── */}
      {job.status === "completed" && job.summary && (
        <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: 12 }}>
          <div style={styles.label}>End-of-Job Summary</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{job.summary}</div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {job.status === "scheduled" && (
          <button
            style={styles.btn("sm")}
            onClick={() => onUpdateStatus(job.id, "in-progress")}
          >
            ▶ Start Job
          </button>
        )}
        {job.status === "in-progress" && (
          <button
            style={{ ...styles.btn("sm"), background: C.gold, color: "#0A0F1E" }}
            onClick={() => {
              // NOTE: window.prompt kept intentionally — modal replacement is Phase 2+
              const summary = window.prompt("Enter end-of-job summary:");
              if (summary) {
                onUpdateSummary(job.id, summary);
                onUpdateStatus(job.id, "completed");
              }
            }}
          >
            ✅ Complete Job
          </button>
        )}
        <button
          style={styles.btn("ghost")}
          onClick={() => onViewPhotos(job)}
        >
          📸 Photos / Details
        </button>
      </div>

    </div>
  );
}
