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

// ─── WORK ORDER GENERATOR ─────────────────────────────────────────────────────
function generateWorkOrder(job, lead, partner) {
  const addonTasks = (lead?.addons || job.upsells || []).map(id => {
    const ao = RES_ADDONS.find(x => x.id === id);
    const label = ao?.label || id;
    const tasks = {
      "Inside Fridge":          "Empty fridge contents → wipe all shelves and drawers with green rag → clean door seals → replace contents",
      "Inside Oven":            "Remove oven racks → spray oven cleaner → let soak 10 min → scrub interior with green rag → wipe clean → replace racks",
      "Inside Cabinets":        "Empty cabinet → wipe all interior surfaces with blue rag → clean door interiors → replace items neatly",
      "Interior Windows":       "Blue damp rag on glass → buff dry immediately with dry blue rag → wipe sills and frames",
      "Baseboards / Detail":    "Dry blue rag along all baseboards → damp follow-up on sticky buildup → check corners",
      "Carpet Cleaning":        "Pre-treat stains → steam clean per carpet type → allow dry time before walking on",
      "Pet Hair / Heavy Detail":"Use rubber gloves or lint roller on upholstery → vacuum twice with pet attachment → deodorise if needed",
    };
    return { label, instruction: tasks[label] || `Complete ${label} as per standard procedure` };
  });

  const roomChecklist = {
    "Refresh Clean":           ["Kitchen: surfaces, sink, appliance exteriors","Bathroom: toilet, sink, mirror, floor","Living areas: dust and vacuum","Floors: vacuum then mop"],
    "Full Home Clean":         ["Kitchen: deep counters, sink, stovetop, appliances","All bathrooms: full clean incl. shower/tub","All rooms: dust, wipe, vacuum","Floors throughout: vacuum then mop"],
    "Deep Clean":              ["Kitchen: inside microwave, stovetop detail, cabinets exterior","All bathrooms: grout scrub, fixtures polish","Baseboards throughout","All surfaces: detailed wipe-down","Floors: vacuum and mop"],
    "Move-In / Move-Out":      ["Full empty-unit clean","Inside all cabinets and drawers","Inside appliances (oven, fridge if selected)","All surfaces, fixtures, floors","Check and clean inside closets"],
    "Kitchen & Bathroom Refresh":["Kitchen: counters, sink, cabinet exteriors, appliance wipe-down","Bathroom: full clean incl. toilet, sink, shower/tub, mirror","Both room floors"],
  };

  const ragReminder = "🎨 RAG SYSTEM: 🔴 Red = Toilets ONLY · 🟡 Yellow = Sinks/Mirrors · 🟢 Green = Kitchen Surfaces · 🔵 Blue = General/Glass";

  return {
    id: `WO-${job.id}`,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    client: job.client,
    address: job.address,
    date: job.date,
    time: job.time,
    serviceType: job.type,
    hours: job.hours,
    partnerName: partner?.name || "Unassigned",
    partnerPhone: partner?.phone || "",
    clientNotes: lead?.notes || job.notes || "",
    addons: addonTasks,
    checklist: roomChecklist[job.type] || roomChecklist["Full Home Clean"],
    ragReminder,
    accessNotes: lead?.notes?.toLowerCase().includes("code") || lead?.notes?.toLowerCase().includes("access") ? lead.notes : "",
    petNotes: lead?.notes?.toLowerCase().includes("dog") || lead?.notes?.toLowerCase().includes("cat") || lead?.notes?.toLowerCase().includes("pet") ? lead.notes : "",
    status: "pending",
  };
}

// ─── SERVICE PACKAGES ─────────────────────────────────────────────────────────
const HUC_PACKAGES = {
  "Refresh Clean": {
    best_for: "Regular upkeep / recurring maintenance", range: { min: 140, max: 300 }, multiplier: 1.0,
    includes: ["Vacuum", "Mop", "Dusting", "Kitchen surfaces", "Bathroom wipe-down", "General reset"], icon: "✨",
  },
  "Full Home Clean": {
    best_for: "One-time or occasional whole-home clean", range: { min: 180, max: 400 }, multiplier: 1.35,
    includes: ["Everything in Refresh Clean", "More detailed kitchens", "More detailed bathrooms", "Surface wipe-downs"], icon: "🏠",
  },
  "Deep Clean": {
    best_for: "First-time cleans / heavier buildup", range: { min: 250, max: 700 }, multiplier: 1.8,
    includes: ["Everything in Full Home Clean", "Baseboards", "Detailed scrubbing", "Buildup removal", "Extra detail time"], icon: "🔍",
  },
  "Move-In / Move-Out": {
    best_for: "Turnover / empty-unit cleaning", range: { min: 300, max: 600 }, multiplier: 1.9,
    includes: ["Empty property clean", "Inside cabinets if empty", "Full kitchen and bathroom detail", "Floors and surfaces"], icon: "📦",
  },
  "Kitchen & Bathroom Refresh": {
    best_for: "Fast, targeted clean / entry offer", range: { min: 120, max: 200 }, multiplier: 0.75,
    includes: ["Kitchen counters", "Sink", "Cabinet exteriors", "Appliance wipe-down", "Bathroom full clean", "Floors cleaned"], icon: "🚿",
  },
};

const HUC_PRICING_GRID = {
  "Apartment / Condo": {
    "1 Bed": { "One-Time": [140,180], "Weekly": [120,150], "Bi-Weekly": [130,165], "Monthly": [140,180] },
    "2 Bed": { "One-Time": [160,220], "Weekly": [140,180], "Bi-Weekly": [150,200], "Monthly": [160,220] },
    "3 Bed": { "One-Time": [200,260], "Weekly": [170,220], "Bi-Weekly": [180,240], "Monthly": [200,260] },
  },
  "Semi / Townhouse": {
    "Small":  { "One-Time": [160,220], "Weekly": [140,190], "Bi-Weekly": [150,200], "Monthly": [160,220] },
    "Medium": { "One-Time": [200,260], "Weekly": [170,220], "Bi-Weekly": [180,240], "Monthly": [200,260] },
    "Large":  { "One-Time": [240,320], "Weekly": [200,270], "Bi-Weekly": [220,290], "Monthly": [240,320] },
  },
  "Detached House": {
    "Small":  { "One-Time": [180,240], "Weekly": [150,200], "Bi-Weekly": [160,220], "Monthly": [180,240] },
    "Medium": { "One-Time": [220,320], "Weekly": [180,260], "Bi-Weekly": [200,280], "Monthly": [220,320] },
    "Large":  { "One-Time": [300,400], "Weekly": [250,340], "Bi-Weekly": [270,360], "Monthly": [300,400] },
  },
  "Kitchen & Bathroom Only": {
    "Any Size": { "One-Time": [120,200], "Weekly": [100,160], "Bi-Weekly": [110,170], "Monthly": [120,200] },
  },
};

const HUC_ADDONS = [
  { id:"fridge",   label:"Inside Fridge",         priceRange:[40,60],  costToUs:25, icon:"🧊" },
  { id:"oven",     label:"Inside Oven",            priceRange:[40,70],  costToUs:28, icon:"🔥" },
  { id:"cabinets", label:"Inside Cabinets",        priceRange:[40,80],  costToUs:28, icon:"🗄" },
  { id:"windows",  label:"Interior Windows",       priceRange:[5,10],   costToUs:4,  icon:"🪟", perUnit:true, unit:"per window" },
  { id:"baseboards",label:"Baseboards / Detail",   priceRange:[40,80],  costToUs:28, icon:"📐" },
  { id:"carpet",   label:"Carpet Cleaning",        priceRange:[60,120], costToUs:45, icon:"🛋" },
  { id:"pethair",  label:"Pet Hair / Heavy Detail",priceRange:[40,80],  costToUs:28, icon:"🐾" },
];

const HUC_STATUSES = ["New", "Quoted", "Follow Up", "Booked", "Completed", "Lost"];

const REGIONS = {
  "ON": {
    id: "ON", country: "CA", flag: "🇨🇦", label: "Ontario, Canada", currency: "CAD", currencySymbol: "CA$", locale: "en-CA",
    tax: { name: "HST", rate: 0.13 }, partnerPayRange: { min: 25, mid: 30, max: 40 }, partnerCostPerHour: 30,
    residential: { standardPerHour: { min: 35, max: 60 }, flatRateSmall: { min: 150, max: 300 }, flatRateLarge: { min: 300, max: 500 }, deepClean: { min: 200, max: 500 }, moveOut: { min: 250, max: 600 } },
    commercial: { perHour: { min: 30, max: 60 }, perSqFt: { min: 0.10, max: 0.20 } },
    compliance: [{ item: "HST Registration (CRA)", required: ">$30k revenue", status: "required", link: "canada.ca" }],
    invoiceRequirements: ["Business legal name & address", "HST Registration Number", "Date of service", "Description of services", "Total amount including HST"],
    phoneFormat: "(xxx) xxx-xxxx", addressFormat: "Street, City, ON, Postal Code", payrollPeriod: "bi-weekly", dateFormat: "YYYY-MM-DD",
  },
  "AZ": {
    id: "AZ", country: "US", flag: "🇺🇸", label: "Arizona, USA", currency: "USD", currencySymbol: "$", locale: "en-US",
    tax: { name: "TPT", rate: 0.0 }, partnerPayRange: { min: 22, max: 32 }, partnerCostPerHour: 25,
    residential: { standardPerHour: { min: 25, max: 50 }, flatRateSmall: { min: 100, max: 200 }, flatRateLarge: { min: 200, max: 400 }, deepClean: { min: 150, max: 350 }, moveOut: { min: 180, max: 450 } },
    commercial: { perHour: { min: 20, max: 45 }, perSqFt: { min: 0.07, max: 0.15 } },
    compliance: [{ item: "Arizona TPT License", required: "All businesses", status: "required", link: "aztaxes.gov" }],
    invoiceRequirements: ["Business legal name & address", "Invoice number", "Date of service", "Subtotal", "Total amount due"],
    phoneFormat: "(xxx) xxx-xxxx", addressFormat: "Street, City, AZ XXXXX", payrollPeriod: "weekly or bi-weekly", dateFormat: "MM/DD/YYYY",
  },
};

let ACTIVE_REGION = REGIONS["ON"];

const fmt = (amount, region = ACTIVE_REGION) =>
  new Intl.NumberFormat(region.locale, { style:"currency", currency:region.currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(amount);

const fmtC = (amount, region = ACTIVE_REGION) =>
  new Intl.NumberFormat(region.locale, { style:"currency", currency:region.currency, minimumFractionDigits:0, maximumFractionDigits:0 }).format(amount);

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0F1E", surface: "#111827", card: "#1A2235", border: "#1E2D45",
  accent: "#00D4AA", accentDim: "#00D4AA22", gold: "#FFB800", goldDim: "#FFB80022",
  red: "#FF4757", redDim: "#FF475722", blue: "#3B82F6", blueDim: "#3B82F622",
  purple: "#A78BFA", purpleDim: "#A78BFA22",
  text: "#F0F6FF", muted: "#8899AA", dim: "#445566",
};

const HUC_STATUS_COLOR = {
  "New": C.blue, "Quoted": C.gold, "Follow Up": "#FF6B6B",
  "Booked": C.accent, "Completed": C.accent, "Lost": C.dim,
};

const PARTNER_SHARE = 0.65;
const COMPANY_SHARE = 0.35;
const PROFIT_MARGIN = 0.35;

const partnerPayFromPrice  = (clientPrice) => Math.round(clientPrice * PARTNER_SHARE);
const companyProfitFromPrice = (clientPrice) => Math.round(clientPrice * COMPANY_SHARE);
const markupFactor = (cost) => Math.ceil(cost / (1 - PROFIT_MARGIN));

const getTeamSize = (sqft) => {
  if (!sqft || sqft <= 1000) return 1;
  if (sqft <= 3000) return 2;
  return 3;
};

const getJobHours = (sqft) => {
  const raw = Math.max(1.5, (sqft || 900) / 1000);
  return Math.round(raw * 2) / 2;
};

const PARTNER_HOURLY_ON = 30;
const PARTNER_HOURLY_AZ = 25;

const FLOOR_PRICES = {
  ON: {
    "Apartment / Condo": { "1 Bed":140, "2 Bed":165, "3 Bed":205 },
    "Semi / Townhouse":  { "Small":165, "Medium":205, "Large":245 },
    "Detached House":    { "Small":185, "Medium":230, "Large":310 },
  },
  AZ: {
    "Apartment / Condo": { "1 Bed":155, "2 Bed":185, "3 Bed":230 },
    "Semi / Townhouse":  { "Small":185, "Medium":230, "Large":275 },
    "Detached House":    { "Small":205, "Medium":255, "Large":345 },
  },
};

const RES_SERVICE_MULT = {
  "Refresh Clean":             1.00,
  "Full Home Clean":           1.25,
  "Deep Clean":                1.65,
  "Move-In / Move-Out":        1.80,
  "Kitchen & Bathroom Refresh":0.65,
  "Pre-Sale Clean":            1.50,
  "Post-Renovation Clean":     1.70,
};

const CONDITION_MULT = { "Light": 0.90, "Average": 1.00, "Heavy": 1.20, "": 1.00 };
const FREQ_DISCOUNTS = { "One-Time": 0, "Weekly": 0.15, "Bi-Weekly": 0.10, "Monthly": 0.05 };

const RES_ADDONS = [
  { id:"fridge",    label:"Inside Fridge",         clientPrice:50,  costToUs:20 },
  { id:"oven",      label:"Inside Oven",            clientPrice:55,  costToUs:22 },
  { id:"cabinets",  label:"Inside Cabinets",        clientPrice:65,  costToUs:26 },
  { id:"windows",   label:"Interior Windows",       clientPrice:60,  costToUs:24 },
  { id:"baseboards",label:"Baseboards / Detail",    clientPrice:55,  costToUs:22 },
  { id:"carpet",    label:"Carpet Cleaning",        clientPrice:95,  costToUs:38 },
  { id:"pethair",   label:"Pet Hair / Heavy Detail",clientPrice:65,  costToUs:26 },
];

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const JOB_TYPES = ["Refresh Clean","Full Home Clean","Deep Clean","Move-In / Move-Out","Kitchen & Bathroom Refresh","Post-Construction"];
const UPSELL_OPTIONS = ["Inside Fridge","Inside Oven","Inside Cabinets","Interior Windows","Baseboards / Detail","Carpet Cleaning","Pet Hair / Heavy Detail"];
const avatarColors = ["linear-gradient(135deg,#00D4AA,#0088FF)","linear-gradient(135deg,#FF6B6B,#FF8E53)","linear-gradient(135deg,#A78BFA,#EC4899)","linear-gradient(135deg,#FFB800,#FF6B6B)"];

const initPartners = [
  { id:1, name:"Maria Santos",  phone:"(416) 555-0101", email:"maria@haveusclean.com",  status:"active",    rating:4.9, jobsDone:47, payRate:26, availability:["Mon","Tue","Wed","Thu","Fri"], onboarded:true,  avatar:"MS", region:"ON" },
  { id:2, name:"James Cole",    phone:"(480) 555-0102", email:"james@haveusclean.com",  status:"active",    rating:4.7, jobsDone:31, payRate:22, availability:["Mon","Wed","Fri","Sat"],       onboarded:true,  avatar:"JC", region:"AZ" },
  { id:3, name:"Tanya Brooks",  phone:"(416) 555-0103", email:"tanya@haveusclean.com",  status:"available", rating:4.8, jobsDone:22, payRate:24, availability:["Tue","Thu","Sat","Sun"],       onboarded:true,  avatar:"TB", region:"ON" },
];

const TODAY_DATE = new Date().toISOString().split("T")[0];

const initJobs = [
  { id:1, client:"Sarah M. — 2BR Condo",        email:"sarah.m@email.com", address:"88 Maple Dr, North York ON",       type:"Full Home Clean",    date:TODAY_DATE,  time:"9:00 AM",  partnerId:1, partnerIds:[1], status:"scheduled",  hours:3, upsells:["Inside Oven","Inside Fridge"], beforePics:[], afterPics:[], summary:"", clientPrice:210, partnerPay:137, profit:73,  checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:"Bi-Weekly", nextDate:null, region:"ON" },
  { id:2, client:"The Thompson House",           email:"thompson@email.com", address:"55 Birchwood Ave, Scottsdale AZ",  type:"Deep Clean",         date:TODAY_DATE,  time:"1:00 PM",  partnerId:2, partnerIds:[2], status:"in-progress", hours:4, upsells:["Baseboards / Detail"],         beforePics:[], afterPics:[], summary:"", clientPrice:320, partnerPay:208, profit:112, checkIn:"1:03 PM", checkOut:null, checkInCoords:{lat:33.4484,lng:-112.0740}, checkOutCoords:null, recurring:"One-Time", nextDate:null, region:"AZ" },
];

const S = {
  app: { minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:C.text, display:"flex", flexDirection:"column" },
  header: { background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:200 },
  logo: { display:"flex", alignItems:"center", gap:10, fontWeight:800, fontSize:17, letterSpacing:"-0.5px", flexShrink:0 },
  logoMark: { width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 },
  main: { flex:1, padding:"20px 16px", maxWidth:960, width:"100%", margin:"0 auto", boxSizing:"border-box" },
  card: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:18 },
  cardSm: { background:C.card, borderRadius:10, border:`1px solid ${C.border}`, padding:12 },
  label: { fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:C.muted, marginBottom:5 },
  h2: { fontSize:20, fontWeight:800, marginBottom:16, letterSpacing:"-0.3px" },
  h3: { fontSize:15, fontWeight:700, marginBottom:10 },
  badge: (color) => ({ display:"inline-block", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:color==="green"?C.accentDim:color==="gold"?C.goldDim:color==="red"?C.redDim:color==="purple"?C.purpleDim:C.blueDim, color:color==="green"?C.accent:color==="gold"?C.gold:color==="red"?C.red:color==="purple"?C.purple:C.blue }),
  input: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box" },
  select: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box", cursor:"pointer" },
  btn: (v="primary") => ({ padding:v==="sm"?"8px 14px":"11px 20px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:v==="sm"?13:14, background:v==="primary"?C.accent:C.card, color:v==="primary"?"#0A0F1E":C.muted, border:"none" }),
  avatar: (color) => ({ width:36, height:36, borderRadius:"50%", background:color||`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#fff", flexShrink:0 }),
  divider: { height:1, background:C.border, margin:"16px 0" },
  statCard: (color) => ({ background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:"15px 16px", borderLeft:`3px solid ${color}` }),
  grid2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))", gap:14 },
  grid3: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,180px),1fr))", gap:12 },
  grid4: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,140px),1fr))", gap:10 },
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

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:999, display:"flex", alignItems:"flex-start", justifyContent:"center", overflowY:"auto", padding:"16px 12px" }}
      onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 18px", width:"100%", maxWidth: wide ? 720 : 520, margin:"auto", boxSizing:"border-box" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:16, fontWeight:800 }}>{title}</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, fontSize:24, cursor:"pointer" }}>×</button>
        </div>
        {children}
      </div>
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
