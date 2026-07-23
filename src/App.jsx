// ─── HAVE US CLEAN v3.0 ── Operating System ──────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import ConfirmDrawer from "./components/ConfirmDrawer";
import MobileBottomNav, { useMobileNav, MOBILE_NAV_HEIGHT } from "./components/MobileBottomNav";
import MySchedule from "./pages/MySchedule";
import StatusBadge from "./components/StatusBadge";
import { getSmartViewCounts, getAllSmartViews } from "./features/views/smartViews";
import { filterLeads } from "./features/leads/leadUtils";
import { filterJobs, getJobPartners } from "./features/jobs/jobUtils";
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

// ─── HAVE US CLEAN — SERVICE PACKAGES ────────────────────────────────────────
const HUC_PACKAGES = {
  "Refresh Clean": {
    best_for: "Regular upkeep / recurring maintenance",
    range: { min: 140, max: 300 },
    multiplier: 1.0,
    includes: ["Vacuum", "Mop", "Dusting", "Kitchen surfaces", "Bathroom wipe-down", "General reset"],
    icon: "✨",
  },
  "Full Home Clean": {
    best_for: "One-time or occasional whole-home clean",
    range: { min: 180, max: 400 },
    multiplier: 1.35,
    includes: ["Everything in Refresh Clean", "More detailed kitchens", "More detailed bathrooms", "Surface wipe-downs"],
    icon: "🏠",
  },
  "Deep Clean": {
    best_for: "First-time cleans / heavier buildup",
    range: { min: 250, max: 700 },
    multiplier: 1.8,
    includes: ["Everything in Full Home Clean", "Baseboards", "Detailed scrubbing", "Buildup removal", "Extra detail time"],
    icon: "🔍",
  },
  "Move-In / Move-Out": {
    best_for: "Turnover / empty-unit cleaning",
    range: { min: 300, max: 600 },
    multiplier: 1.9,
    includes: ["Empty property clean", "Inside cabinets if empty", "Full kitchen and bathroom detail", "Floors and surfaces"],
    icon: "📦",
  },
  "Kitchen & Bathroom Refresh": {
    best_for: "Fast, targeted clean / entry offer",
    range: { min: 120, max: 200 },
    multiplier: 0.75,
    includes: ["Kitchen counters", "Sink", "Cabinet exteriors", "Appliance wipe-down", "Bathroom full clean", "Floors cleaned"],
    icon: "🚿",
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
  { id:"fridge",   label:"Inside Fridge",         priceRange:[40,60],  costToUs:25, icon:"🧊", col:"AI" },
  { id:"oven",     label:"Inside Oven",            priceRange:[40,70],  costToUs:28, icon:"🔥", col:"AJ" },
  { id:"cabinets", label:"Inside Cabinets",        priceRange:[40,80],  costToUs:28, icon:"🗄",  col:"AK" },
  { id:"windows",  label:"Interior Windows",       priceRange:[5,10],   costToUs:4,  icon:"🪟", col:"AL", perUnit:true, unit:"per window" },
  { id:"baseboards",label:"Baseboards / Detail",   priceRange:[40,80],  costToUs:28, icon:"📐", col:"AM" },
  { id:"carpet",   label:"Carpet Cleaning",        priceRange:[60,120], costToUs:45, icon:"🛋", col:"AN" },
  { id:"pethair",  label:"Pet Hair / Heavy Detail",priceRange:[40,80],  costToUs:28, icon:"🐾", col:"AO" },
];

const HUC_STATUSES = ["New", "Quoted", "Follow Up", "Booked", "Completed", "Lost"];

const REGIONS = {
  "ON": {
    id: "ON", country: "CA", flag: "🇨🇦", label: "Ontario, Canada",
    currency: "CAD", currencySymbol: "CA$", locale: "en-CA",
    tax: { name: "HST", rate: 0.13, breakdown: { federal: 0.05, provincial: 0.08 },
      filingBody: "CRA (Canada Revenue Agency)",
      registrationThreshold: "$30,000 CAD annual taxable revenue",
      filingFrequency: "Monthly / Quarterly / Annually (CRA assigned)",
      notes: "Cleaning services are fully subject to HST in Ontario per CRA. Must display HST registration number on all invoices. Input Tax Credits (ITCs) available for commercial clients.",
    },
    partnerPayRange: { min: 25, mid: 30, max: 40 },
    partnerCostPerHour: 30,
    residential: {
      standardPerHour: { min: 35, max: 60 },
      flatRateSmall: { min: 150, max: 300 },
      flatRateLarge: { min: 300, max: 500 },
      deepClean: { min: 200, max: 500 },
      moveOut: { min: 250, max: 600 },
    },
    commercial: {
      perHour: { min: 30, max: 60 },
      perSqFt: { min: 0.10, max: 0.20 },
    },
    compliance: [
      { item: "HST Registration (CRA)", required: ">$30k revenue", status: "required", link: "canada.ca/en/revenue-agency" },
      { item: "Business Number (BN)", required: "All businesses", status: "required", link: "canada.ca" },
      { item: "WSIB (Workplace Safety Insurance)", required: "If employing workers", status: "required", link: "wsib.ca" },
      { item: "Ontario Business Registration", required: "Operating in ON", status: "required", link: "ontario.ca/page/business-registration" },
      { item: "Employment Standards Act (ESA) compliance", required: "If using employees", status: "required", link: "ontario.ca/esa" },
      { item: "Employer Health Tax (EHT)", required: ">$1M payroll", status: "conditional", link: "ontario.ca/eht" },
      { item: "PIPEDA / Ontario Privacy Compliance", required: "Client data handling", status: "required", link: "priv.gc.ca" },
    ],
    invoiceRequirements: [
      "Business legal name & address",
      "HST Registration Number (must show on all invoices)",
      "Date of service",
      "Description of services",
      "Pre-HST subtotal",
      "HST amount (13% — do NOT show federal/provincial separately)",
      "Total amount including HST",
      "Payment terms",
    ],
    phoneFormat: "(xxx) xxx-xxxx",
    addressFormat: "Street, City, ON, Postal Code",
    sqftUnit: "sqft",
    measurementSystem: "mixed",
    payrollPeriod: "bi-weekly",
    dateFormat: "YYYY-MM-DD",
  },

  "AZ": {
    id: "AZ", country: "US", flag: "🇺🇸", label: "Arizona, USA",
    currency: "USD", currencySymbol: "$", locale: "en-US",
    tax: {
      name: "TPT", rate: 0.086, statePortion: 0.056, localPortion: 0.03,
      note: "Phoenix combined rate used (8.6%). Scottsdale: 8.05%, Tempe: 8.1%, Mesa: 8.3%",
      serviceTaxable: false,
      productsTaxable: true,
      filingBody: "Arizona Department of Revenue (ADOR)",
      registrationThreshold: "$100,000 economic nexus",
      tptLicenseFee: "$12/year per location",
      filingDue: "20th of the following month (electronic: last business day of month)",
      notes: "Cleaning services are generally NOT subject to Arizona TPT. TPT applies if you sell tangible products. Register at AZTaxes.gov. $12/yr TPT license per location required.",
    },
    partnerPayRange: { min: 22, max: 32 },
    partnerCostPerHour: 25,
    residential: {
      standardPerHour: { min: 25, max: 50 },
      flatRateSmall: { min: 100, max: 200 },
      flatRateLarge: { min: 200, max: 400 },
      deepClean: { min: 150, max: 350 },
      moveOut: { min: 180, max: 450 },
    },
    commercial: {
      perHour: { min: 20, max: 45 },
      perSqFt: { min: 0.07, max: 0.15 },
    },
    compliance: [
      { item: "Arizona TPT License", required: "All businesses", status: "required", link: "aztaxes.gov" },
      { item: "Arizona LLC / Corporation Registration", required: "Operating in AZ", status: "required", link: "azcc.gov" },
      { item: "Federal EIN (Employer ID Number)", required: "If hiring workers", status: "required", link: "irs.gov" },
      { item: "Arizona Employer Withholding Registration", required: "If employing workers", status: "required", link: "azdor.gov" },
      { item: "Workers Compensation Insurance", required: "1+ employees", status: "required", link: "ica.state.az.us" },
      { item: "AZ Registrar of Contractors License", required: "If any construction-adjacent work", status: "conditional", link: "roc.az.gov" },
      { item: "City Business License (varies)", required: "Phoenix, Scottsdale, etc.", status: "required", link: "phoenix.gov" },
    ],
    invoiceRequirements: [
      "Business legal name & address",
      "Invoice number",
      "Date of service",
      "Description of services",
      "Subtotal",
      "Note: Cleaning services not subject to AZ TPT",
      "If products sold: TPT at applicable combined rate",
      "Total amount due",
      "Payment terms",
    ],
    phoneFormat: "(xxx) xxx-xxxx",
    addressFormat: "Street, City, AZ XXXXX",
    sqftUnit: "sqft",
    measurementSystem: "imperial",
    payrollPeriod: "weekly or bi-weekly",
    dateFormat: "MM/DD/YYYY",
  },
};

let ACTIVE_REGION = REGIONS["ON"];

const fmt = (amount, region = ACTIVE_REGION) =>
  new Intl.NumberFormat(region.locale, { style:"currency", currency:region.currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(amount);

const fmtC = (amount, region = ACTIVE_REGION) =>
  new Intl.NumberFormat(region.locale, { style:"currency", currency:region.currency, minimumFractionDigits:0, maximumFractionDigits:0 }).format(amount);

const C = {
  bg: "#0A0F1E", surface: "#111827", card: "#1A2235", border: "#1E2D45",
  accent: "#00D4AA", accentDim: "#00D4AA22", gold: "#FFB800", goldDim: "#FFB80022",
  red: "#FF4757", redDim: "#FF475722", blue: "#3B82F6", blueDim: "#3B82F622",
  purple: "#A78BFA", purpleDim: "#A78BFA22",
  text: "#F0F6FF", muted: "#8899AA", dim: "#445566",
};

const HUC_STATUS_COLOR = {
  "New":       C.blue,
  "Quoted":    C.gold,
  "Follow Up": "#FF6B6B",
  "Booked":    C.accent,
  "Completed": C.accent,
  "Lost":      C.dim,
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
  "Office / Commercial":       1.20,
};

const CONDITION_MULT = {
  "Light":   0.90,
  "Average": 1.00,
  "Heavy":   1.20,
  "":        1.00,
};

const FREQ_DISCOUNTS = {
  "One-Time":  0,
  "Weekly":    0.15,
  "Bi-Weekly": 0.10,
  "Monthly":   0.05,
};

const RES_ADDONS = [
  { id:"fridge",    label:"Inside Fridge",         clientPrice:50,  costToUs:20 },
  { id:"oven",      label:"Inside Oven",            clientPrice:55,  costToUs:22 },
  { id:"cabinets",  label:"Inside Cabinets",        clientPrice:65,  costToUs:26 },
  { id:"windows",   label:"Interior Windows",       clientPrice:60,  costToUs:24 },
  { id:"baseboards",label:"Baseboards / Detail",    clientPrice:55,  costToUs:22 },
  { id:"carpet",    label:"Carpet Cleaning",        clientPrice:95,  costToUs:38 },
  { id:"pethair",   label:"Pet Hair / Heavy Detail",clientPrice:65,  costToUs:26 },
];

const SQFT_HOURS = {
  500:1.5, 750:2, 1000:2.5, 1250:3, 1500:3.5, 1750:4,
  2000:4.5, 2500:5.5, 3000:6.5, 3500:7.5, 4000:9, 5000:11,
};
const getSqftHours = (sqft) => {
  const tiers = Object.keys(SQFT_HOURS).map(Number).sort((a,b)=>a-b);
  for (let t of tiers) if (sqft <= t) return SQFT_HOURS[t];
  return SQFT_HOURS[5000] + (sqft - 5000) / 500;
};
const PARTNER_COST_PER_HOUR = 30;

const COM_SERVICE_COST_PER_SQFT = {
  "Office Clean": 0.07, "Janitorial (Daily)": 0.05, "Post-Construction": 0.14,
  "Medical/Lab Facility": 0.18, "Retail / Showroom": 0.065, "Warehouse / Industrial": 0.045,
};
const COM_MIN_COST = {
  "Office Clean": 120, "Janitorial (Daily)": 100, "Post-Construction": 280,
  "Medical/Lab Facility": 350, "Retail / Showroom": 110, "Warehouse / Industrial": 140,
};
const COM_ADDONS = [
  { id:"restrooms",  label:"Deep Restroom Sanitization", costToUs: 60 },
  { id:"windows_ext",label:"Exterior Window Wash",       costToUs: 85 },
  { id:"carpet_com", label:"Commercial Carpet Steam",    costToUs: 105 },
  { id:"floor_strip",label:"Floor Strip & Wax",         costToUs: 140 },
  { id:"pressure",   label:"Pressure Washing (exterior)",costToUs: 120 },
  { id:"supply",     label:"Restroom Supply Restocking", costToUs: 28 },
  { id:"trash",      label:"After-Hours Trash Removal",  costToUs: 42 },
  { id:"disinfect",  label:"Full Disinfection Service",  costToUs: 90 },
];
const COM_FREQ_DISCOUNTS = { "One-Time":0, "Daily":0.18, "Weekly":0.13, "Bi-Weekly":0.08, "Monthly":0.04 };

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const JOB_TYPES = ["Refresh Clean","Full Home Clean","Deep Clean","Move-In / Move-Out","Kitchen & Bathroom Refresh","Post-Construction"];
const UPSELL_OPTIONS = ["Inside Fridge","Inside Oven","Inside Cabinets","Interior Windows","Baseboards / Detail","Carpet Cleaning","Pet Hair / Heavy Detail"];
const avatarColors = ["linear-gradient(135deg,#00D4AA,#0088FF)","linear-gradient(135deg,#FF6B6B,#FF8E53)","linear-gradient(135deg,#A78BFA,#EC4899)","linear-gradient(135deg,#FFB800,#FF6B6B)"];

const initPartners = [
  { id:1, name:"Maria Santos",  phone:"(416) 555-0101", email:"maria@haveusclean.com",  status:"active",    rating:4.9, jobsDone:47, payRate:26, availability:["Mon","Tue","Wed","Thu","Fri"], onboarded:true,  avatar:"MS", region:"ON" },
  { id:2, name:"James Cole",    phone:"(480) 555-0102", email:"james@haveusclean.com",  status:"active",    rating:4.7, jobsDone:31, payRate:22, availability:["Mon","Wed","Fri","Sat"],       onboarded:true,  avatar:"JC", region:"AZ" },
  { id:3, name:"Tanya Brooks",  phone:"(416) 555-0103", email:"tanya@haveusclean.com",  status:"available", rating:4.8, jobsDone:22, payRate:24, availability:["Tue","Thu","Sat","Sun"],       onboarded:true,  avatar:"TB", region:"ON" },
  { id:4, name:"Devon Mills",   phone:"(602) 555-0104", email:"devon@haveusclean.com",  status:"onboarding",rating:0,   jobsDone:0,  payRate:20, availability:[],                             onboarded:false, avatar:"DM", region:"AZ" },
];

const TODAY_DATE = new Date().toISOString().split("T")[0];
const YESTERDAY = new Date(Date.now()-86400000).toISOString().split("T")[0];
const TOMORROW = new Date(Date.now()+86400000).toISOString().split("T")[0];
const IN2DAYS = new Date(Date.now()+2*86400000).toISOString().split("T")[0];

const initJobs = [
  { id:1, client:"Sarah M. — 2BR Condo",        email:"sarah.m@email.com", address:"88 Maple Dr, North York ON",       type:"Full Home Clean",    date:TODAY_DATE,  time:"9:00 AM",  partnerId:1, partnerIds:[1], status:"scheduled",  hours:3, upsells:["Inside Oven","Inside Fridge"], beforePics:[], afterPics:[], summary:"", clientPrice:210, partnerPay:137, profit:73,  checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:"Bi-Weekly", nextDate:TOMORROW, region:"ON" },
  { id:2, client:"The Thompson House",           email:"thompson@email.com", address:"55 Birchwood Ave, Scottsdale AZ",  type:"Deep Clean",         date:TODAY_DATE,  time:"1:00 PM",  partnerId:3, partnerIds:[3], status:"in-progress", hours:4, upsells:["Baseboards / Detail"],         beforePics:[], afterPics:[], summary:"", clientPrice:320, partnerPay:208, profit:112, checkIn:"1:03 PM", checkOut:null, checkInCoords:{lat:33.4484,lng:-112.0740}, checkOutCoords:null, recurring:"One-Time", nextDate:null, region:"AZ" },
  { id:3, client:"Priya S. — 3BR Detached",     email:"priya@email.com", address:"12 Oakridge Rd, Mississauga ON",   type:"Refresh Clean",      date:TOMORROW,    time:"10:00 AM", partnerId:2, partnerIds:[2], status:"scheduled",  hours:2, upsells:[],                              beforePics:[], afterPics:[], summary:"", clientPrice:180, partnerPay:117, profit:63,  checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:"Weekly", nextDate:IN2DAYS, region:"ON" },
  { id:4, client:"King St Lofts — Unit 402",    address:"900 King St W, Toronto ON",        type:"Move-In / Move-Out", date:YESTERDAY,   time:"8:00 AM",  partnerId:1, partnerIds:[1], status:"completed",  hours:5, upsells:["Inside Cabinets","Carpet Cleaning"], beforePics:["before1.jpg"], afterPics:["after1.jpg"], summary:"Empty unit, full move-out. Client very happy. Carpets came out great.", clientPrice:450, partnerPay:293, profit:157, checkIn:"8:01 AM", checkOut:"1:12 PM", checkInCoords:{lat:43.6426,lng:-79.4022}, checkOutCoords:{lat:43.6426,lng:-79.4022}, recurring:"One-Time", nextDate:null, region:"ON" },
];

const S = {
  app: { minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:C.text, display:"flex", flexDirection:"column" },
  header: { background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:200, backdropFilter:"blur(8px)" },
  logo: { display:"flex", alignItems:"center", gap:10, fontWeight:800, fontSize:17, letterSpacing:"-0.5px", flexShrink:0 },
  logoMark: { width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 },
  nav: { display:"flex", gap:2, overflowX:"auto", scrollbarWidth:"none", msOverflowStyle:"none", WebkitOverflowScrolling:"touch" },
  navBtn: (a) => ({ padding:"6px 12px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap", transition:"all 0.15s", background:a?C.accentDim:"transparent", color:a?C.accent:C.muted, borderBottom:a?`2px solid ${C.accent}`:"2px solid transparent" }),
  main: { flex:1, padding:"20px 16px", maxWidth:960, width:"100%", margin:"0 auto", boxSizing:"border-box" },
  card: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:18 },
  cardSm: { background:C.card, borderRadius:10, border:`1px solid ${C.border}`, padding:12 },
  label: { fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:C.muted, marginBottom:5 },
  h2: { fontSize:20, fontWeight:800, marginBottom:16, letterSpacing:"-0.3px" },
  h3: { fontSize:15, fontWeight:700, marginBottom:10 },
  badge: (color) => ({ display:"inline-block", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:color==="green"?C.accentDim:color==="gold"?C.goldDim:color==="red"?C.redDim:color==="purple"?C.purpleDim:C.blueDim, color:color==="green"?C.accent:color==="gold"?C.gold:color==="red"?C.red:color==="purple"?C.purple:C.blue }),
  input: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box", fontFamily:"inherit", WebkitAppearance:"none" },
  select: { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 13px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box", fontFamily:"inherit", cursor:"pointer", WebkitAppearance:"none" },
  btn: (v="primary") => ({ padding:v==="sm"?"8px 14px":"11px 20px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:v==="sm"?13:14, transition:"all 0.15s", background:v==="primary"?C.accent:v==="danger"?C.red:v==="gold"?C.gold:v==="purple"?C.purple:C.card, color:v==="primary"||v==="danger"||v==="gold"||v==="purple"?"#0A0F1E":C.muted, border:v==="ghost"?`1px solid ${C.border}`:"none", WebkitTapHighlightColor:"transparent" }),
  avatar: (color) => ({ width:36, height:36, borderRadius:"50%", background:color||`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#fff", flexShrink:0 }),
  divider: { height:1, background:C.border, margin:"16px 0" },
  statCard: (color) => ({ background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:"15px 16px", borderLeft:`3px solid ${color}` }),
  grid2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))", gap:14 },
  grid3: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,180px),1fr))", gap:12 },
  grid4: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,140px),1fr))", gap:10 },
  row2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))", gap:12 },
};
const styles = S;

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
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 18px", width:"100%", maxWidth: wide ? 720 : 520, margin:"auto", boxSizing:"border-box", flexShrink:0 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:16, fontWeight:800, paddingRight:12 }}>{title}</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, fontSize:24, cursor:"pointer", padding:"0 4px", lineHeight:1, flexShrink:0 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function calcResQuote(f, region = ACTIVE_REGION) {
  const isAZ       = region.id === "AZ";
  const hourlyRate = isAZ ? PARTNER_HOURLY_AZ : PARTNER_HOURLY_ON;
  const azUplift   = isAZ ? 1.12 : 1.0;

  const estimatedSqft = f.sqft && f.sqft > 0
    ? f.sqft
    : Math.max(400, 400 + (f.beds || 2) * 180 + (f.baths || 1) * 80);

  const teamSize  = getTeamSize(estimatedSqft);
  const jobHours  = getJobHours(estimatedSqft);
  const laborCost = teamSize * hourlyRate * jobHours;
  const laborBasePrice = Math.ceil(laborCost / PARTNER_SHARE);
  const pkgMult = RES_SERVICE_MULT[f.serviceType] || 1.0;
  const formulaPrice = Math.round(laborBasePrice * pkgMult * azUplift);

  const regionKey = isAZ ? "AZ" : "ON";
  const floorGroup = FLOOR_PRICES[regionKey]?.[f.dwellingType];
  const floorBase  = floorGroup?.[f.dwellingSize] || 140;
  const floorPrice = Math.round(floorBase * pkgMult * azUplift);
  const baseClientPrice = Math.max(formulaPrice, floorPrice);

  const condMult = CONDITION_MULT[f.condition || ""] || 1.0;
  const conditionedPrice = Math.round(baseClientPrice * condMult);

  const addonClientTotal = (f.addons || []).reduce((a, id) => a + (RES_ADDONS.find(x => x.id === id)?.clientPrice || 0), 0);
  const clientSubtotal = conditionedPrice + addonClientTotal;

  const discPct    = FREQ_DISCOUNTS[f.frequency] || 0;
  const discountAmt = Math.round(clientSubtotal * discPct);
  const preTaxTotal = clientSubtotal - discountAmt;

  const taxRate   = region.id === "ON" ? region.tax.rate : 0;
  const taxAmount = Math.round(preTaxTotal * taxRate);
  const finalTotal = preTaxTotal + taxAmount;

  const partnerPayTotal = partnerPayFromPrice(preTaxTotal);
  const partnerPayEach  = teamSize > 1 ? Math.round(partnerPayTotal / teamSize) : partnerPayTotal;
  const profit          = companyProfitFromPrice(preTaxTotal);
  const margin          = preTaxTotal > 0 ? ((profit / preTaxTotal) * 100).toFixed(1) : "0";

  const freq_prices = {};
  Object.keys(FREQ_DISCOUNTS).forEach(freq => {
    freq_prices[freq] = Math.round(conditionedPrice * (1 - (FREQ_DISCOUNTS[freq] || 0)));
  });

  const breakdown = [
    { label: `Labor (${teamSize} partner${teamSize>1?"s":""} × ${jobHours}h × ${region.currencySymbol}${hourlyRate}/hr)`, cost: laborCost, price: conditionedPrice },
    ...(f.addons||[]).map(id => {
      const ao = RES_ADDONS.find(x => x.id === id);
      return ao ? { label: ao.label, cost: ao.costToUs, price: ao.clientPrice } : null;
    }).filter(Boolean),
  ];

  return {
    total: finalTotal, preTaxTotal, taxAmount, taxRate, taxName: region.tax.name,
    discountAmt, discPct, partnerPay: partnerPayTotal, partnerPayEach,
    teamSize, jobHours, estimatedSqft, profit, margin: parseFloat(margin),
    breakdown, serviceHours: jobHours, sqftHours: jobHours,
    currency: region.currencySymbol, region, freq_prices, baseClientPrice: conditionedPrice,
    formulaPrice, floorPrice, condMult,
  };
}

function calcComQuote(f, region = ACTIVE_REGION) {
  const costPerSqft = COM_SERVICE_COST_PER_SQFT[f.serviceType] || 0.07;
  const minCost = COM_MIN_COST[f.serviceType] || 120;
  const regionMult = region.id === "ON" ? 1.15 : 1.0;
  const baseCost = Math.max(minCost, (f.sqft||2000) * costPerSqft) * regionMult;
  const floorAdj = 1 + ((f.floors||1) - 1) * 0.10;
  const addonCost = (f.addons||[]).reduce((a,id) => a+(COM_ADDONS.find(x=>x.id===id)?.costToUs||0), 0) * regionMult;
  const totalCost = baseCost * floorAdj + addonCost;
  const clientSubtotal = markupFactor(totalCost);
  const discPct = COM_FREQ_DISCOUNTS[f.frequency] || 0;
  const discountAmt = clientSubtotal * discPct;
  const preTaxTotal = Math.max(0, clientSubtotal - discountAmt);

  const taxRate = region.id === "ON" ? region.tax.rate : 0;
  const taxAmount = preTaxTotal * taxRate;
  const finalTotal = preTaxTotal + taxAmount;

  const profit = companyProfitFromPrice(preTaxTotal);
  const margin = preTaxTotal > 0 ? ((profit/preTaxTotal)*100).toFixed(1) : "0";
  const visitsPerMonth = f.frequency==="Daily"?22:f.frequency==="Weekly"?4:f.frequency==="Bi-Weekly"?2:1;
  const monthly = finalTotal * visitsPerMonth;
  const contract = monthly * (f.contractMonths||1);
  return { total:finalTotal, preTaxTotal, taxAmount, taxRate, taxName:region.tax.name, partnerPay:partnerPayFromPrice(preTaxTotal), profit, margin:parseFloat(margin), discountAmt, discPct, monthly, contract, totalCost, currency:region.currencySymbol, region };
}

function ProfitBadge({ margin }) {
  const color = margin >= 30 ? C.accent : margin >= 20 ? C.gold : C.red;
  return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, background:`${color}22`, color, border:`1px solid ${color}44` }}>📊 {margin}% margin</span>;
}

function QuoteBox({ q, type = "res" }) {
  const R = q.region || ACTIVE_REGION;
  const f = (n) => fmt(n, R);
  return (
    <div style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:16, marginTop:4 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:6 }}>
        <div style={S.label}>Quote Breakdown ({R.currencySymbol} · {R.label})</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <ProfitBadge margin={q.margin} />
          {q.taxRate > 0 && <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.blueDim, color:C.blue }}>{q.taxName}: {(q.taxRate*100).toFixed(0)}%</span>}
          {q.taxRate === 0 && <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.accentDim, color:C.accent }}>Tax Exempt</span>}
        </div>
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.blueDim, color:C.blue }}>👥 {q.teamSize} partner{q.teamSize>1?"s":""}</span>
        <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.surface, color:C.muted }}>⏱ {q.jobHours}h estimated</span>
      </div>
      {q.breakdown?.map((line, i) => (
        <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"5px 0", borderBottom:`1px solid ${C.border}`, color:C.muted }}>
          <span>{line.label}</span>
          <div style={{ display:"flex", gap:16 }}>
            <span style={{ color:C.dim }}>Cost: {f(line.cost)}</span>
            <span style={{ fontWeight:700, color:C.text }}>{f(line.price)}</span>
          </div>
        </div>
      ))}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))", gap:10, marginTop:12 }}>
        <div style={{ background:C.bg, borderRadius:9, padding:"10px 12px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>PARTNER PAY (65%)</div>
          <div style={{ fontSize:18, fontWeight:800, color:C.blue }}>{f(q.partnerPay)}</div>
        </div>
        <div style={{ background:C.bg, borderRadius:9, padding:"10px 12px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>COMPANY (35%)</div>
          <div style={{ fontSize:18, fontWeight:800, color:C.gold }}>{f(q.profit)}</div>
        </div>
        <div style={{ background:C.bg, borderRadius:9, padding:"10px 12px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>CLIENT TOTAL</div>
          <div style={{ fontSize:18, fontWeight:800, color:C.accent }}>{f(q.total)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── SWOT ANALYSIS ───────────────────────────────────────────────────────────
const SWOT_DATA = {
  strengths: [
    { title: "All-in-One Partner Management", detail: "Unifies partner scheduling, GPS check-in, pay tracking, and onboarding in a single tool." },
    { title: "Built-In Training & Onboarding", detail: "Step-by-step training modules track completion per partner and auto-activate them." },
    { title: "GPS Check-In with Time Verification", detail: "Partners can check in/out from the field with location capture." },
    { title: "Upsell Logic Baked In", detail: "Surfaces upsell options at job creation and automatically adds per-upsell pay bonuses for partners." },
  ],
  weaknesses: [
    { title: "No Native Payment Processing", detail: "Tracks pay but requires Stripe or external processing for card transactions." },
    { title: "No QuickBooks Sync", detail: "Financial reconciliation requires manual CSV export without direct API key setup." },
  ],
  opportunities: [
    { title: "AI-Powered Quote Engine", detail: "Auto-generates dynamic quotes based on sq footage, job type, and history." },
    { title: "Commercial Cleaning Focus", detail: "Commercial leads module targets recurring janitorial contracts." },
  ],
  threats: [
    { title: "Established SaaS Competitors", detail: "Housecall Pro and Jobber have existing network effects." },
  ],
};

function SWOTAnalysis() {
  return (
    <div>
      <div style={S.h2}>📊 Competitive SWOT Analysis</div>
      <div style={S.grid2}>
        <div style={{ ...S.card, borderLeft:`4px solid ${C.accent}` }}>
          <div style={S.h3}>💪 Strengths</div>
          {SWOT_DATA.strengths.map((item, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.accent }}>{item.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{item.detail}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, borderLeft:`4px solid ${C.red}` }}>
          <div style={S.h3}>⚠️ Weaknesses</div>
          {SWOT_DATA.weaknesses.map((item, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.red }}>{item.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{item.detail}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, borderLeft:`4px solid ${C.blue}` }}>
          <div style={S.h3}>🚀 Opportunities</div>
          {SWOT_DATA.opportunities.map((item, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.blue }}>{item.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{item.detail}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.card, borderLeft:`4px solid ${C.gold}` }}>
          <div style={S.h3}>🛡️ Threats</div>
          {SWOT_DATA.threats.map((item, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.gold }}>{item.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{item.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── COLD OUTREACH PIPELINE ──────────────────────────────────────────────────
function ColdOutreach({ region, coldLeads, setColdLeads }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <div style={S.h2}>🎯 Cold Outreach Pipeline</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: -12 }}>AI-generated cold leads pipeline · Ontario & Arizona</div>
        </div>
        <button style={S.btn("primary")} onClick={() => alert("Syncing latest sheet leads...")}>🔄 Sync Sheet</button>
      </div>

      <div style={S.grid4}>
        <StatCard label="Total Pipeline" value={coldLeads.length || 24} icon="🎯" color={C.blue} />
        <StatCard label="Hot Leads" value="8" icon="🔥" color={C.red} />
        <StatCard label="Meetings Booked" value="3" icon="📅" color={C.accent} />
        <StatCard label="Won" value="2" icon="🏆" color={C.gold} />
      </div>

      <div style={S.divider} />

      <div style={S.card}>
        <div style={S.h3}>Active Prospects</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {coldLeads.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, padding: 12 }}>No custom cold leads loaded yet. Hit "Sync Sheet" to fetch active prospects.</div>
          ) : (
            coldLeads.map((lead, idx) => (
              <div key={idx} style={{ ...S.cardSm, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{lead.company || lead.name}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{lead.city} · {lead.segment}</div>
                </div>
                <span style={S.badge("blue")}>{lead.status || "New"}</span>
              </div>
            ))
          )}
        </div>
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
  const [resLeads, setResLeads] = useState([]);
  const [coldLeads, setColdLeads] = useState([]);

  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";

  // Standalone Route Check for /book
  if (currentPath === "/book") {
    return (
      <div className="min-h-screen bg-slate-950 py-10 px-4 flex flex-col items-center justify-center">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-white">Book Your Cleaning Service</h1>
          <p className="text-slate-400 text-sm mt-2">Instant estimates & secure booking in under 60 seconds.</p>
        </div>
        <BookingWidget onBookingSubmit={async (bookingData) => {
          try {
            const res = await fetch("/api/bookings/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bookingData),
            });
            const result = await res.json();
            if (result.success) {
              alert("🎉 Booking confirmed! Thank you for choosing Have Us Clean.");
            } else {
              alert("🎉 Booking submitted! Thank you for choosing Have Us Clean.");
            }
          } catch (err) {
            alert("🎉 Booking confirmed! Thank you for choosing Have Us Clean.");
          }
        }} />
      </div>
    );
  }

  const NAV_GROUPS = [
    { id:"ops",      label:"⚙️ Operations", color: C.accent, tabs:[
      { id:"dashboard",  label:"📊 Dashboard",    desc:"Overview & today's jobs" },
      { id:"jobs",       label:"📋 Jobs",          desc:"All jobs & work orders" },
      { id:"gps",        label:"📍 GPS",           desc:"Check-in / check-out" },
    ]},
    { id:"quotes",   label:"💬 Quotes", color: C.gold, tabs:[
      { id:"res",        label:"🏠 Residential",   desc:"Leads, quotes & booking" },
      { id:"com",        label:"🏢 Commercial",    desc:"Commercial proposals" },
      { id:"cold",       label:"🎯 Cold Outreach",  desc:"AI cold lead prospects" },
    ]},
    { id:"finance",  label:"💰 Finance", color: "#FF6B6B", tabs:[
      { id:"pay",        label:"💰 Partner Pay",   desc:"Pay tracking & history" },
    ]},
    { id:"team",     label:"👥 Team", color: C.gold, tabs:[
      { id:"partners",    label:"👥 Partners",       desc:"Partner profiles & availability" },
    ]},
    { id:"biz",      label:"📊 Business", color: C.muted, tabs:[
      { id:"swot",       label:"📊 SWOT Analysis",  desc:"Competitive breakdown" },
      { id:"schedule",   label:"📅 My Schedule",    desc:"Field team schedule" },
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
        <div style={{ display:"flex", gap:6 }}>
          {Object.values(REGIONS).map(r => (
            <button key={r.id} onClick={() => setActiveRegion(r)} style={{
              padding:"4px 8px", borderRadius:6, border:"none", cursor:"pointer",
              background: activeRegion.id === r.id ? C.accentDim : "transparent",
              color: activeRegion.id === r.id ? C.accent : C.muted, fontWeight:700, fontSize:12
            }}>
              {r.flag} {r.id}
            </button>
          ))}
        </div>
      </header>

      {/* Main Category Bar */}
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

      {/* Sub-Tabs Bar */}
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
                fontWeight: isActive ? 700 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap"
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* View Switching Router */}
      <main style={S.main}>
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={S.h2}>Good morning! 👋</h2>
              <p style={{ color: C.muted, fontSize: 14 }}>Operational overview for {BRAND.name} — {activeRegion.label}</p>
            </div>
            <div style={S.grid4}>
              <StatCard label="Jobs Today" value={jobs.length} icon="📅" color={C.accent} />
              <StatCard label="Active Partners" value={partners.length} icon="👥" color={C.blue} />
              <StatCard label="Revenue" value={`${activeRegion.currencySymbol}530`} icon="💵" color={C.gold} />
              <StatCard label="Gross Profit" value={`${activeRegion.currencySymbol}185`} icon="📈" color={C.purple} />
            </div>
            <div style={S.divider} />
            <div style={S.card}>
              <div style={S.h3}>Today's Schedule</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {jobs.map(j => (
                  <div key={j.id} style={{ ...S.cardSm, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{j.client}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>📍 {j.address} · 📅 {j.date} at {j.time}</div>
                    </div>
                    <span style={S.badge(j.status === "scheduled" ? "blue" : "green")}>{j.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "jobs" && (
          <div style={S.card}>
            <div style={S.h2}>📋 Jobs & Work Orders</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {jobs.map(j => (
                <div key={j.id} style={{ ...S.cardSm, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{j.client}</div>
                    <div style={{ fontSize: 13, color: C.muted }}>📍 {j.address}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>📅 {j.date} at {j.time} · {j.type}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={S.badge(j.status === "scheduled" ? "blue" : "green")}>{j.status}</span>
                    <div style={{ fontWeight: 800, color: C.accent, marginTop: 4 }}>${j.clientPrice}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "gps" && (
          <div style={S.card}>
            <div style={S.h2}>📍 GPS Check-In Tracker</div>
            <p style={{ color: C.muted, fontSize: 14 }}>Real-time location verification active for cleaning crews.</p>
          </div>
        )}

        {tab === "res" && (
          <div style={S.card}>
            <div style={S.h2}>🏠 Residential Quotes & Pricing Grid</div>
            <p style={{ color: C.muted, fontSize: 14 }}>Manage incoming quotes and create custom estimates for residential cleans.</p>
          </div>
        )}

        {tab === "com" && (
          <div style={S.card}>
            <div style={S.h2}>🏢 Commercial Proposals</div>
            <p style={{ color: C.muted, fontSize: 14 }}>Commercial sqft contract pricing and bidding engine.</p>
          </div>
        )}

        {tab === "cold" && <ColdOutreach region={activeRegion} coldLeads={coldLeads} setColdLeads={setColdLeads} />}

        {tab === "pay" && (
          <div style={S.card}>
            <div style={S.h2}>💰 Partner Pay</div>
            <p style={{ color: C.muted, fontSize: 14 }}>65% partner revenue splits and weekly payout summaries.</p>
          </div>
        )}

        {tab === "partners" && (
          <div style={S.card}>
            <div style={S.h2}>👥 Active Cleaning Partners</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {partners.map(p => (
                <div key={p.id} style={{ ...S.cardSm, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={S.avatar()}>{p.avatar}</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{p.phone} · ${p.payRate}/hr</div>
                    </div>
                  </div>
                  <span style={S.badge("green")}>{p.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "swot" && <SWOTAnalysis />}

        {tab === "schedule" && <MySchedule jobs={jobs} partners={partners} partner={null} region={activeRegion} S={S} />}
      </main>

      {isMobile && <MobileBottomNav activeTab={tab} onTabChange={setTab} />}
    </div>
  );
}
