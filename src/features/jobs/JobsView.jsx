import React, { useCallback, useMemo, useState } from "react";
import { List as VirtualList } from "react-window";

const JOB_VIRTUALIZE_THRESHOLD = 75;
const JOB_ROW_HEIGHT = 256;
const PARTNER_SHARE = 0.60;
const COMPANY_SHARE = 0.40;
const PARTNER_COST_PER_HOUR = 30;
const JOB_TYPES = ["Refresh Clean","Full Home Clean","Deep Clean","Move-In / Move-Out","Kitchen & Bathroom Refresh","Post-Construction"];
const UPSELL_OPTIONS = ["Inside Fridge","Inside Oven","Inside Cabinets","Interior Windows","Baseboards / Detail","Carpet Cleaning","Pet Hair / Heavy Detail"];

const C = {
  bg: "#0B1020",
  surface: "#121A2B",
  card: "#121826",
  border: "#243047",
  text: "#E5EEF8",
  muted: "#94A3B8",
  dim: "#64748B",
  accent: "#00D4AA",
  accentDim: "rgba(0, 212, 170, 0.14)",
  gold: "#FBBF24",
  blue: "#60A5FA",
};

const styles = {
  h2: { fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 },
  divider: { height: 1, background: C.border, margin: "16px 0" },
  label: { fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" },
  input: { width: "100%", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" },
  select: { width: "100%", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" },
  navBtn: (active) => ({ padding: "8px 14px", borderRadius: 999, border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentDim : C.surface, color: active ? C.accent : C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer" }),
  badge: (tone) => {
    const map = {
      green: { bg: "rgba(34,197,94,0.15)", color: "#22C55E" },
      gold: { bg: "rgba(251,191,36,0.15)", color: C.gold },
      blue: { bg: "rgba(96,165,250,0.15)", color: C.blue },
    };
    const pick = map[tone] || map.blue;
    return { padding: "4px 10px", borderRadius: 999, background: pick.bg, color: pick.color, fontSize: 12, fontWeight: 700 };
  },
  btn: (tone) => {
    const map = {
      primary: { background: C.accent, color: "#06261F", border: "none" },
      ghost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}` },
      sm: { background: C.blue, color: "#08101E", border: "none" },
    };
    const pick = map[tone] || map.ghost;
    return { padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, ...pick };
  },
};

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width: "100%", maxWidth: wide ? 960 : 640, maxHeight: "90vh", overflowY: "auto", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, boxSizing: "border-box" }}>
        {title && <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

function getTeamSize(sqft = 0) {
  if (sqft > 3000) return 3;
  if (sqft > 1000) return 2;
  return 1;
}

function getJobHours(sqft = 0) {
  if (!sqft) return 2;
  const hrs = Math.max(1.5, sqft / 1000);
  return Math.round(hrs * 2) / 2;
}

export default function JobsView({ jobs, setJobs, partners }) {
  const [filter, setFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [pendingCompleteId, setPendingCompleteId] = useState(null);
  const [summaryText, setSummaryText] = useState("");
  const [newJob, setNewJob] = useState({ client: "", address: "", type: "Standard Clean", date: "", time: "", partnerId: "", partnerIds: [], sqft: 0, hours: 2, upsells: [], beforePics: [], afterPics: [], summary: "", status: "scheduled", pay: 0 });

  const filtered = useMemo(() => (filter === "all" ? jobs : jobs.filter(j => j.status === filter)), [filter, jobs]);

  const handleAdd = () => {
    const partnerIds = newJob.partnerIds?.filter(Boolean) || (newJob.partnerId ? [parseInt(newJob.partnerId)] : []);
    const teamSize = partnerIds.length || 1;
    const clientPrice = Math.round((teamSize * PARTNER_COST_PER_HOUR * newJob.hours) / PARTNER_SHARE);
    const partnerPayTotal = Math.round(clientPrice * PARTNER_SHARE);
    const partnerPayEach = Math.round(partnerPayTotal / teamSize);
    setJobs([...jobs, {
      ...newJob,
      id: Date.now(),
      partnerId: partnerIds[0] || null,
      partnerIds,
      teamSize,
      clientPrice,
      partnerPay: partnerPayTotal,
      partnerPayEach,
      profit: Math.round(clientPrice * COMPANY_SHARE),
      pay: partnerPayEach,
    }]);
    setShowModal(false);
    setNewJob({ client: "", address: "", type: "Standard Clean", date: "", time: "", partnerId: "", partnerIds: [], sqft: 0, hours: 2, upsells: [], beforePics: [], afterPics: [], summary: "", status: "scheduled", pay: 0 });
  };

  const updateStatus = (id, status) => setJobs(jobs.map(j => j.id === id ? { ...j, status } : j));
  const updateSummary = (id, summary) => setJobs(jobs.map(j => j.id === id ? { ...j, summary } : j));
  const toggleUpsell = (upsell) => {
    const nextUpsells = newJob.upsells.includes(upsell) ? newJob.upsells.filter(x => x !== upsell) : [...newJob.upsells, upsell];
    setNewJob({ ...newJob, upsells: nextUpsells });
  };

  const renderJobCard = useCallback((job, wrapperStyle = null) => {
    const jobPartners = (job.partnerIds || [job.partnerId]).map(id => partners.find(p => p.id === id)).filter(Boolean);
    return (
      <div key={job.id} style={{ ...styles.card, ...(wrapperStyle || {}) }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{job.client}</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>📍 {job.address}</div>
            <div style={{ color: C.muted, fontSize: 13 }}>📅 {job.date} at {job.time} · {job.type}</div>
            {jobPartners.length > 0 && <div style={{ fontSize: 13, marginTop: 4 }}>👷 <strong>{jobPartners.map(p => p.name).join(" + ")}</strong></div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={styles.badge(job.status === "completed" ? "green" : job.status === "in-progress" ? "gold" : "blue")}>{job.status}</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: C.accent }}>${job.pay}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{job.hours}h · {(job.upsells || []).length} upsells</div>
          </div>
        </div>

        {(job.upsells || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={styles.label}>Upsells</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(job.upsells || []).map(u => <span key={u} style={styles.badge("gold")}>{u}</span>)}
            </div>
          </div>
        )}

        {job.status === "completed" && job.summary && (
          <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: "10px 14px" }}>
            <div style={styles.label}>End-of-Job Summary</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{job.summary}</div>
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {job.status === "scheduled" && <button style={styles.btn("sm")} onClick={() => updateStatus(job.id, "in-progress")}>▶ Start Job</button>}
          {job.status === "in-progress" && (
            <button style={{ ...styles.btn("sm"), background: C.gold, color: "#0A0F1E", minHeight: 44 }} onClick={() => {
              setPendingCompleteId(job.id);
              setSummaryText("");
              setSummaryDrawerOpen(true);
            }}>✅ Complete Job</button>
          )}
          <button style={styles.btn("ghost")} onClick={() => setSelectedJob(job)}>📸 Photos & Details</button>
        </div>
      </div>
    );
  }, [partners, jobs, setJobs]);

  const JobRow = useCallback(({ index, style, ariaAttributes, jobs: rowJobs, renderCard }) => (
    <div style={{ ...style, paddingBottom: 14, boxSizing: "border-box" }} {...ariaAttributes}>
      {renderCard(rowJobs[index], { marginBottom: 0, height: JOB_ROW_HEIGHT - 14, overflow: "hidden" })}
    </div>
  ), []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={styles.h2}>Jobs</div>
        <button style={styles.btn("primary")} onClick={() => setShowModal(true)}>+ New Job</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all","scheduled","in-progress","completed"].map(f => (
          <button key={f} style={styles.navBtn(filter === f)} onClick={() => setFilter(f)}>
            {f === "all" ? "All Jobs" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filtered.length > JOB_VIRTUALIZE_THRESHOLD ? (
          <VirtualList
            rowComponent={JobRow}
            rowCount={filtered.length}
            rowHeight={JOB_ROW_HEIGHT}
            rowProps={{ jobs: filtered, renderCard: renderJobCard }}
            style={{ height: 720 }}
          />
        ) : (
          filtered.map(job => renderJobCard(job))
        )}
      </div>

      {summaryDrawerOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:600, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={e => { if(e.target===e.currentTarget) setSummaryDrawerOpen(false); }}>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"16px 16px 0 0", padding:"24px 20px", width:"100%", maxWidth:480, boxSizing:"border-box", paddingBottom:"max(20px,env(safe-area-inset-bottom,20px))" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:C.border, margin:"0 auto 20px" }} />
            <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:8 }}>✅ Complete Job</div>
            <div style={{ fontSize:14, color:C.muted, marginBottom:16 }}>Add an end-of-job summary (optional)</div>
            <textarea value={summaryText} onChange={e => setSummaryText(e.target.value)} placeholder="e.g. Client was happy. Carpet came out great. No issues." rows={4} style={{ width:"100%", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", outline:"none" }} autoFocus />
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
              <button style={{ padding:14, borderRadius:10, border:"none", background:C.gold, color:"#0A0F1E", fontSize:15, fontWeight:800, cursor:"pointer", minHeight:44 }} onClick={() => {
                if (pendingCompleteId) {
                  if (summaryText.trim()) updateSummary(pendingCompleteId, summaryText.trim());
                  updateStatus(pendingCompleteId, "completed");
                }
                setSummaryDrawerOpen(false);
                setPendingCompleteId(null);
                setSummaryText("");
              }}>Mark as Completed</button>
              <button style={{ padding:14, borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:15, fontWeight:600, cursor:"pointer", minHeight:44 }} onClick={() => { setSummaryDrawerOpen(false); setPendingCompleteId(null); setSummaryText(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <Modal title="Book New Job" onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><div style={styles.label}>Client Name</div><input style={styles.input} value={newJob.client} onChange={e => setNewJob({ ...newJob, client: e.target.value })} placeholder="e.g. The Smith Household" /></div>
            <div><div style={styles.label}>Address</div><input style={styles.input} value={newJob.address} onChange={e => setNewJob({ ...newJob, address: e.target.value })} placeholder="123 Main St" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><div style={styles.label}>Date</div><input style={styles.input} type="date" value={newJob.date} onChange={e => setNewJob({ ...newJob, date: e.target.value })} /></div>
              <div><div style={styles.label}>Time</div><input style={styles.input} type="time" value={newJob.time} onChange={e => setNewJob({ ...newJob, time: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><div style={styles.label}>Job Type</div><select style={styles.select} value={newJob.type} onChange={e => setNewJob({ ...newJob, type: e.target.value })}>{JOB_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div><div style={styles.label}>Sqft</div><input style={styles.input} type="number" value={newJob.sqft || ""} onChange={e => setNewJob({ ...newJob, sqft: parseInt(e.target.value) || 0, hours: getJobHours(parseInt(e.target.value) || 0) })} placeholder="e.g. 1200" /></div>
              <div><div style={styles.label}>Est. Hours</div><input style={styles.input} type="number" min={1} max={12} value={newJob.hours} onChange={e => setNewJob({ ...newJob, hours: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div>
              <div style={styles.label}>Assign Team {newJob.sqft ? <span style={{ marginLeft:8, fontSize:11, color:C.accent, fontWeight:700 }}>👥 {getTeamSize(newJob.sqft)} partner{getTeamSize(newJob.sqft)>1?"s":""} recommended for {newJob.sqft} sqft</span> : null}</div>
              {[0,1,2].slice(0, Math.max(1, getTeamSize(newJob.sqft || 0))).map((slot, i) => (
                <select key={slot} style={{ ...styles.select, marginBottom:6 }} value={(newJob.partnerIds || [])[i] || ""} onChange={e => {
                  const ids = [...(newJob.partnerIds || [null, null, null])];
                  ids[i] = e.target.value ? parseInt(e.target.value) : null;
                  const clean = ids.filter(Boolean);
                  setNewJob({ ...newJob, partnerIds: clean, partnerId: clean[0] || "" });
                }}>
                  <option value="">— Partner {i+1} {i===0?"(required)":"(optional)"} —</option>
                  {partners.filter(p => p.onboarded).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ))}
            </div>
            <div>
              <div style={styles.label}>Upsells</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {UPSELL_OPTIONS.map(u => (
                  <button key={u} onClick={() => toggleUpsell(u)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: newJob.upsells.includes(u) ? C.accentDim : C.surface, color: newJob.upsells.includes(u) ? C.accent : C.muted, border: `1px solid ${newJob.upsells.includes(u) ? C.accent : C.border}` }}>{u}</button>
                ))}
              </div>
            </div>
            <button style={{ ...styles.btn("primary"), width: "100%" }} onClick={handleAdd} disabled={!newJob.client || !(newJob.partnerIds || [newJob.partnerId]).filter(Boolean).length || !newJob.date}>Book Job</button>
          </div>
        </Modal>
      )}

      {selectedJob && (
        <Modal title={`📋 ${selectedJob.client}`} onClose={() => setSelectedJob(null)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ background:`linear-gradient(135deg,${C.accentDim},${C.surface})`, borderRadius:12, padding:16, border:`1px solid ${C.accent}44` }}>
              <div style={{ fontWeight:800, fontSize:16, color:C.accent, marginBottom:10 }}>📋 Work Order {selectedJob.workOrder?.id || `WO-${selectedJob.id}`}</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:8, fontSize:13 }}>
                <div><span style={{ color:C.muted }}>Client: </span><strong>{selectedJob.client}</strong></div>
                <div><span style={{ color:C.muted }}>Date: </span><strong>{selectedJob.date}</strong></div>
                <div><span style={{ color:C.muted }}>Time: </span><strong>{selectedJob.time}</strong></div>
                <div><span style={{ color:C.muted }}>Hours: </span><strong>{selectedJob.hours}h estimated</strong></div>
                <div style={{ gridColumn:"1/-1" }}><span style={{ color:C.muted }}>Address: </span><strong>{selectedJob.address}</strong></div>
                <div><span style={{ color:C.muted }}>Service: </span><strong>{selectedJob.type}</strong></div>
                <div style={{ gridColumn:"1/-1" }}><span style={{ color:C.muted }}>Team: </span><strong>{(selectedJob.partnerIds||[selectedJob.partnerId]).map(id=>partners.find(p=>p.id===id)?.name).filter(Boolean).join(" · ") || "Unassigned"}</strong></div>
              </div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:700 }}>🎨 RAG SYSTEM: <span style={{ color:"#FF4757" }}>🔴 Red = Toilets ONLY</span> · <span style={{ color:"#FFA502" }}>🟡 Yellow = Sinks/Mirrors</span> · <span style={{ color:"#2ED573" }}>🟢 Green = Kitchen</span> · <span style={{ color:"#1E90FF" }}>🔵 Blue = General/Glass</span></div>
            <div>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>📝 End-of-Job Summary</div>
              <textarea style={{ ...styles.input, minHeight:80, resize:"vertical" }} value={selectedJob.summary || ""} onChange={e => {
                const updated = { ...selectedJob, summary: e.target.value };
                setJobs(jobs.map(j => j.id === selectedJob.id ? updated : j));
                setSelectedJob(updated);
              }} placeholder="What was done, client feedback, any issues to flag..." />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
