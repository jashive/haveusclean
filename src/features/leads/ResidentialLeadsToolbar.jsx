import React from "react";

export default function ResidentialLeadsToolbar({
  C,
  S,
  statuses,
  statusColorMap,
  totalCount,
  statusCounts,
  filterStatus,
  onFilterStatus,
  searchQuery,
  onSearchQuery,
  onNewLead,
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={S.h2}>🏠 Residential Leads</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: -14 }}>Have Us Clean — Toronto & GTA</div>
        </div>
        <button style={S.btn("primary")} onClick={onNewLead}>+ New Lead</button>
      </div>

      <input
        style={{ ...S.input, marginBottom: 12 }}
        placeholder="🔍 Search by name, email, address or phone..."
        value={searchQuery}
        onChange={(event) => onSearchQuery(event.target.value)}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 18, paddingBottom: 2 }}>
        {["All", ...statuses].map((status) => {
          const count = status === "All" ? totalCount : statusCounts[status] || 0;
          const color = status === "All" ? C.muted : statusColorMap[status];
          const active = filterStatus === status;

          return (
            <button
              key={status}
              onClick={() => onFilterStatus(status)}
              style={{
                padding: "5px 14px",
                borderRadius: 20,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                minHeight: 36,
                whiteSpace: "nowrap",
                background: active ? `${color}22` : C.surface,
                color: active ? color : C.muted,
                border: `1px solid ${active ? color : C.border}`,
              }}
            >
              {status}
              {count > 0 && (
                <span style={{ marginLeft: 4, background: `${color}33`, borderRadius: 20, padding: "1px 7px", fontSize: 11 }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}