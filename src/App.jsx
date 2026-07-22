// ─── HAVE US CLEAN v4.0 ── Operating System ──────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import ConfirmDrawer from "./components/ConfirmDrawer";
import MobileBottomNav, { useMobileNav, MOBILE_NAV_HEIGHT } from "./components/MobileBottomNav";
import MySchedule from "./pages/MySchedule";
import StatusBadge from "./components/StatusBadge";
import { getSmartViewCounts, getAllSmartViews } from "./features/views/smartViews";
import { filterLeads } from "./features/leads/leadUtils";
import { filterJobs, getJobPartners } from "./features/jobs/jobUtils";

// Import BookingWidget safely
import BookingWidget from "./components/BookingWidget";

// ─── BRAND CONFIG ─────────────────────────────────────────────────────────────
const BRAND = {
  name: "Have Us Clean",
  tagline: "Mid-Market Cleaning · Toronto & GTA",
  version: "4.0.0",
  color: "#00D4AA",
  logoMark: "🧹",
  supportEmail: "haveusclean@gmail.com",
  website: "https://haveusclean.ca",
  businessName: "Have Us Clean",
  market: "Toronto & GTA",
  position: "Mid-market",
};

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0F1E", surface: "#111827", card: "#1A2235", border: "#1E2D45",
  accent: "#00D4AA", accentDim: "#00D4AA22", gold: "#FFB800", goldDim: "#FFB80022",
  red: "#FF4757", redDim: "#FF475722", blue: "#3B82F6", blueDim: "#3B82F622",
  purple: "#A78BFA", purpleDim: "#A78BFA22",
  text: "#F0F6FF", muted: "#8899AA", dim: "#445566",
};

const HUC_STATUSES = ["New", "Quoted", "Follow Up", "Booked", "Completed", "Lost"];
const HUC_STATUS_COLOR = {
  "New": C.blue, "Quoted": C.gold, "Follow Up": "#FF6B6B",
  "Booked": C.accent, "Completed": C.accent, "Lost": C.dim,
};

const REGIONS = {
  "ON": { id: "ON", country: "CA", flag: "🇨🇦", label: "Ontario, Canada", currency: "CAD", currencySymbol: "CA$", locale: "en-CA" },
  "AZ": { id: "AZ", country: "US", flag: "🇺🇸", label: "Arizona, USA", currency: "USD", currencySymbol: "$", locale: "en-US" },
};

let ACTIVE_REGION = REGIONS["ON"];

const initPartners = [
  { id:1, name:"Maria Santos", phone:"(416) 555-0101", email:"maria@haveusclean.com", status:"active", rating:4.9, jobsDone:47, payRate:26, availability:["Mon","Tue","Wed","Thu","Fri"], onboarded:true, avatar:"MS", region:"ON" },
  { id:2, name:"James Cole", phone:"(480) 555-0102", email:"james@haveusclean.com", status:"active", rating:4.7, jobsDone:31, payRate:22, availability:["Mon","Wed","Fri","Sat"], onboarded:true, avatar:"JC", region:"AZ" },
  { id:3, name:"Tanya Brooks", phone:"(416) 555-0103", email:"tanya@haveusclean.com", status:"available", rating:4.8, jobsDone:22, payRate:24, availability:["Tue","Thu","Sat","Sun"], onboarded:true, avatar:"TB", region:"ON" },
];

const TODAY_DATE = new Date().toISOString().split("T")[0];

const initJobs = [
  { id:1, client:"Sarah M. — 2BR Condo", email:"sarah.m@email.com", address:"88 Maple Dr, North York ON", type:"Full Home Clean", date:TODAY_DATE, time:"9:00 AM", partnerId:1, partnerIds:[1], status:"scheduled", hours:3, upsells:["Inside Oven","Inside Fridge"], beforePics:[], afterPics:[], summary:"", clientPrice:210, partnerPay:137, profit:73, checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:"Bi-Weekly", nextDate:null, region:"ON" },
  { id:2, client:"The Thompson House", email:"thompson@email.com", address:"55 Birchwood Ave, Scottsdale AZ", type:"Deep Clean", date:TODAY_DATE, time:"1:00 PM", partnerId:2, partnerIds:[2], status:"in-progress", hours:4, upsells:["Baseboards / Detail"], beforePics:[], afterPics:[], summary:"", clientPrice:320, partnerPay:208, profit:112, checkIn:"1:03 PM", checkOut:null, checkInCoords:{lat:33.4484,lng:-112.0740}, checkOutCoords:null, recurring:"One-Time", nextDate:null, region:"AZ" },
];

const S = {
  app: { minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:C.text, display:"flex", flexDirection:"column" },
  header: { background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:200 },
  logo: { display:"flex", alignItems:"center", gap:10, fontWeight:800, fontSize:17, letterSpacing:"-0.5px", flexShrink:0 },
  logoMark: { width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 },
  main: { flex:1, padding:"20px 16px", maxWidth:960, width:"100%", margin:"0 auto", boxSizing:"border-box" },
  card: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:18 },
  h2: { fontSize:20, fontWeight:800, marginBottom:16, letterSpacing:"-0.3px" },
  h3: { fontSize:15, fontWeight:700, marginBottom:10 },
  label: { fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:C.muted, marginBottom:5 },
  input: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box" },
  select: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box", cursor:"pointer" },
  btn: (v="primary") => ({ padding:v==="sm"?"8px 14px":"11px 20px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:v==="sm"?13:14, background:v==="primary"?C.accent:C.card, color:v==="primary"?"#0A0F1E":C.muted, border:"none" }),
  badge: (color) => ({ display:"inline-block", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:color==="green"?C.accentDim:color==="gold"?C.goldDim:color==="red"?C.redDim:C.blueDim, color:color==="green"?C.accent:color==="gold"?C.gold:color==="red"?C.red:C.blue }),
  grid2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))", gap:14 },
  grid3: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,180px),1fr))", gap:12 },
  grid4: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,140px),1fr))", gap:10 },
  divider: { height:1, background:C.border, margin:"16px 0" },
  statCard: (color) => ({ background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:"15px 16px", borderLeft:`3px solid ${color}` }),
};

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={S.statCard(color)}>
      <div style={{ fontSize:24, marginBottom:4 }}>{icon}</div>
      <div style={{ fontSize:26, fontWeight:800, color }}>{value}</div>
      <div style={{ fontSize:13, fontWeight:600, color:C.text, marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ─── MAIN APP COMPONENT ────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const isMobile = useMobileNav();
  const [jobs, setJobs] = useState(initJobs);
  const [partners, setPartners] = useState(initPartners);
  const [activeRegion, setActiveRegion] = useState(REGIONS["ON"]);

  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";

  // Standalone Route Check for /book
  if (currentPath === "/book") {
    return (
      <div style={{ minHeight: "100vh", background: "#0A0F1E", padding: "40px 16px" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <h1 style={{ color: "#fff", fontSize: "28px", fontWeight: "800" }}>Book Your Cleaning Service</h1>
          <p style={{ color: "#8899AA", fontSize: "14px" }}>Instant pricing and booking in under 60 seconds</p>
        </div>
        <BookingWidget />
      </div>
    );
  }

  const NAV_GROUPS = [
    { id:"ops",      label:"⚙️ Operations", color: C.accent, tabs:[
      { id:"dashboard",  label:"📊 Dashboard",    desc:"Overview & today's jobs" },
      { id:"jobs",       label:"📋 Jobs",          desc:"All jobs & work orders" },
      { id:"recurring",  label:"🔄 Recurring",     desc:"Recurring job schedules" },
      { id:"gps",        label:"📍 GPS",           desc:"Check-in / check-out" },
    ]},
    { id:"quotes",   label:"💬 Quotes", color: C.gold, tabs:[
      { id:"res",        label:"🏠 Residential",   desc:"Leads, quotes & booking" },
      { id:"com",        label:"🏢 Commercial",    desc:"Commercial proposals" },
    ]},
    { id:"finance",  label:"💰 Finance", color: "#FF6B6B", tabs:[
      { id:"pay",        label:"💰 Partner Pay",   desc:"Pay tracking & history" },
      { id:"stripe",     label:"💳 Payments",      desc:"Client payments" },
    ]},
    { id:"team",     label:"👥 Team", color: C.gold, tabs:[
      { id:"partners",    label:"👥 Partners",       desc:"Partner profiles & availability" },
    ]},
  ];

  const activeGroup = NAV_GROUPS.find(g => g.tabs.some(t => t.id === tab)) || NAV_GROUPS[0];

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div style={S.logo}>
          <div style={S.logoMark}>{BRAND.logoMark}</div>
          <span style={{ fontWeight: 800 }}>{BRAND.name}</span>
        </div>
      </header>

      {/* Primary Nav Category Pills */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 16px", display:"flex", gap:4, overflowX:"auto" }}>
        {NAV_GROUPS.map(g => {
          const isActive = g.id === activeGroup.id;
          return (
            <button
              key={g.id}
              onClick={() => setTab(g.tabs[0].id)}
              style={{
                padding: "10px 16px", background: "none", border: "none",
                borderBottom: isActive ? `3px solid ${g.color}` : "3px solid transparent",
                color: isActive ? g.color : C.muted, fontWeight: isActive ? 800 : 600,
                fontSize: 13, cursor: "pointer", whiteSpace: "nowrap"
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Sub-Tabs */}
      <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: "6px 16px", display:"flex", gap:4, overflowX:"auto" }}>
        {activeGroup.tabs.map(t => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px",
                background: isActive ? `${activeGroup.color}22` : "transparent",
                border: `1px solid ${isActive ? activeGroup.color+"55" : "transparent"}`,
                borderRadius: 8, color: isActive ? activeGroup.color : C.muted,
                fontWeight: isActive ? 700 : 500, fontSize: 13, cursor: "pointer"
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <main style={S.main}>
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={S.h2}>Good morning! 👋</h2>
              <p style={{ color: C.muted, fontSize: 14 }}>Here is your operational summary for today.</p>
            </div>
            <div style={S.grid4}>
              <StatCard label="Jobs Today" value={jobs.length} icon="📅" color={C.accent} />
              <StatCard label="Active Partners" value={partners.length} icon="👥" color={C.blue} />
              <StatCard label="Revenue" value="$530" icon="💵" color={C.gold} />
              <StatCard label="Gross Profit" value="$185" icon="📈" color={C.purple} />
            </div>
          </div>
        )}

        {tab === "jobs" && (
          <div style={S.card}>
            <div style={S.h2}>📋 Jobs</div>
            {jobs.map(j => (
              <div key={j.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontWeight: 800 }}>{j.client}</div>
                <div style={{ fontSize: 13, color: C.muted }}>{j.type} · {j.date} at {j.time}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "res" && (
          <div style={S.card}>
            <div style={S.h2}>🏠 Residential Quotes & Leads</div>
            <p style={{ color: C.muted }}>Manage residential quotes and create new client estimates.</p>
          </div>
        )}

        {tab === "partners" && (
          <div style={S.card}>
            <div style={S.h2}>👥 Partners</div>
            {partners.map(p => (
              <div key={p.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontWeight: 700 }}>{p.name} ({p.avatar})</div>
                <div style={{ fontSize: 13, color: C.muted }}>Pay rate: ${p.payRate}/hr · Status: {p.status}</div>
              </div>
            ))}
          </div>
        )}
      </main>

      {isMobile && <MobileBottomNav activeTab={tab} onTabChange={setTab} />}
    </div>
  );
}
