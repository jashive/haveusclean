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
];

const TODAY_DATE = new Date().toISOString().split("T")[0];

const initJobs = [
  { id:1, client:"Sarah M. — 2BR Condo", email:"sarah.m@email.com", address:"88 Maple Dr, North York ON", type:"Full Home Clean", date:TODAY_DATE, time:"9:00 AM", partnerId:1, partnerIds:[1], status:"scheduled", hours:3, upsells:["Inside Oven","Inside Fridge"], beforePics:[], afterPics:[], summary:"", clientPrice:210, partnerPay:137, profit:73, checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:"Bi-Weekly", nextDate:null, region:"ON" },
];

const S = {
  app: { minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:C.text, display:"flex", flexDirection:"column" },
  header: { background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:200 },
  logo: { display:"flex", alignItems:"center", gap:10, fontWeight:800, fontSize:17, letterSpacing:"-0.5px", flexShrink:0 },
  logoMark: { width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 },
  main: { flex:1, padding:"20px 16px", maxWidth:960, width:"100%", margin:"0 auto", boxSizing:"border-box" },
  card: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:18 },
  h2: { fontSize:20, fontWeight:800, marginBottom:16, letterSpacing:"-0.3px" },
  btn: (v="primary") => ({ padding:v==="sm"?"8px 14px":"11px 20px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:v==="sm"?13:14, background:v==="primary"?C.accent:C.card, color:v==="primary"?"#0A0F1E":C.muted, border:"none" }),
};

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

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div style={S.logo}>
          <div style={S.logoMark}>{BRAND.logoMark}</div>
          <span>{BRAND.name}</span>
        </div>
      </header>

      <main style={S.main}>
        <div style={S.card}>
          <div style={S.h2}>📊 Dashboard</div>
          <p style={{ color: C.muted }}>Welcome back to {BRAND.name}. App restored successfully.</p>
        </div>
      </main>

      {isMobile && <MobileBottomNav activeTab={tab} onTabChange={setTab} />}
    </div>
  );
}
