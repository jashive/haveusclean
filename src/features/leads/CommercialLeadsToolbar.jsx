import React from "react";

export default function CommercialLeadsToolbar({
  S,
  leadsCount,
  monthlyValue,
  activeContractsCount,
  C,
  onNewLead,
}) {
  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div style={S.h2}>🏢 Commercial Leads</div>
        <button style={S.btn("primary")} onClick={onNewLead}>+ New Lead</button>
      </div>
      <div style={S.grid3}>
        <div style={S.statCard(C.blue)}>
          <div style={{ fontSize:24, marginBottom:4 }}>🏢</div>
          <div style={{ fontSize:26, fontWeight:800, color:C.blue }}>{leadsCount}</div>
          <div style={{ fontSize:13, fontWeight:600, color:C.text, marginTop:2 }}>Commercial Leads</div>
        </div>
        <div style={S.statCard(C.gold)}>
          <div style={{ fontSize:24, marginBottom:4 }}>📈</div>
          <div style={{ fontSize:26, fontWeight:800, color:C.gold }}>${monthlyValue.toFixed(0)}</div>
          <div style={{ fontSize:13, fontWeight:600, color:C.text, marginTop:2 }}>Monthly Value</div>
        </div>
        <div style={S.statCard(C.accent)}>
          <div style={{ fontSize:24, marginBottom:4 }}>📑</div>
          <div style={{ fontSize:26, fontWeight:800, color:C.accent }}>{activeContractsCount}</div>
          <div style={{ fontSize:13, fontWeight:600, color:C.text, marginTop:2 }}>Active Contracts</div>
        </div>
      </div>
    </>
  );
}
