import React from "react";

export default function CommercialLeadFormFields({
  S,
  C,
  form,
  setForm,
  COM_SERVICE_COST_PER_SQFT,
  COM_FREQ_DISCOUNTS,
  COM_ADDONS,
  toggleAddon,
  markupFactor,
  formQuote,
  QuoteBoxComponent,
  submitForm,
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
        <div><div style={S.label}>Business Name</div><input style={S.input} value={form.bizName} onChange={(e)=>setForm({...form,bizName:e.target.value})} placeholder="Acme Corp" /></div>
        <div><div style={S.label}>Contact Name</div><input style={S.input} value={form.contactName} onChange={(e)=>setForm({...form,contactName:e.target.value})} placeholder="John Smith" /></div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
        <div><div style={S.label}>Email</div><input style={S.input} value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} /></div>
        <div><div style={S.label}>Phone</div><input style={S.input} value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})} /></div>
      </div>
      <div><div style={S.label}>Address</div><input style={S.input} value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})} /></div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))", gap:10 }}>
        <div><div style={S.label}>Sq Ft</div><input style={S.input} type="number" min={500} value={form.sqft} onChange={(e)=>setForm({...form,sqft:+e.target.value})} /></div>
        <div><div style={S.label}>Floors</div><input style={S.input} type="number" min={1} max={50} value={form.floors} onChange={(e)=>setForm({...form,floors:+e.target.value})} /></div>
        <div><div style={S.label}>Contract (mo)</div><input style={S.input} type="number" min={1} max={36} value={form.contractMonths} onChange={(e)=>setForm({...form,contractMonths:+e.target.value})} /></div>
        <div><div style={S.label}>Service</div><select style={S.select} value={form.serviceType} onChange={(e)=>setForm({...form,serviceType:e.target.value})}>{Object.keys(COM_SERVICE_COST_PER_SQFT).map((type)=><option key={type}>{type}</option>)}</select></div>
      </div>
      <div><div style={S.label}>Frequency</div><select style={S.select} value={form.frequency} onChange={(e)=>setForm({...form,frequency:e.target.value})}>{Object.keys(COM_FREQ_DISCOUNTS).map((frequency)=><option key={frequency}>{frequency}</option>)}</select></div>
      <div><div style={S.label}>Add-Ons</div><div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{COM_ADDONS.map((addon)=>(<button key={addon.id} onClick={()=>toggleAddon(addon.id)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", background:(form.addons||[]).includes(addon.id)?C.blueDim:C.surface, color:(form.addons||[]).includes(addon.id)?C.blue:C.muted, border:`1px solid ${(form.addons||[]).includes(addon.id)?C.blue:C.border}` }}>{addon.label} +${markupFactor(addon.costToUs)}</button>))}</div></div>
      {formQuote && (
        <>
          <QuoteBoxComponent q={formQuote} type="com" />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:10, marginTop:10 }}>
            <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>MONTHLY</div><div style={{ fontSize:18,fontWeight:800,color:C.gold }}>${formQuote.monthly.toFixed(0)}</div></div>
            <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>{form.contractMonths}-MO CONTRACT</div><div style={{ fontSize:18,fontWeight:800,color:C.blue }}>${formQuote.contract.toFixed(0)}</div></div>
          </div>
        </>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
        <div><div style={S.label}>Preferred Date</div><input style={S.input} type="date" value={form.preferredDate} onChange={(e)=>setForm({...form,preferredDate:e.target.value})} /></div>
        <div><div style={S.label}>Preferred Time</div><input style={S.input} type="time" value={form.preferredTime} onChange={(e)=>setForm({...form,preferredTime:e.target.value})} /></div>
      </div>
      <div><div style={S.label}>Notes</div><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} /></div>
      <button style={{ ...S.btn("primary"), width:"100%" }} onClick={submitForm} disabled={!form.bizName||!form.email}>💾 Save Lead & Generate Proposal</button>
    </div>
  );
}
