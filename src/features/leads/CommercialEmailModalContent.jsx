import React from "react";

export default function CommercialEmailModalContent({
  showEmail,
  C,
  S,
  onCopyBody,
}) {
  if (!showEmail) return null;

  return (
    <div>
      <div style={{ background:C.accentDim, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"12px 16px", marginBottom:18, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:20 }}>✅</span>
        <div>
          <div style={{ fontWeight:700, color:C.accent, fontSize:14 }}>Lead marked as Quoted</div>
          <div style={{ fontSize:12, color:C.muted }}>Send the proposal using one of the options below</div>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12, marginBottom:14 }}>
        <div><div style={S.label}>To</div><div style={{ background:C.surface, borderRadius:8, padding:"10px 12px", fontSize:14, fontWeight:700 }}>{showEmail.lead.email}</div></div>
        <div><div style={S.label}>Subject</div><div style={{ background:C.surface, borderRadius:8, padding:"10px 12px", fontSize:13, color:C.muted }}>{showEmail.subject}</div></div>
      </div>
      <div style={{ marginBottom:18 }}>
        <div style={S.label}>Proposal Preview</div>
        <div style={{ background:C.surface, borderRadius:10, padding:16, fontSize:13, color:C.muted, lineHeight:1.9, whiteSpace:"pre-line", maxHeight:260, overflowY:"auto", border:`1px solid ${C.border}` }}>{showEmail.body}</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(showEmail.lead.email || "")}&su=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`} target="_blank" rel="noopener noreferrer"
          style={{ ...S.btn("primary"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }}>
          <span style={{ fontSize:20 }}>📨</span>
          <div><div style={{ fontWeight:800 }}>Open in Gmail</div><div style={{ fontSize:11, opacity:0.8 }}>Pre-filled and ready to send</div></div>
        </a>
        <a href={`mailto:${showEmail.lead.email || ""}?subject=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`}
          style={{ ...S.btn("ghost"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }}>
          <span style={{ fontSize:20 }}>📱</span>
          <div><div style={{ fontWeight:800 }}>Open in Mail App</div><div style={{ fontSize:11, color:C.dim }}>Opens your default email app</div></div>
        </a>
        <button style={{ ...S.btn("ghost"), display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }} onClick={onCopyBody}>
          <span style={{ fontSize:20 }}>📋</span>
          <div><div style={{ fontWeight:800 }}>Copy Proposal Body</div><div style={{ fontSize:11, color:C.dim }}>Paste into any email manually</div></div>
        </button>
      </div>
    </div>
  );
}
