import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedRestFetchWithRefresh } from "../../lib/serviceosAuthClient.js";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import { SERVICEOS_FINANCIAL_INVALIDATED_EVENT } from "../../lib/serviceosFinancialPerformance.js";

async function rpc(name, body) {
  const response = await authenticatedRestFetchWithRefresh(`rpc/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response?.text().catch(() => ""); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response?.ok) throw new Error(data?.message || data?.error || `${name} failed.`);
  return Array.isArray(data) ? data[0] : data;
}

function money(value, currency) { return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value || 0)); }
function mondayIso() { const d = new Date(); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d.toISOString().slice(0, 10); }

export default function CleanerPayablesPanel({ revenueContext }) {
  const [data,setData]=useState(null),[workers,setWorkers]=useState([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [workerId,setWorkerId]=useState(""),[rate,setRate]=useState(""),[weekStart,setWeekStart]=useState(mondayIso),[weeklyHours,setWeeklyHours]=useState("40");
  const orgId=revenueContext?.orgId,businessUnitId=revenueContext?.primaryBusinessUnitId,role=revenueContext?.roleCode;
  const load=useCallback(async()=>{if(!orgId||!businessUnitId)return;setBusy(true);setError("");try{
    const [dashboard,workerResponse]=await Promise.all([rpc("get_cleaner_payables_dashboard",{p_organization_id:orgId,p_business_unit_id:businessUnitId,p_limit:250}),authenticatedRestFetchWithRefresh(`worker?select=id,display_name,email&business_unit_id=eq.${encodeURIComponent(businessUnitId)}&status=eq.active&order=display_name.asc`)]);
    if(!workerResponse?.ok)throw new Error("Active cleaners could not be loaded."); const workerRows=await workerResponse.json();
    setData(dashboard);setWorkers(Array.isArray(workerRows)?workerRows:[]);setWorkerId((current)=>current||workerRows?.[0]?.id||"");
  }catch(e){setError(e?.message||String(e));}finally{setBusy(false);}},[orgId,businessUnitId]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{const refreshPayables=(event)=>{if(!event?.detail?.businessUnitId||event.detail.businessUnitId===businessUnitId)load();};window.addEventListener(SERVICEOS_FINANCIAL_INVALIDATED_EVENT,refreshPayables);return()=>window.removeEventListener(SERVICEOS_FINANCIAL_INVALIDATED_EVENT,refreshPayables);},[businessUnitId,load]);
  const rows=Array.isArray(data?.rows)?data.rows:[],currency=data?.scope?.currency_code||"USD";
  const csv=useMemo(()=>["Cleaner,Work Order,Actual Hours,Hourly Rate,Amount,Currency,Status,Created",...rows.map(r=>[r.worker_name,r.work_order_number,r.actual_hours,r.hourly_rate,r.amount,r.currency_code,r.status,r.created_at].map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(","))].join("\n"),[rows]);
  function exportCsv(){const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`cleaner-payables-${data?.scope?.market_code||"market"}.csv`;a.click();URL.revokeObjectURL(url);}
  async function saveRate(){setBusy(true);setError("");try{await rpc("staff_set_worker_hourly_compensation",{p_worker_id:workerId,p_hourly_rate:Number(rate),p_effective_from:new Date().toISOString()});setRate("");await load();}catch(e){setError(e?.message||String(e));}finally{setBusy(false);}}
  async function saveCapacity(){setBusy(true);setError("");try{await rpc("staff_set_worker_weekly_capacity",{p_worker_id:workerId,p_week_start:weekStart,p_available_hours:Number(weeklyHours)});await load();}catch(e){setError(e?.message||String(e));}finally{setBusy(false);}}
  return <section className="financial-performance-panel cleaner-payables-panel" aria-labelledby="cleaner-payables-title"><header><div><p className="admin-eyebrow">Payroll readiness · {data?.scope?.market_code||"Active market"}</p><h2 id="cleaner-payables-title">Cleaner Payables</h2><p>Earned compensation is created at governed QA approval. Payroll approval remains a separate control.</p></div><button className="huc-button huc-button--secondary" onClick={load} disabled={busy}>Refresh</button></header>
    {error?<div className="financial-alert" role="alert">{error}</div>:null}
    <div className="financial-kpi-grid"><article className="financial-kpi-card"><span>Pending payout</span><strong>{money(data?.pending_total,currency)}</strong><small>Earned; awaiting payroll approval</small></article><article className="financial-kpi-card"><span>Approved / paid</span><strong>{money(data?.approved_total,currency)}</strong><small>Approved payroll liability</small></article></div>
    <div className="admin-filter-bar"><label className="admin-select-field"><span>Cleaner</span><select value={workerId} onChange={e=>setWorkerId(e.target.value)}>{workers.map(w=><option key={w.id} value={w.id}>{w.display_name||w.email}</option>)}</select></label>
      {role==="owner_admin"?<><label className="admin-search-field"><span>Hourly rate ({currency})</span><input type="number" min="0.01" max="500" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label><button className="huc-button huc-button--secondary" disabled={busy||!workerId||!rate} onClick={saveRate}>Set governed rate</button></>:null}
      <label className="admin-search-field"><span>Week starting Monday</span><input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)}/></label><label className="admin-search-field"><span>Available hours</span><input type="number" min="0" max="120" step="0.5" value={weeklyHours} onChange={e=>setWeeklyHours(e.target.value)}/></label><button className="huc-button huc-button--secondary" disabled={busy||!workerId} onClick={saveCapacity}>Save capacity</button><button className="huc-button huc-button--secondary" disabled={!rows.length} onClick={exportCsv}>Export payroll CSV</button></div>
    {rows.length?<div className="financial-table" role="table" aria-label="Cleaner payables"><div className="financial-table__row financial-table__head" role="row"><span>Cleaner</span><span>Hours</span><span>Rate</span><span>Amount</span><span>Status</span><span>Work order</span></div>{rows.map(row=><div className="financial-table__row" role="row" key={row.id}><span><b>{row.worker_name}</b></span><span>{row.compensation_method==="hourly"?Number(row.actual_hours).toFixed(2):"Flat"}</span><span>{row.compensation_method==="hourly"?money(row.hourly_rate,row.currency_code):"Contract"}</span><span>{money(row.amount,row.currency_code)}</span><span><StatusBadge tone={row.status==="pending"?"warning":"success"}>{row.status}</StatusBadge></span><span>{row.work_order_number||"Work order"}<TechnicalDetails><span>Payable: {row.id}</span></TechnicalDetails></span></div>)}</div>:<div className="financial-empty-state"><StatusBadge tone="neutral">No governed data</StatusBadge><h3>No cleaner payables in this territory</h3><p>Payables appear after QA approval and require an active compensation version.</p></div>}
  </section>;
}
