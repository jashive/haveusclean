import React from "react";
import { C } from "../../lib/constants";
import JobCard from "./JobCard";
import { filterJobs, filterLabel, JOB_FILTERS } from "./jobUtils";

/**
 * JobList
 *
 * Renders a filterable list of job cards with a status filter tab bar.
 * No local state — filter state and all handlers come from Jobs via props.
 *
 * Props:
 *  jobs            — full jobs array
 *  partners        — full partners array
 *  filter          — current filter string ("all", "scheduled", etc.)
 *  styles          — shared style object from App.jsx
 *  onFilterChange  — (filter) => void
 *  onViewPhotos    — (job) => void
 *  onUpdateStatus  — (id, status) => void
 *  onUpdateSummary — (id, summary) => void
 */
export default function JobList({
  jobs,
  partners,
  filter,
  styles,
  onFilterChange,
  onViewPhotos,
  onUpdateStatus,
  onUpdateSummary,
}) {
  const filtered = filterJobs(jobs, filter);

  return (
    <div>
      {/* ── Filter tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {JOB_FILTERS.map(f => (
          <button
            key={f}
            style={styles.navBtn(filter === f)}
            onClick={() => onFilterChange(f)}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>

      {/* ── Job cards ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            No jobs found
          </div>
          <div style={{ fontSize: 13 }}>
            {filter !== "all"
              ? `No ${filter} jobs right now.`
              : "Book your first job from the Residential Leads tab."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              partners={partners}
              styles={styles}
              onViewPhotos={onViewPhotos}
              onUpdateStatus={onUpdateStatus}
              onUpdateSummary={onUpdateSummary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
