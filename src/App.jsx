// ─── HAVE US CLEAN v4.0 ── Operating System ──────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import ConfirmDrawer from "./components/ConfirmDrawer";
import MobileBottomNav, { useMobileNav, MOBILE_NAV_HEIGHT } from "./components/MobileBottomNav";
import MySchedule from "./pages/MySchedule";
import StatusBadge from "./components/StatusBadge";
import { getSmartViewCounts, getAllSmartViews } from "./features/views/smartViews";
import { filterLeads } from "./features/leads/leadUtils";
import { filterJobs, getJobPartners } from "./features/jobs/jobUtils";

// Import new components
import BookingWidget from "./components/BookingWidget";
import CrewJobView from "./components/CrewJobView";
import RoutePlanner from "./components/RoutePlanner";

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

// ... keep existing helper functions, constants, REGIONS, and components unchanged ...

// ─── MAIN APP COMPONENT ────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const isMobile = useMobileNav();
  const [jobs, setJobs] = useState(initJobs);
  const [partners, setPartners] = useState(initPartners);
  const [activeRegion, setActiveRegion] = useState(REGIONS["ON"]);
  const [resLeads, setResLeads] = useState([]);
  const [coldLeads, setColdLeads] = useState([]);
  const [coldPage, setColdPage] = useState(0);
  const [coldFilterMkt, setColdFilterMkt] = useState("All");
  const [deletedLeadIds, setDeletedLeadIds] = useState(() => {
    try {
      const saved = localStorage.getItem("cp:deletedLeadIds");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // Simple client-side path router for stand-alone routes (/book & /crew)
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";

  // Dedicated Route: Public Booking Widget (/book)
  if (currentPath === "/book") {
    return (
      <div style={{ minHeight: "100vh", background: "#0A0F1E", padding: "40px 16px" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <h1 style={{ color: "#fff", fontSize: "28px", fontWeight: "800" }}>Book Your Cleaning Service</h1>
          <p style={{ color: "#8899AA", fontSize: "14px" }}>Instant pricing and booking in under 60 seconds</p>
        </div>
        <BookingWidget onBookingSubmit={async (data) => {
          try {
            const res = await fetch("/api/bookings/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            const result = await res.json();
            if (result.success) alert("🎉 Booking confirmed! Thank you for choosing Have Us Clean.");
            else alert("Error submitting booking: " + result.error);
          } catch (err) {
            console.error("Booking error:", err);
          }
        }} />
      </div>
    );
  }

  // Dedicated Route: Field Crew View (/crew)
  if (currentPath === "/crew") {
    return <CrewJobView job={jobs[0]} />;
  }

  // NAV GROUPS
  const NAV_GROUPS = [
    { id:"ops",      label:"⚙️ Operations", color: C.accent, tabs:[
      { id:"dashboard",  label:"📊 Dashboard",    desc:"Overview & today's jobs" },
      { id:"ops_mgr",    label:"🧠 Ops Manager",  desc:"AI daily operations overview" },
      { id:"jobs",       label:"📋 Jobs",          desc:"All jobs & work orders" },
      { id:"recurring",  label:"🔄 Recurring",     desc:"Recurring job schedules" },
      { id:"gps",        label:"📍 GPS",           desc:"Check-in / check-out" },
      { id:"geo",        label:"🛡️ Geofence",     desc:"Location compliance" },
      { id:"routes",     label:"📍 Route Planner", desc:"Smart dispatch & density planner" },
    ]},
    { id:"quotes",   label:"💬 Quotes", color: C.gold, tabs:[
      { id:"res",        label:"🏠 Residential",   desc:"Leads, quotes & booking" },
      { id:"com",        label:"🏢 Commercial",    desc:"Commercial proposals" },
      { id:"cold",       label:"🎯 Cold Outreach",  desc:"AI-generated cold leads pipeline" },
      { id:"intake",     label:"📋 Form Intake",    desc:"Google Form → New leads auto-flow" },
    ]},
    { id:"agents",   label:"🤖 AI Agents", color: "#A78BFA", tabs:[
      { id:"agent_quote",    label:"💬 VA Quote",      desc:"Generate quotes with AI" },
      { id:"agent_bidspec",  label:"📄 Bid Spec",      desc:"Customer-facing summaries" },
      { id:"agent_workorder",label:"🔧 Work Order",    desc:"Cleaner-facing checklists" },
      { id:"agent_social",   label:"📱 Social Content",desc:"Lead-gen content generator" },
      { id:"agent_dm",       label:"💌 DM Conversion", desc:"Inbox lead qualification" },
      { id:"agent_ops",      label:"📊 Ops Manager",   desc:"Daily pipeline briefing" },
    ]},
    { id:"finance",  label:"💰 Finance", color: "#FF6B6B", tabs:[
      { id:"pay",        label:"💰 Partner Pay",   desc:"Pay tracking & history" },
      { id:"stripe",     label:"💳 Payments",      desc:"Client payments (Stripe)" },
      { id:"qb",         label:"💚 QuickBooks",    desc:"Accounting sync" },
    ]},
    { id:"clients",  label:"🌐 Clients", color: C.blue, tabs:[
      { id:"portal",      label:"🌐 Client Portal",  desc:"Quotes, invoices & reviews" },
      { id:"clientview",  label:"📲 Client View",    desc:"What your clients see" },
      { id:"followup",    label:"🔔 Follow-Ups",     desc:"Automated reminder system" },
      { id:"sms",         label:"📱 SMS Reminders",  desc:"Automated messaging" },
      { id:"marketing",   label:"📣 Marketing",      desc:"30-day content system" },
    ]},
    { id:"team",     label:"👥 Team", color: C.gold, tabs:[
      { id:"partners",    label:"👥 Partners",       desc:"Partner profiles & availability" },
      { id:"partnerview", label:"📋 Partner View",   desc:"What your partners see" },
      { id:"onboarding",  label:"🎓 Onboarding",     desc:"Training & certification" },
      { id:"ai",          label:"🗓️ AI Scheduling",  desc:"AI-powered schedule optimizer" },
    ]},
    { id:"biz",      label:"📊 Business", color: C.muted, tabs:[
      { id:"tax",        label: activeRegion.id==="ON" ? "🇨🇦 HST / Tax" : "🇺🇸 TPT / Tax", desc:"Tax rules & compliance" },
      { id:"db",         label:"🗄️ Database",     desc:"Data management & backup" },
      { id:"whitelabel", label:"🏷️ App Store",    desc:"Licensing & white-label" },
      { id:"pricing",    label:"💰 Pricing",       desc:"Subscription tiers" },
      { id:"swot",       label:"📊 SWOT",          desc:"Competitive analysis" },
      { id:"diagnostic", label:"🔬 Diagnostic",     desc:"System health check" },
      { id:"schedule",   label:"📅 My Schedule",    desc:"Today's jobs for field team" },
    ]},
  ];

  const activeGroup = NAV_GROUPS.find(g => g.tabs.some(t => t.id === tab)) || NAV_GROUPS[0];

  return (
    <div style={S.app}>
      <header style={{ ...S.header, flexShrink: 0 }}>
        <div style={S.logo}>
          <div style={S.logoMark}>{BRAND.logoMark}</div>
          <span style={{ display:"flex", flexDirection:"column", lineHeight:1.1 }}>
            <span>{BRAND.name}</span>
            <span style={{ fontSize:9, color:C.muted, fontWeight:600, letterSpacing:"0.05em" }}>v{BRAND.version}</span>
          </span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, justifyContent:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:14 }}>{activeRegion.flag}</span>
          <span style={{ color: activeRegion.id==="ON" ? "#FF6B6B" : C.blue, fontWeight:700, fontSize:13 }}>{activeRegion.label}</span>
          <span style={{ color:C.dim, fontSize:12 }}>·</span>
          <span style={{ color:C.muted, fontSize:12 }}>{activeRegion.id==="ON" ? "CAD · 13% HST" : "USD · Services Tax-Exempt"}</span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <RegionSwitcher activeRegion={activeRegion} setActiveRegion={setActiveRegion} />
        </div>
      </header>

      {/* Main Tab Render */}
      <main style={{ ...S.main, paddingBottom: isMobile ? MOBILE_NAV_HEIGHT + 16 : undefined }}>
        {tab==="dashboard"      && <DashboardV2      jobs={jobs}            partners={partners} region={activeRegion} setTab={setTab} />}
        {tab==="routes"         && <RoutePlanner />}
        {/* Render all other tabs... */}
      </main>
    </div>
  );
}
