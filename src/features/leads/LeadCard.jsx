import React from "react";
import { C, HUC_STATUS_COLOR, HUC_STATUSES } from "../../lib/constants";
import { fmt } from "../../lib/formatters";
import { RES_ADDONS } from "../../lib/pricing";
import StatusBadge from "../../components/StatusBadge";
import { getLeadKey } from "./leadUtils";

/**
 * LeadCard
 *
 * Renders a single residential lead card.
 * All state handlers are passed as props — this component has no local state.
 *
 * Props:
 *  lead               — lead object
 *  q                  — pre-computed quote object from calcResQuote
 *  region             — active region object (ON or AZ)
 *  S                  — shared style object from App.jsx
 *  confirmDeleteRes   — currently pending delete ID (or null)
 *  onView             — () => void — open view modal
 *  onEdit             — () => void — open edit modal
 *  onDelete           — (id) => void — set confirm delete
 *  onConfirmDelete    — (id) => void — execute delete
 *  onCancelDelete     — () => void — cancel confirm bar
 *  onStatusChange     — (id, key, value) => void — update a field
 *  onQuote            — (lead) => void — send quote
 *  onBook             — (lead) => void — book job
 *  onPay              — (lead) => void — confirm payment
 */
export default function LeadCard({
  lead,
  q,
  region,
  S,
  confirmDeleteRes,
  onView,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onStatusChange,
  onQuote,
  onBook,
  onPay,
}) {
  if (!lead || (!lead.id && !lead.name && !lead.email)) return null;

  const statusColor = HUC_STATUS_COLOR[lead.status] || C.muted;
  const key = getLeadKey(lead);

  return (
    <div key={key} style={{ ...S.card, borderLeft: `4px solid ${statusColor}` }}>

      {/* ── Top row: info left, status + price right ── */}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

        {/* Left: name, address, email, specs */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {lead.name || <span style={{ color: C.muted }}>Unnamed Lead</span>}
          </div>
          {lead.address && (
            <div style={{ fontSize: 13, color: C.muted }}>📍 {lead.address}</div>
          )}
          {lead.email && (
            <div style={{ fontSize: 13, color: C.muted }}>
              📧 {lead.email}{lead.phone ? ` · 📞 ${lead.phone}` : ""}
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 4, color: C.muted }}>
            {[lead.dwellingType, lead.dwellingSize, lead.serviceType, lead.frequency]
              .filter(Boolean)
              .join(" · ")}
          </div>

          {/* Addons */}
          {(lead.addons || []).length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {(lead.addons || []).map(id => {
                const ao = RES_ADDONS.find(x => x.id === id);
                return ao ? (
                  <span key={id} style={S.badge("gold")}>{ao.label}</span>
                ) : null;
              })}
            </div>
          )}

          {lead.source === "VA Quote Agent" && (
            <div style={{ fontSize: 11, color: C.purple, marginTop: 4 }}>🤖 From VA Agent</div>
          )}
        </div>

        {/* Right: status select + price */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <select
            value={lead.status || "New"}
            onChange={e => onStatusChange(lead.id || key, "status", e.target.value)}
            style={{
              ...S.select,
              width: "auto",
              fontSize: 12,
              padding: "4px 10px",
              marginBottom: 6,
              color: statusColor,
              fontWeight: 700,
              background: `${statusColor}11`,
              border: `1px solid ${statusColor}44`,
            }}
          >
            {HUC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {q.total > 0 && (
            <div style={{ fontWeight: 800, fontSize: 22, color: C.accent }}>
              {fmt(q.total, region)}
            </div>
          )}
          {q.profit > 0 && (
            <div style={{ fontSize: 11, color: C.gold }}>
              Profit: {fmt(q.profit, region)} · {q.margin}%
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {lead.notes && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted, background: C.surface, borderRadius: 8, padding: "6px 10px" }}>
          📝 {lead.notes}
        </div>
      )}

      {/* Follow-up date */}
      {lead.followUpDate && (
        <div style={{ fontSize: 12, color: "#FF6B6B", marginTop: 4 }}>
          📅 Follow up: {lead.followUpDate}
        </div>
      )}

      {/* ── Action buttons row ── */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={S.btn("ghost")} onClick={onView}>👁 View</button>
        <button style={{ ...S.btn("ghost"), color: "#60A5FA" }} onClick={onEdit}>✏️ Edit</button>
        <button
          style={{ ...S.btn("ghost"), color: "#FF4757" }}
          onClick={() => onDelete(lead.id)}
        >
          🗑 Delete
        </button>
      </div>

      {/* ── Inline delete confirmation bar ── */}
      {confirmDeleteRes === lead.id && (
        <div style={{
          marginTop: 8,
          padding: "10px 12px",
          background: "#FF475720",
          border: "1px solid #FF475766",
          borderRadius: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: "#FF4757", flex: 1 }}>Delete this lead?</span>
          <button
            style={{ background: "#FF4757", border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px", fontWeight: 700, cursor: "pointer" }}
            onClick={() => onConfirmDelete(confirmDeleteRes)}
          >
            Yes, Delete
          </button>
          <button
            style={{ background: "#1e2d45", border: "none", color: "#aaa", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}
            onClick={onCancelDelete}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Workflow action buttons ── */}
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(!lead.status || lead.status === "New") && (
          <button style={S.btn("primary")} onClick={() => onQuote(lead)}>📤 Quote</button>
        )}
        {lead.status === "Quoted" && (
          <button style={{ ...S.btn("sm"), background: C.gold, color: "#0A0F1E" }} onClick={() => onBook(lead)}>
            ✅ Book
          </button>
        )}
        {lead.status === "Follow Up" && (
          <button style={{ ...S.btn("sm"), background: "#FF6B6B", color: "#fff" }} onClick={() => onQuote(lead)}>
            📤 Re-Quote
          </button>
        )}
        {lead.status === "Booked" && (
          <button style={{ ...S.btn("sm"), background: C.purple, color: "#0A0F1E" }} onClick={() => onPay(lead)}>
            💳 Pay
          </button>
        )}
        {lead.status === "Completed" && (
          <span style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>🎉 Done</span>
        )}
      </div>

    </div>
  );
}
