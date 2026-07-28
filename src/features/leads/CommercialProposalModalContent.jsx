import React from "react";

export default function CommercialProposalModalContent({
  viewLead,
  viewLeadQuote,
  C,
  S,
  QuoteBoxComponent,
  onSendQuote,
  onBook,
  onConfirmPayment,
}) {
  if (!viewLeadQuote) return null;

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:14, color:C.muted }}>👤 {viewLead.contactName} · {viewLead.email}</div>
        <div style={{ fontSize:13, color:C.muted }}>📐 {viewLead.sqft.toLocaleString()} sqft · {viewLead.floors} floor(s) · {viewLead.serviceType} · {viewLead.frequency}</div>
      </div>
      <QuoteBoxComponent q={viewLeadQuote} type="com" />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:10, marginTop:10 }}>
        <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>MONTHLY</div><div style={{ fontSize:20,fontWeight:800,color:C.gold }}>${viewLeadQuote.monthly.toFixed(0)}</div></div>
        <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>{viewLead.contractMonths}-MO CONTRACT</div><div style={{ fontSize:20,fontWeight:800,color:C.blue }}>${viewLeadQuote.contract.toFixed(0)}</div></div>
      </div>
      <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
        {viewLead.status === "new" && <button style={{ ...S.btn("primary"), width:"100%" }} onClick={onSendQuote}>📤 Send Proposal</button>}
        {viewLead.status === "quoted" && <button style={{ ...S.btn("primary"), width:"100%", background:C.gold, color:"#0A0F1E" }} onClick={onBook}>✅ Sign Contract + Work Order</button>}
        {viewLead.status === "booked" && <button style={{ ...S.btn("primary"), width:"100%", background:C.purple, color:"#0A0F1E" }} onClick={onConfirmPayment}>💳 Confirm Deposit</button>}
        {viewLead.status === "paid" && <div style={{ textAlign:"center", color:C.accent, fontWeight:800 }}>🎉 Contract Active!</div>}
      </div>
    </div>
  );
}
