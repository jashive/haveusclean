// ── Wave 6: Module Readiness Panel ───────────────────────────────────────────
//
// Read-only display of service module profiles and release gate progression.
// Gate prerequisites are evaluated with the same pure rule the migration
// documents (canPassReleaseGate) — no gate is ever shown as ready when its
// predecessor has not passed.

import React from "react";

import { releaseGateBlockers } from "../../lib/serviceosIntelligenceUtils.js";
import { formatStatusLabel, formatTimestamp } from "./wave6Formatters.js";

const styles = {
  section: { marginBottom: "0.8rem" },
  label: {
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#7dd3fc",
    marginBottom: 6,
  },
  row: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 6,
    padding: "0.45rem 0.6rem",
    marginBottom: 6,
  },
  rowTitle: { fontSize: "0.76rem", fontWeight: 600, color: "#e8f4ff" },
  rowMeta: { fontSize: "0.65rem", color: "#94a3b8", marginTop: 2, lineHeight: 1.4 },
  note: { color: "#94a3b8", fontSize: "0.68rem", lineHeight: 1.4 },
};

export default function ModuleReadinessPanel({ profiles = [], gates = [] }) {
  return (
    <div>
      <div style={styles.section}>
        <div style={styles.label}>Service module profiles ({profiles.length})</div>
        {profiles.length === 0 && (
          <div style={styles.note}>
            No module profiles are readable for this session. Profiles are seeded by migration
            014 and read under the caller&apos;s RLS policies.
          </div>
        )}
        {profiles.map((profile) => (
          <div key={profile.id ?? profile.profile_code} style={styles.row}>
            <div style={styles.rowTitle}>
              {profile.profile_name} ({profile.profile_code})
            </div>
            <div style={styles.rowMeta}>
              {profile.jurisdiction} · {profile.currency} · {profile.timezone} · v
              {profile.profile_version} · {profile.active ? "Active" : "Inactive"}
            </div>
          </div>
        ))}
      </div>

      <div style={styles.section}>
        <div style={styles.label}>Release gates ({gates.length})</div>
        {gates.length === 0 && (
          <div style={styles.note}>No release gates are readable for this session.</div>
        )}
        {gates.map((gate) => {
          const blockers = releaseGateBlockers(gate.gate_code, gates);
          return (
            <div key={gate.id ?? gate.gate_code} style={styles.row}>
              <div style={styles.rowTitle}>
                {gate.sequence_order}. {gate.gate_name} ({gate.gate_code})
              </div>
              <div style={styles.rowMeta}>
                Status: {formatStatusLabel(gate.gate_status)}
                {gate.passed_at ? ` · passed ${formatTimestamp(gate.passed_at)}` : ""}
                {gate.release_sha ? ` · release ${gate.release_sha}` : ""}
                <br />
                {gate.gate_status === "passed"
                  ? "Prerequisites satisfied."
                  : blockers.length > 0
                  ? `Blocked by: ${blockers.join(", ")}`
                  : "Prerequisites satisfied — awaiting governed sign-off."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
