import React from "react";

export default function CommercialLeadCard({
  lead,
  q,
  C,
  S,
  COM_ADDONS,
  actionRowStyle,
  actionButtonStyle,
  onView,
  onSendQuote,
  onBook,
  onConfirmPayment,
}) {
  return (
    <div style={S.card}>
      <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:17 }}>{lead.bizName}</div>
          <div style={{ fontSize:13, color:C.muted }}>👤 {lead.contactName} · 📧 {lead.email}</div>
          <div style={{ fontSize:13, color:C.muted }}>📐 {lead.sqft.toLocaleString()} sqft · {lead.floors} fl · {lead.serviceType} · {lead.frequency}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <span style={S.badge(lead.status === "paid" ? "green" : lead.status === "booked" ? "green" : lead.status === "quoted" ? "gold" : "blue")}>{lead.status}</span>
          <div style={{ fontWeight:800, fontSize:20, color:C.accent, marginTop:6 }}>${q.total.toFixed(2)}<span style={{ fontSize:12, color:C.muted }}>/visit</span></div>
          <div style={{ fontSize:12, color:C.gold }}>Profit: ${q.profit}/visit · {q.margin}% margin</div>
          <div style={{ fontSize:12, color:C.muted }}>${q.monthly.toFixed(0)}/mo · ${q.contract.toFixed(0)} contract</div>
        </div>
      </div>

      {(lead.addons || []).length > 0 && (
        <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>
          {lead.addons.map((id) => {
            const addon = COM_ADDONS.find((entry) => entry.id === id);
            return addon ? <span key={id} style={S.badge("blue")}>{addon.label}</span> : null;
          })}
        </div>
      )}

      {lead.notes && <div style={{ marginTop:10, fontSize:12, color:C.muted, background:C.surface, borderRadius:8, padding:"8px 12px" }}>💬 {lead.notes}</div>}

      <div style={actionRowStyle}>
        <button style={{ ...S.btn("ghost"), ...actionButtonStyle }} onClick={onView}>👁 View Proposal</button>
        {lead.status === "new" && <button style={{ ...S.btn("primary"), ...actionButtonStyle }} onClick={onSendQuote}>📤 Send Proposal</button>}
        {lead.status === "quoted" && <button style={{ ...S.btn("sm"), ...actionButtonStyle, background:C.gold, color:"#0A0F1E" }} onClick={onBook}>✅ Sign Contract</button>}
        {lead.status === "booked" && <button style={{ ...S.btn("sm"), ...actionButtonStyle, background:C.purple, color:"#0A0F1E" }} onClick={onConfirmPayment}>💳 Confirm Deposit</button>}
        {lead.status === "paid" && <span style={{ fontSize:13, color:C.accent, fontWeight:700 }}>🎉 Contract Active!</span>}
      </div>
    </div>
  );
}
