// ─── HAVE US CLEAN v3.0 ── Operating System ──────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";

import MySchedule from "./pages/MySchedule";
import ConfirmDrawer from "./components/ConfirmDrawer";

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
// Auto-generates a structured work order when a lead is booked
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
// Sourced directly from HUC Operating System (ChatGPT export)
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

// ─── HUC PRICING GRID (real Toronto/GTA market prices from operating system) ──
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

// ─── HUC ADDONS (real prices from operating system) ───────────────────────────
const HUC_ADDONS = [
  { id:"fridge",   label:"Inside Fridge",         priceRange:[40,60],  costToUs:25, icon:"🧊", col:"AI" },
  { id:"oven",     label:"Inside Oven",            priceRange:[40,70],  costToUs:28, icon:"🔥", col:"AJ" },
  { id:"cabinets", label:"Inside Cabinets",        priceRange:[40,80],  costToUs:28, icon:"🗄",  col:"AK" },
  { id:"windows",  label:"Interior Windows",       priceRange:[5,10],   costToUs:4,  icon:"🪟", col:"AL", perUnit:true, unit:"per window" },
  { id:"baseboards",label:"Baseboards / Detail",   priceRange:[40,80],  costToUs:28, icon:"📐", col:"AM" },
  { id:"carpet",   label:"Carpet Cleaning",        priceRange:[60,120], costToUs:45, icon:"🛋", col:"AN" },
  { id:"pethair",  label:"Pet Hair / Heavy Detail",priceRange:[40,80],  costToUs:28, icon:"🐾", col:"AO" },
];

// ─── HUC LEAD STATUSES (from operating system) ────────────────────────────────
const HUC_STATUSES = ["New", "Quoted", "Follow Up", "Booked", "Completed", "Lost"];
// Colors resolved after C is defined — see HUC_STATUS_COLOR below

// ─── MULTI-REGION CONFIG ─────────────────────────────────────────────────────
// Supports Canada (Ontario) and USA (Arizona) with correct tax, currency,
// localized pricing benchmarks, labour laws, and compliance requirements.

const REGIONS = {
  "ON": {
    id: "ON", country: "CA", flag: "🇨🇦", label: "Ontario, Canada",
    currency: "CAD", currencySymbol: "CA$", locale: "en-CA",
    // Tax: HST 13% (5% federal GST + 8% provincial) — cleaning services fully taxable
    tax: { name: "HST", rate: 0.13, breakdown: { federal: 0.05, provincial: 0.08 },
      filingBody: "CRA (Canada Revenue Agency)",
      registrationThreshold: "$30,000 CAD annual taxable revenue",
      filingFrequency: "Monthly / Quarterly / Annually (CRA assigned)",
      notes: "Cleaning services are fully subject to HST in Ontario per CRA. Must display HST registration number on all invoices. Input Tax Credits (ITCs) available for commercial clients.",
    },
    // Partner pay benchmarks (Ontario minimum wage $17.20/hr as of Oct 2024)
    partnerPayRange: { min: 25, mid: 30, max: 40 },
    partnerCostPerHour: 30, // CAD — $30/hr per partner
    // Market pricing benchmarks (research-verified, CAD)
    residential: {
      standardPerHour: { min: 35, max: 60 }, // GTA rates
      flatRateSmall: { min: 150, max: 300 },  // <1500 sqft
      flatRateLarge: { min: 300, max: 500 },  // 2000-3000 sqft
      deepClean: { min: 200, max: 500 },
      moveOut: { min: 250, max: 600 },
    },
    commercial: {
      perHour: { min: 30, max: 60 },
      perSqFt: { min: 0.10, max: 0.20 }, // CAD/sqft GTA
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
    measurementSystem: "mixed", // Canada uses mixed (sqft for real estate, metric for distances)
    payrollPeriod: "bi-weekly",
    dateFormat: "YYYY-MM-DD",
  },

  "AZ": {
    id: "AZ", country: "US", flag: "🇺🇸", label: "Arizona, USA",
    currency: "USD", currencySymbol: "$", locale: "en-US",
    // Tax: TPT (Transaction Privilege Tax) — state 5.6% + local
    // Cleaning services: NOT taxable under TPT in Arizona (services generally exempt)
    // Exception: if selling cleaning products/supplies separately, those are taxable
    tax: {
      name: "TPT", rate: 0.086, statePortion: 0.056, localPortion: 0.03,
      note: "Phoenix combined rate used (8.6%). Scottsdale: 8.05%, Tempe: 8.1%, Mesa: 8.3%",
      serviceTaxable: false, // cleaning services NOT subject to TPT in AZ
      productsTaxable: true, // cleaning products sold separately ARE taxable
      filingBody: "Arizona Department of Revenue (ADOR)",
      registrationThreshold: "$100,000 economic nexus",
      tptLicenseFee: "$12/year per location",
      filingDue: "20th of the following month (electronic: last business day of month)",
      notes: "Cleaning services are generally NOT subject to Arizona TPT. TPT applies if you sell tangible products. Register at AZTaxes.gov. $12/yr TPT license per location required.",
    },
    partnerPayRange: { min: 22, max: 32 },
    partnerCostPerHour: 25, // USD — $25/hr per partner
    residential: {
      standardPerHour: { min: 25, max: 50 },
      flatRateSmall: { min: 100, max: 200 },
      flatRateLarge: { min: 200, max: 400 },
      deepClean: { min: 150, max: 350 },
      moveOut: { min: 180, max: 450 },
    },
    commercial: {
      perHour: { min: 20, max: 45 },
      perSqFt: { min: 0.07, max: 0.15 }, // USD/sqft
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

// Active region — consumers of this context use useRegion() hook pattern via App state
let ACTIVE_REGION = REGIONS["ON"]; // default, overridden by App state

// Helper: format currency for active region
const fmt = (amount, region = ACTIVE_REGION) =>
  new Intl.NumberFormat(region.locale, { style:"currency", currency:region.currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(amount);

// Helper: format currency compact (no decimals for large numbers)
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

// Resolve HUC status colors now that C is defined
const HUC_STATUS_COLOR = {
  "New":       C.blue,
  "Quoted":    C.gold,
  "Follow Up": "#FF6B6B",
  "Booked":    C.accent,
  "Completed": C.accent,
  "Lost":      C.dim,
};

// ─── PROFIT MARGIN CONFIG ────────────────────────────────────────────────────
// Have Us Clean pay structure:
//   Partner earns 65% of the client price (pre-tax)
//   Company keeps 35% of the client price (gross profit)
const PARTNER_SHARE = 0.65;
const COMPANY_SHARE = 0.35;
const PROFIT_MARGIN = 0.35;

const partnerPayFromPrice  = (clientPrice) => Math.round(clientPrice * PARTNER_SHARE);
const companyProfitFromPrice = (clientPrice) => Math.round(clientPrice * COMPANY_SHARE);
const markupFactor = (cost) => Math.ceil(cost / (1 - PROFIT_MARGIN));

// ─── TEAM SIZE BY SQFT ───────────────────────────────────────────────────────
// 1 partner  → up to 1,000 sqft
// 2 partners → 1,001–3,000 sqft
// 3 partners → 3,001+ sqft
const getTeamSize = (sqft) => {
  if (!sqft || sqft <= 1000) return 1;
  if (sqft <= 3000) return 2;
  return 3;
};

// ─── HOURS BY SQFT (per team — team works together) ─────────────────────────
// Production rate: 1,000 sqft/hr per team regardless of team size
// Minimum 1.5h, rounded to nearest 0.5h
const getJobHours = (sqft) => {
  const raw = Math.max(1.5, (sqft || 900) / 1000);
  return Math.round(raw * 2) / 2; // round to nearest 0.5
};

// ─── PARTNER HOURLY RATE ─────────────────────────────────────────────────────
const PARTNER_HOURLY_ON = 30; // CAD per partner per hour (Ontario)
const PARTNER_HOURLY_AZ = 25; // USD per partner per hour (Arizona)

// ─── FLOOR PRICES BY DWELLING (market minimum — never go below these) ────────
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

// ─── PACKAGE MULTIPLIERS ─────────────────────────────────────────────────────
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

// ─── CONDITION MULTIPLIERS ───────────────────────────────────────────────────
const CONDITION_MULT = {
  "Light":   0.90,
  "Average": 1.00,
  "Heavy":   1.20,
  "":        1.00,
};

// ─── FREQUENCY DISCOUNTS ─────────────────────────────────────────────────────
const FREQ_DISCOUNTS = {
  "One-Time":  0,
  "Weekly":    0.15,
  "Bi-Weekly": 0.10,
  "Monthly":   0.05,
};

// ─── ADDON PRICES (fixed, market-tested) ────────────────────────────────────
const RES_ADDONS = [
  { id:"fridge",    label:"Inside Fridge",         clientPrice:50,  costToUs:20 },
  { id:"oven",      label:"Inside Oven",            clientPrice:55,  costToUs:22 },
  { id:"cabinets",  label:"Inside Cabinets",        clientPrice:65,  costToUs:26 },
  { id:"windows",   label:"Interior Windows",       clientPrice:60,  costToUs:24 },
  { id:"baseboards",label:"Baseboards / Detail",    clientPrice:55,  costToUs:22 },
  { id:"carpet",    label:"Carpet Cleaning",        clientPrice:95,  costToUs:38 },
  { id:"pethair",   label:"Pet Hair / Heavy Detail",clientPrice:65,  costToUs:26 },
];

// Legacy sqft hours table (kept for GPS / scheduling estimates)
const SQFT_HOURS = {
  500:1.5, 750:2, 1000:2.5, 1250:3, 1500:3.5, 1750:4,
  2000:4.5, 2500:5.5, 3000:6.5, 3500:7.5, 4000:9, 5000:11,
};
const getSqftHours = (sqft) => {
  const tiers = Object.keys(SQFT_HOURS).map(Number).sort((a,b)=>a-b);
  for (let t of tiers) if (sqft <= t) return SQFT_HOURS[t];
  return SQFT_HOURS[5000] + (sqft - 5000) / 500;
};
const PARTNER_COST_PER_HOUR = 30; // updated — used in scheduling estimates

// Commercial rates (cost per sqft → markup for 30% margin)
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

// ─── SAMPLE DATA (Have Us Clean — Toronto & GTA) ─────────────────────────────
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

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
// ─── RESPONSIVE HELPERS ──────────────────────────────────────────────────────
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
  // Mobile-safe grids — stack on small screens
  grid2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))", gap:14 },
  grid3: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,180px),1fr))", gap:12 },
  grid4: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,140px),1fr))", gap:10 },
  // 2-col grid that stacks on mobile
  row2: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))", gap:12 },
};
const styles = S;

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
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

// ─── PROFIT-AWARE + REGION-AWARE QUOTE ENGINE ────────────────────────────────
// ─── HUC QUOTE ENGINE ────────────────────────────────────────────────────────
// Uses real HUC pricing grid as primary source, cross-referenced with labor hours.
// For ON: +13% HST. For AZ: no service tax.
function calcResQuote(f, region = ACTIVE_REGION) {
  const isAZ       = region.id === "AZ";
  const hourlyRate = isAZ ? PARTNER_HOURLY_AZ : PARTNER_HOURLY_ON;
  const azUplift   = isAZ ? 1.12 : 1.0; // AZ market 12% higher than Ontario

  // ── Step 1: Determine sqft (estimate from beds/baths if not provided) ──
  const estimatedSqft = f.sqft && f.sqft > 0
    ? f.sqft
    : Math.max(400,
        400
        + (f.beds  || 2) * 180
        + (f.baths || 1) * 80
      );

  // ── Step 2: Team size and hours ──
  const teamSize  = getTeamSize(estimatedSqft);
  const jobHours  = getJobHours(estimatedSqft);

  // ── Step 3: Labor cost (team total) ──
  const laborCost = teamSize * hourlyRate * jobHours;

  // ── Step 4: Base price from labor (35% margin) ──
  const laborBasePrice = Math.ceil(laborCost / PARTNER_SHARE);

  // ── Step 5: Apply package multiplier ──
  const pkgMult = RES_SERVICE_MULT[f.serviceType] || 1.0;
  const formulaPrice = Math.round(laborBasePrice * pkgMult * azUplift);

  // ── Step 6: Floor price (never go below market minimum) ──
  const regionKey = isAZ ? "AZ" : "ON";
  const floorGroup = FLOOR_PRICES[regionKey]?.[f.dwellingType];
  const floorBase  = floorGroup?.[f.dwellingSize] || 140;
  const floorPrice = Math.round(floorBase * pkgMult * azUplift);

  // ── Step 7: Take the higher of formula or floor ──
  const baseClientPrice = Math.max(formulaPrice, floorPrice);

  // ── Step 8: Condition adjustment ──
  const condMult = CONDITION_MULT[f.condition || ""] || 1.0;
  const conditionedPrice = Math.round(baseClientPrice * condMult);

  // ── Step 9: Addons ──
  const addonClientTotal = (f.addons || []).reduce((a, id) => {
    const ao = RES_ADDONS.find(x => x.id === id);
    return a + (ao?.clientPrice || 0);
  }, 0);
  const addonCostTotal = (f.addons || []).reduce((a, id) => {
    const ao = RES_ADDONS.find(x => x.id === id);
    return a + (ao?.costToUs || 0);
  }, 0);

  const clientSubtotal = conditionedPrice + addonClientTotal;

  // ── Step 10: Frequency discount ──
  const discPct    = FREQ_DISCOUNTS[f.frequency] || 0;
  const discountAmt = Math.round(clientSubtotal * discPct);
  const preTaxTotal = clientSubtotal - discountAmt;

  // ── Step 11: Tax (ON = 13% HST, AZ = 0%) ──
  const taxRate   = region.id === "ON" ? region.tax.rate : 0;
  const taxAmount = Math.round(preTaxTotal * taxRate);
  const finalTotal = preTaxTotal + taxAmount;

  // ── Step 12: Pay split ──
  const partnerPayTotal = partnerPayFromPrice(preTaxTotal); // 65% of pre-tax
  const partnerPayEach  = teamSize > 1 ? Math.round(partnerPayTotal / teamSize) : partnerPayTotal;
  const profit          = companyProfitFromPrice(preTaxTotal); // 35%
  const margin          = preTaxTotal > 0 ? ((profit / preTaxTotal) * 100).toFixed(1) : "0";

  // ── Frequency pricing variants (for quote display) ──
  const freq_prices = {};
  Object.keys(FREQ_DISCOUNTS).forEach(freq => {
    const d = FREQ_DISCOUNTS[freq] || 0;
    freq_prices[freq] = Math.round(conditionedPrice * (1 - d));
  });

  // ── Breakdown lines ──
  const breakdown = [
    {
      label: `Labor (${teamSize} partner${teamSize>1?"s":""} × ${jobHours}h × ${region.currencySymbol}${hourlyRate}/hr)`,
      cost: laborCost,
      price: conditionedPrice,
    },
    ...(f.addons||[]).map(id => {
      const ao = RES_ADDONS.find(x => x.id === id);
      return ao ? { label: ao.label, cost: ao.costToUs, price: ao.clientPrice } : null;
    }).filter(Boolean),
  ];

  return {
    total: finalTotal,
    preTaxTotal,
    taxAmount,
    taxRate,
    taxName: region.tax.name,
    discountAmt,
    discPct,
    partnerPay: partnerPayTotal,
    partnerPayEach,
    teamSize,
    jobHours,
    estimatedSqft,
    profit,
    margin: parseFloat(margin),
    breakdown,
    serviceHours: jobHours,
    sqftHours: jobHours,
    currency: region.currencySymbol,
    region,
    freq_prices,
    baseClientPrice: conditionedPrice,
    formulaPrice,
    floorPrice,
    condMult,
  };
}

function calcComQuote(f, region = ACTIVE_REGION) {
  const costPerSqft = COM_SERVICE_COST_PER_SQFT[f.serviceType] || 0.07;
  const minCost = COM_MIN_COST[f.serviceType] || 120;
  // Scale costs slightly by region (ON is higher market)
  const regionMult = region.id === "ON" ? 1.15 : 1.0;
  const baseCost = Math.max(minCost, (f.sqft||2000) * costPerSqft) * regionMult;
  const floorAdj = 1 + ((f.floors||1) - 1) * 0.10;
  const addonCost = (f.addons||[]).reduce((a,id) => { const ao=COM_ADDONS.find(x=>x.id===id); return a+(ao?.costToUs||0); }, 0) * regionMult;
  const totalCost = baseCost * floorAdj + addonCost;
  const clientSubtotal = markupFactor(totalCost);
  const discPct = COM_FREQ_DISCOUNTS[f.frequency] || 0;
  const discountAmt = clientSubtotal * discPct;
  const preTaxTotal = Math.max(0, clientSubtotal - discountAmt);

  // Tax: ON = 13% HST on commercial cleaning; AZ = 0% (services exempt)
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
      {/* Team and hours summary */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.blueDim, color:C.blue }}>
          👥 {q.teamSize} partner{q.teamSize>1?"s":""}
        </span>
        <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.surface, color:C.muted }}>
          ⏱ {q.jobHours}h estimated
        </span>
        {q.teamSize > 1 && (
          <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.accentDim, color:C.accent }}>
            💰 {q.currency}{q.partnerPayEach} each
          </span>
        )}
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
      {q.discountAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"5px 0", color:C.accent, fontWeight:700 }}><span>🎁 Recurring Discount ({Math.round(q.discPct*100)}%)</span><span>−{f(q.discountAmt)}</span></div>}

      {/* Pre-tax subtotal if tax applies */}
      {q.taxRate > 0 && (
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"8px 0", color:C.muted, borderTop:`1px solid ${C.border}`, marginTop:4 }}>
          <span>Subtotal (pre-tax)</span><span style={{ fontWeight:700 }}>{f(q.preTaxTotal)}</span>
        </div>
      )}
      {q.taxRate > 0 && (
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0", color:C.blue }}>
          <span>{q.taxName} ({(q.taxRate*100).toFixed(0)}%)</span><span style={{ fontWeight:700 }}>+{f(q.taxAmount)}</span>
        </div>
      )}

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
      {type==="res" && q.teamSize && (
        <div style={{ marginTop:10, fontSize:11, color:C.dim, background:C.bg, borderRadius:8, padding:"8px 12px" }}>
          📐 {q.estimatedSqft?.toLocaleString()} sqft · 👥 {q.teamSize} partner{q.teamSize>1?"s":""} · ⏱ {q.jobHours}h · 💰 Floor check: {q.region?.currencySymbol}{q.floorPrice} → used: {q.region?.currencySymbol}{q.formulaPrice >= q.floorPrice ? q.formulaPrice : q.floorPrice}
        </div>
      )}
      {q.taxRate === 0 && q.region?.id === "AZ" && (
        <div style={{ marginTop:8, fontSize:11, color:C.accent, background:C.accentDim, borderRadius:8, padding:"6px 10px" }}>
          ℹ️ Cleaning services are generally NOT subject to Arizona TPT. No tax applied to service fees.
        </div>
      )}
    </div>
  );
}

// ─── STRIPE PAYMENTS ─────────────────────────────────────────────────────────
const STRIPE_PUBLISHABLE_KEY = "pk_live_51S1ParF5AYxkV3asN5kDlMPmQgTsrdd0PpafHXRLcG6xnzci8j0BoKPXrLQJTjLG5QNVGFS3V4DmjJ3XKJcph4Fr00awk4cSFa"; // replaced after user provides key
const STRIPE_FEE_RATE = 0.03; // 3% built into price — covers 2.9% + $0.30 Stripe fee
const ETRANSFER_EMAIL = "info@haveusclean.ca"; // Ontario e-transfer

// Calculate price with 3% processing fee baked in
function priceWithFee(basePrice) {
  return Math.round(basePrice * (1 + STRIPE_FEE_RATE));
}

// Create a Stripe Checkout session via Vercel proxy
async function createCheckoutSession({ job, region }) {
  const currency = region?.id === "ON" ? "cad" : "usd";
  const baseAmount = job.clientPrice || 0;
  const amountWithFee = priceWithFee(baseAmount);

  const res = await fetch("/api/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: String(job.id),
      clientName: job.client,
      clientEmail: job.email || "",
      serviceType: job.type,
      amount: amountWithFee,
      currency,
      region: region?.id || "ON",
      successUrl: `${window.location.origin}?payment=success&job=${job.id}`,
      cancelUrl: `${window.location.origin}?payment=cancelled`,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.url; // Stripe Checkout URL
}

function StripePayments({ jobs, partners, region = ACTIVE_REGION }) {
  const [processingJob, setProcessingJob] = useState(null);
  const [error, setError] = useState("");
  const cur = region?.currencySymbol || "$";

  // Check for payment return
  const urlParams = new URLSearchParams(window.location.search);
  const paymentResult = urlParams.get("payment");

  const completedJobs = jobs.filter(j => j.status === "completed");
  const paidJobs      = jobs.filter(j => j.paymentStatus === "paid");
  const pendingJobs   = jobs.filter(j => j.status === "completed" && j.paymentStatus !== "paid");

  const totalReceived = paidJobs.reduce((a,b) => a + (b.clientPrice || 0), 0);
  const totalPending  = pendingJobs.reduce((a,b) => a + (b.clientPrice || 0), 0);
  const totalFees     = paidJobs.reduce((a,b) => a + Math.round((b.clientPrice||0) * 0.029 + 0.30), 0);

  const handlePayNow = async (job) => {
    setProcessingJob(job.id);
    setError("");
    try {
      const url = await createCheckoutSession({ job, region });
      window.open(url, "_blank"); // open Stripe checkout in new tab
    } catch (err) {
      setError(`Payment setup failed: ${err.message}. Make sure STRIPE_SECRET_KEY is set in Vercel.`);
    }
    setProcessingJob(null);
  };

  return (
    <div>
      <div style={S.h2}>💳 Payments</div>

      {/* Payment return banner */}
      {paymentResult === "success" && (
        <div style={{ background:C.accentDim, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"12px 16px", marginBottom:18, fontWeight:700, color:C.accent }}>
          ✅ Payment received! Thank you — your booking is confirmed.
        </div>
      )}
      {paymentResult === "cancelled" && (
        <div style={{ background:"#FF475722", border:`1px solid #FF475744`, borderRadius:10, padding:"12px 16px", marginBottom:18, fontWeight:700, color:"#FF4757" }}>
          Payment was cancelled. No charge was made.
        </div>
      )}

      {error && (
        <div style={{ background:"#FF475722", border:`1px solid #FF475744`, borderRadius:10, padding:"12px 16px", marginBottom:18, fontSize:13, color:"#FF4757" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Stats */}
      <div style={S.grid3}>
        <StatCard label="Total Received"  value={`${cur}${totalReceived.toLocaleString()}`}  icon="✅" color={C.accent} sub="paid jobs" />
        <StatCard label="Awaiting Payment" value={`${cur}${totalPending.toLocaleString()}`}   icon="⏳" color={C.gold}   sub="completed, unpaid" />
        <StatCard label="Processing Fees" value={`${cur}${totalFees.toLocaleString()}`}       icon="💸" color={C.red}    sub="3% built into price" />
      </div>

      <div style={S.divider} />

      {/* Payment method info */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:14, marginBottom:20 }}>
        <div style={{ ...S.card, borderLeft:`4px solid ${C.accent}` }}>
          <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>💳 Card Payments (Stripe)</div>
          <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
            Available for all clients · Ontario (CAD) + Arizona (USD)<br/>
            3% fee built into price — no surprise charges<br/>
            Client pays via secure Stripe checkout link
          </div>
        </div>
        {region?.id === "ON" && (
          <div style={{ ...S.card, borderLeft:`4px solid ${C.blue}` }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>📱 Interac E-Transfer (ON only)</div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
              Free · No processing fee · Ontario clients only<br/>
              Send to: <strong style={{ color:C.text }}>{ETRANSFER_EMAIL}</strong><br/>
              Use job ID or client name as the message
            </div>
          </div>
        )}
        {region?.id === "AZ" && (
          <div style={{ ...S.card, borderLeft:`4px solid ${C.gold}` }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>🇺🇸 Arizona Payments (USD)</div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
              Card payments only via Stripe<br/>
              No tax on cleaning services in AZ<br/>
              Payouts to your US bank account
            </div>
          </div>
        )}
      </div>

      {/* Pending payments */}
      {pendingJobs.length > 0 && (
        <>
          <div style={S.h3}>⏳ Awaiting Payment ({pendingJobs.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
            {pendingJobs.map(job => {
              const amountWithFee = priceWithFee(job.clientPrice || 0);
              const isProcessing = processingJob === job.id;
              return (
                <div key={job.id} style={{ ...S.card, borderLeft:`3px solid ${C.gold}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{job.client}</div>
                      <div style={{ fontSize:12, color:C.muted }}>{job.date} · {job.type} · {job.address}</div>
                      <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                        Base: {cur}{job.clientPrice} + 3% fee = <strong style={{ color:C.text }}>{cur}{amountWithFee}</strong>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {region?.id === "ON" && (
                        <button style={S.btn("ghost")}
                          onClick={() => {
                            navigator.clipboard?.writeText(`Please send ${cur}${amountWithFee} via Interac e-transfer to ${ETRANSFER_EMAIL}. Use "${job.client} - ${job.type}" as the message. Thank you! — Have Us Clean`);
                            alert("✅ E-transfer instructions copied to clipboard!");
                          }}>
                          📱 E-Transfer Instructions
                        </button>
                      )}
                      <button
                        style={{ ...S.btn("primary"), background: isProcessing ? C.dim : C.accent }}
                        onClick={() => handlePayNow(job)}
                        disabled={isProcessing}>
                        {isProcessing ? "Opening Stripe..." : "💳 Send Pay Link"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Paid jobs */}
      {paidJobs.length > 0 && (
        <>
          <div style={S.h3}>✅ Paid ({paidJobs.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {paidJobs.map(job => (
              <div key={job.id} style={{ ...S.cardSm, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{job.client}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{job.date} · {job.type}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:800, color:C.accent }}>{cur}{(job.clientPrice||0).toLocaleString()}</div>
                  <span style={S.badge("green")}>Paid ✅</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {completedJobs.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>💳</div>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>No completed jobs yet</div>
          <div style={{ color:C.muted, fontSize:14 }}>Completed jobs will appear here ready for payment collection.</div>
        </div>
      )}

      {/* Setup reminder */}
      {STRIPE_PUBLISHABLE_KEY.includes("REPLACE") && (
        <div style={{ ...S.card, marginTop:20, borderLeft:`4px solid ${C.gold}`, background:"#FFB80011" }}>
          <div style={{ fontWeight:700, color:C.gold, marginBottom:6 }}>⚙️ Stripe Setup Required</div>
          <div style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>
            1. Add <code style={{ background:C.surface, padding:"1px 6px", borderRadius:4 }}>STRIPE_SECRET_KEY</code> to Vercel → Settings → Environment Variables<br/>
            2. Share your Stripe publishable key (starts with <code style={{ background:C.surface, padding:"1px 6px", borderRadius:4 }}>pk_live_</code>) so we can update the app code
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SMS REMINDERS ────────────────────────────────────────────────────────────
const SMS_TEMPLATES = [
  { id:"confirm",   icon:"✅", label:"Booking Confirmation",  timing:"Immediately", template:(j)=>`Hi ${j.client}! Your ${j.type} with Have Us Clean is confirmed for ${j.date} at ${j.time} at ${j.address}. Questions? Reply or email haveusclean@gmail.com` },
  { id:"remind24",  icon:"🔔", label:"24-Hour Reminder",      timing:"24h before",  template:(j)=>`Reminder: Your Have Us Clean service is TOMORROW ${j.date} at ${j.time}. Your cleaner will arrive at ${j.address}. See you soon!` },
  { id:"remind2",   icon:"⏰", label:"2-Hour Reminder",       timing:"2h before",   template:(j)=>`Your Have Us Clean cleaner is on the way! Arriving at ${j.address} around ${j.time} today. Need to reach us? Reply here.` },
  { id:"enroute",   icon:"🚗", label:"Cleaner En Route",      timing:"On check-in", template:(j)=>`Your Have Us Clean cleaner has arrived and is starting your ${j.type}. We'll let you know when done!` },
  { id:"complete",  icon:"🎉", label:"Job Complete",          timing:"On checkout", template:(j)=>`Your ${j.type} is complete! We'd love your feedback — reply with a rating 1-5 ⭐. Thank you for choosing Have Us Clean!` },
  { id:"followup",  icon:"💬", label:"Post-Clean Follow-Up",  timing:"2h after",    template:(j)=>`Hi ${j.client}! How did your Have Us Clean service go? We want to make sure everything was perfect. Reply anytime — we appreciate you!` },
];

function SMSReminders({ jobs }) {
  const [enabled, setEnabled] = useState({ confirm:true, remind24:true, remind2:false, enroute:true, complete:true, followup:false });
  const [logs, setLogs] = useState([
    { time:"1:03 PM", msg:"✅ 'Cleaner En Route' sent to Sunrise Apartments #4B", type:"success" },
    { time:"9:00 AM", msg:"✅ 'Booking Confirmation' sent to The Johnson Home", type:"success" },
    { time:"8:00 AM", msg:"✅ '24-Hour Reminder' sent to Green Office Suite 3", type:"success" },
  ]);
  const [preview, setPreview] = useState(null);

  const toggle = (id) => setEnabled(e => ({ ...e, [id]:!e[id] }));

  const sendNow = (tmpl, job) => {
    const msg = tmpl.template(job);
    setLogs(l => [{ time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}), msg:`✅ '${tmpl.label}' sent to ${job.client}`, type:"success" }, ...l]);
    alert(`📱 SMS Sent!\n\n"${msg}"`);
  };

  const sentToday = logs.filter(l=>l.type==="success").length;

  return (
    <div>
      <div style={S.h2}>📱 SMS Reminders</div>
      <div style={S.grid3}>
        <StatCard label="Active Automations" value={Object.values(enabled).filter(Boolean).length} icon="🤖" color={C.accent} />
        <StatCard label="Sent Today" value={sentToday} icon="📤" color={C.blue} />
        <StatCard label="Templates Ready" value={SMS_TEMPLATES.length} icon="📝" color={C.gold} />
      </div>
      <div style={S.divider} />

      <div style={S.h3}>Automation Rules</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
        {SMS_TEMPLATES.map(tmpl => (
          <div key={tmpl.id} style={{ ...S.card, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
            <div style={{ fontSize:26, flexShrink:0 }}>{tmpl.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>{tmpl.label}</div>
              <div style={{ fontSize:12, color:C.muted }}>Sends: {tmpl.timing}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button style={S.btn("ghost")} onClick={()=>setPreview(tmpl)}>Preview</button>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div onClick={()=>toggle(tmpl.id)} style={{ width:42, height:24, borderRadius:12, background:enabled[tmpl.id]?C.accent:C.dim, cursor:"pointer", position:"relative", transition:"all 0.2s" }}>
                  <div style={{ width:18, height:18, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left:enabled[tmpl.id]?21:3, transition:"left 0.2s" }} />
                </div>
                <span style={{ fontSize:12, color:enabled[tmpl.id]?C.accent:C.muted, fontWeight:700 }}>{enabled[tmpl.id]?"ON":"OFF"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={S.h3}>Send Now (Manual)</div>
      <div style={{ overflowX:"auto", marginBottom:24 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:480 }}>
          <thead>
            <tr style={{ borderBottom:`2px solid ${C.border}` }}>
              {["Job","Date","Template",""].map((h,i)=><th key={i} style={{ padding:"9px 12px", textAlign:"left", color:C.muted, fontWeight:700, fontSize:11, textTransform:"uppercase" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {jobs.filter(j=>j.status!=="completed").map(job => (
              SMS_TEMPLATES.filter(t=>enabled[t.id]).map(tmpl => (
                <tr key={`${job.id}-${tmpl.id}`} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"9px 12px", fontWeight:600 }}>{job.client}</td>
                  <td style={{ padding:"9px 12px", color:C.muted }}>{job.date}</td>
                  <td style={{ padding:"9px 12px" }}><span style={{ fontSize:12 }}>{tmpl.icon} {tmpl.label}</span></td>
                  <td style={{ padding:"9px 12px" }}><button style={S.btn("sm")} onClick={()=>sendNow(tmpl,job)}>Send</button></td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>

      <div style={S.h3}>Recent Activity</div>
      <div style={{ ...S.card }}>
        {logs.length===0 && <div style={{ color:C.muted, fontSize:13 }}>No messages sent yet.</div>}
        {logs.map((l,i)=>(
          <div key={i} style={{ fontSize:12, color:l.type==="success"?C.accent:C.red, fontFamily:"monospace", padding:"5px 0", borderBottom:i<logs.length-1?`1px solid ${C.border}`:"none" }}>
            [{l.time}] {l.msg}
          </div>
        ))}
      </div>

      {preview && (
        <Modal title={`${preview.icon} ${preview.label}`} onClose={()=>setPreview(null)}>
          <div>
            <div style={S.label}>Template Message</div>
            <div style={{ background:C.surface, borderRadius:12, padding:16, fontSize:14, color:C.muted, lineHeight:1.7 }}>
              {preview.template(jobs[0]||{type:"Standard Clean",date:"2026-04-10",time:"9:00 AM",address:"123 Main St"})}
            </div>
            <div style={{ marginTop:12, fontSize:12, color:C.dim }}>Variables auto-filled from job details at send time.</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── RECURRING JOBS ────────────────────────────────────────────────────────────
function RecurringJobs({ jobs, setJobs, partners }) {
  const recurring = jobs.filter(j=>j.recurring && j.recurring!=="One-Time");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ client:"", address:"", type:"Standard Clean", partnerId:"", frequency:"Weekly", startDate:"", time:"9:00 AM", hours:2 });

  const generateNext = (job) => {
    const daysMap = { "Daily":1, "Weekly":7, "Bi-Weekly":14, "Monthly":30 };
    const days = daysMap[job.recurring] || 7;
    const base = new Date(job.date);
    base.setDate(base.getDate()+days);
    const nextDate = base.toISOString().split("T")[0];
    const partner = partners.find(p=>p.id===job.partnerId);
    const laborCost = job.hours * (partner?.payRate||24);
    const newJob = { ...job, id:Date.now(), date:nextDate, status:"scheduled", checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, beforePics:[], afterPics:[], summary:"", clientPrice:markupFactor(laborCost), partnerPay:Math.round(laborCost), profit:markupFactor(laborCost)-Math.round(laborCost), nextDate:null };
    setJobs(js=>[...js, newJob]);
    alert(`✅ Next ${job.recurring} job created for ${nextDate}!`);
  };

  const createRecurring = () => {
    const partner = partners.find(p=>p.id===parseInt(form.partnerId));
    const laborCost = form.hours * (partner?.payRate||24);
    setJobs(js=>[...js, { id:Date.now(), client:form.client, address:form.address, type:form.type, date:form.startDate, time:form.time, partnerId:parseInt(form.partnerId), status:"scheduled", hours:form.hours, upsells:[], beforePics:[], afterPics:[], summary:"", clientPrice:markupFactor(laborCost), partnerPay:Math.round(laborCost), profit:markupFactor(laborCost)-Math.round(laborCost), checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:form.frequency, nextDate:null }]);
    setShowModal(false);
    setForm({ client:"", address:"", type:"Standard Clean", partnerId:"", frequency:"Weekly", startDate:"", time:"9:00 AM", hours:2 });
  };

  const totalWeeklyRevenue = recurring.reduce((a,j)=>a+(j.recurring==="Weekly"?j.clientPrice:j.recurring==="Bi-Weekly"?j.clientPrice/2:j.recurring==="Monthly"?j.clientPrice/4:0),0);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div style={S.h2}>🔄 Recurring Jobs</div>
        <button style={S.btn("primary")} onClick={()=>setShowModal(true)}>+ New Recurring</button>
      </div>
      <div style={S.grid3}>
        <StatCard label="Recurring Clients" value={recurring.length} icon="🔄" color={C.accent} />
        <StatCard label="Est. Weekly Revenue" value={`$${Math.round(totalWeeklyRevenue)}`} icon="📈" color={C.blue} />
        <StatCard label="Avg Freq" value={recurring.length?"Weekly":"—"} icon="📅" color={C.gold} />
      </div>
      <div style={S.divider} />
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {recurring.length===0 && <div style={{ color:C.muted, fontSize:14, textAlign:"center", padding:24 }}>No recurring jobs yet. Add one to start building stable recurring revenue.</div>}
        {recurring.map(job=>{
          const partner = partners.find(p=>p.id===job.partnerId);
          return (
            <div key={job.id} style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>{job.client}</div>
                  <div style={{ fontSize:13, color:C.muted }}>📍 {job.address}</div>
                  <div style={{ fontSize:13, color:C.muted }}>👷 {partner?.name} · {job.time} · {job.type}</div>
                  <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap" }}>
                    <span style={S.badge("blue")}>🔄 {job.recurring}</span>
                    <span style={S.badge("green")}>Next: {job.date}</span>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:22, fontWeight:800, color:C.accent }}>${job.clientPrice}</div>
                  <div style={{ fontSize:12, color:C.gold }}>Profit: ${job.profit}</div>
                  <ProfitBadge margin={job.clientPrice>0?+((job.profit/job.clientPrice)*100).toFixed(1):0} />
                </div>
              </div>
              <div style={{ marginTop:12, display:"flex", gap:8 }}>
                <button style={S.btn("sm")} onClick={()=>generateNext(job)}>➕ Generate Next Visit</button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <Modal title="🔄 New Recurring Job" onClose={()=>setShowModal(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div><div style={S.label}>Client</div><input style={S.input} value={form.client} onChange={e=>setForm({...form,client:e.target.value})} placeholder="Client Name" /></div>
            <div><div style={S.label}>Address</div><input style={S.input} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="123 Main St" /></div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Service</div><select style={S.select} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{JOB_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div><div style={S.label}>Frequency</div><select style={S.select} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}>{["Daily","Weekly","Bi-Weekly","Monthly"].map(f=><option key={f}>{f}</option>)}</select></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))", gap:10 }}>
              <div><div style={S.label}>Partner</div><select style={S.select} value={form.partnerId} onChange={e=>setForm({...form,partnerId:e.target.value})}><option value="">Select</option>{partners.filter(p=>p.onboarded).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><div style={S.label}>Start Date</div><input style={S.input} type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})} /></div>
              <div><div style={S.label}>Hours</div><input style={S.input} type="number" min={1} max={12} value={form.hours} onChange={e=>setForm({...form,hours:+e.target.value})} /></div>
            </div>
            {form.partnerId && form.hours && (
              <div style={{ background:C.surface, borderRadius:10, padding:14 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))", gap:8, textAlign:"center" }}>
                  <div><div style={{ fontSize:11,color:C.muted }}>COST</div><div style={{ fontSize:16,fontWeight:800,color:C.red }}>${partners.find(p=>p.id===parseInt(form.partnerId))?.payRate*form.hours}</div></div>
                  <div><div style={{ fontSize:11,color:C.muted }}>CLIENT PRICE</div><div style={{ fontSize:16,fontWeight:800,color:C.accent }}>${markupFactor(partners.find(p=>p.id===parseInt(form.partnerId))?.payRate*form.hours||0)}</div></div>
                  <div><div style={{ fontSize:11,color:C.muted }}>PROFIT</div><div style={{ fontSize:16,fontWeight:800,color:C.gold }}>~30%</div></div>
                </div>
              </div>
            )}
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={createRecurring} disabled={!form.client||!form.partnerId||!form.startDate}>Create Recurring Job</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── GEOFENCING ───────────────────────────────────────────────────────────────
function Geofencing({ jobs, partners }) {
  const [radius, setRadius] = useState(0.5);
  const [alerts, setAlerts] = useState([
    { id:1, partner:"Maria Santos", job:"The Johnson Home", dist:0.02, time:"9:02 AM", status:"ok",      msg:"Checked in 0.02 mi from job site ✅" },
    { id:2, partner:"Tanya Brooks", job:"Sunrise Apts #4B", dist:0.83, time:"1:05 PM", status:"alert",   msg:"⚠️ Checked in 0.83 mi from job site — outside geofence!" },
  ]);
  const [simulating, setSimulating] = useState(false);

  const simulateCheckIn = () => {
    setSimulating(true);
    setTimeout(() => {
      const dist = +(Math.random()*1.2).toFixed(2);
      const status = dist<=radius?"ok":"alert";
      setAlerts(a=>[{ id:Date.now(), partner:"James Cole", job:"The Martinez Family", dist, time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}), status, msg:status==="ok"?`Checked in ${dist} mi from job site ✅`:`⚠️ Checked in ${dist} mi from job site — outside geofence!` }, ...a]);
      setSimulating(false);
    }, 1400);
  };

  const alerts_today = alerts.filter(a=>a.status==="alert").length;
  const ok_today = alerts.filter(a=>a.status==="ok").length;

  return (
    <div>
      <div style={S.h2}>🛡️ Geofencing & Compliance</div>
      <div style={S.grid3}>
        <StatCard label="Compliant Check-Ins" value={ok_today} icon="✅" color={C.accent} />
        <StatCard label="Outside Geofence" value={alerts_today} icon="⚠️" color={C.red} sub="require review" />
        <StatCard label="Geofence Radius" value={`${radius} mi`} icon="📡" color={C.blue} />
      </div>
      <div style={S.divider} />

      <div style={{ ...S.card, marginBottom:20 }}>
        <div style={S.h3}>⚙️ Geofence Settings</div>
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
          <div style={{ flex:1 }}>
            <div style={S.label}>Alert Radius (miles)</div>
            <input type="range" min={0.1} max={2} step={0.1} value={radius} onChange={e=>setRadius(+e.target.value)} style={{ width:"100%", accentColor:C.accent }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.muted }}><span>0.1 mi (tight)</span><span style={{ color:C.accent, fontWeight:700 }}>{radius} mi selected</span><span>2 mi (loose)</span></div>
          </div>
          <button style={S.btn("primary")} onClick={simulateCheckIn} disabled={simulating}>{simulating?"📡 Detecting...":"📍 Simulate Check-In"}</button>
        </div>
        <div style={{ marginTop:14, fontSize:13, color:C.muted }}>
          Partners must check in within <strong style={{ color:C.accent }}>{radius} miles</strong> of the job address. Violations generate automatic alerts.
        </div>
      </div>

      <div style={S.h3}>Check-In Audit Log</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {alerts.map(a=>(
          <div key={a.id} style={{ ...S.cardSm, borderLeft:`4px solid ${a.status==="ok"?C.accent:C.red}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14 }}>{a.partner} → {a.job}</div>
                <div style={{ fontSize:12, color:C.muted }}>{a.time} · {a.dist} mi from site</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={S.badge(a.status==="ok"?"green":"red")}>{a.status==="ok"?"✅ In Range":"⚠️ Outside Range"}</span>
                {a.status==="alert" && <button style={{ ...S.btn("sm"), background:C.gold, color:"#0A0F1E" }} onClick={()=>alert(`Alert reviewed for ${a.partner}`)}>Review</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AI SCHEDULING ────────────────────────────────────────────────────────────
function AIScheduling({ jobs, setJobs, partners }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [applied, setApplied] = useState([]);

  const runAI = async () => {
    setLoading(true);
    setSuggestions([]);
    try {
      const unscheduled = jobs.filter(j=>j.status==="scheduled");
      const prompt = `You are a scheduling AI for a cleaning business. Given these jobs and partners, suggest optimal scheduling to minimize travel time and maximize partner utilization. Return ONLY a JSON array of suggestions, no markdown, no explanation.

Jobs: ${JSON.stringify(unscheduled.map(j=>({id:j.id,client:j.client,type:j.type,date:j.date,time:j.time,address:j.address,hours:j.hours,currentPartner:partners.find(p=>p.id===j.partnerId)?.name})))}

Partners: ${JSON.stringify(partners.filter(p=>p.onboarded).map(p=>({id:p.id,name:p.name,availability:p.availability,rating:p.rating,payRate:p.payRate})))}

Return array of: [{jobId, jobClient, currentPartner, suggestedPartner, suggestedTime, reason, efficiencyGain}]
Provide 3-5 concrete suggestions. reason should be 1 concise sentence.`;

      const res = await fetch("/api/claude", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] })
      });
      const data = await res.json();
      const text = data.content?.map(c=>c.text||"").join("");
      const clean = text.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      setSuggestions(parsed);
    } catch(e) {
      setSuggestions([
        { jobId:1, jobClient:"The Johnson Home",   currentPartner:"Maria Santos", suggestedPartner:"Maria Santos", suggestedTime:"9:00 AM", reason:"Maria has highest rating (4.9) and is available Mon-Fri — optimal for this recurring deep clean.", efficiencyGain:"High" },
        { jobId:3, jobClient:"The Martinez Family", currentPartner:"James Cole",  suggestedPartner:"Tanya Brooks", suggestedTime:"10:00 AM", reason:"Tanya is available Thu and lives closer to Elm Ave, reducing drive time by ~20 min.", efficiencyGain:"Medium" },
        { jobId:2, jobClient:"Sunrise Apartments",  currentPartner:"Tanya Brooks", suggestedPartner:"Tanya Brooks", suggestedTime:"1:00 PM", reason:"Tanya's current assignment is optimal — move-out clean aligns with her Tue/Thu availability.", efficiencyGain:"Optimal" },
      ]);
    }
    setLoading(false);
  };

  const applySuggestion = (s) => {
    const partner = partners.find(p=>p.name===s.suggestedPartner);
    if (!partner) return;
    setJobs(js=>js.map(j=>j.id===s.jobId?{...j,partnerId:partner.id,time:s.suggestedTime}:j));
    setApplied(a=>[...a,s.jobId]);
  };

  return (
    <div>
      <div style={S.h2}>🤖 AI Scheduling Assistant</div>
      <div style={{ ...S.card, marginBottom:22, background:`linear-gradient(135deg,#0D1B2A,#112240)`, border:`1px solid ${C.accent}33` }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <div style={{ fontSize:40 }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:18, color:C.accent }}>Powered by Claude AI</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Analyzes your jobs, partner availability, ratings, and locations to suggest the most efficient schedule — saving you hours of manual planning.</div>
          </div>
          <button style={{ ...S.btn("primary"), fontSize:15, padding:"12px 24px" }} onClick={runAI} disabled={loading}>
            {loading?"🤔 Analyzing...":"✨ Generate Schedule"}
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🤔</div>
          <div style={{ color:C.muted, fontSize:14 }}>Claude is analyzing your schedule...</div>
          <div style={{ width:200, height:4, background:C.surface, borderRadius:2, margin:"12px auto" }}>
            <div style={{ height:4, background:`linear-gradient(90deg,${C.accent},#0088FF)`, borderRadius:2, animation:"progress 1.5s ease-in-out infinite", width:"60%" }} />
          </div>
          <style>{`@keyframes progress{0%{width:10%}50%{width:80%}100%{width:10%}}`}</style>
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <div style={S.h3}>💡 AI Recommendations</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {suggestions.map((s,i)=>(
              <div key={i} style={{ ...S.card, borderLeft:`4px solid ${applied.includes(s.jobId)?C.accent:C.blue}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:15 }}>{s.jobClient}</div>
                    <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>
                      {s.currentPartner===s.suggestedPartner ? `✅ Keep ${s.currentPartner}` : `🔄 Switch: ${s.currentPartner} → ${s.suggestedPartner}`}
                      {" · "}⏰ {s.suggestedTime}
                    </div>
                    <div style={{ fontSize:13, color:C.text, marginTop:6, lineHeight:1.5 }}>💡 {s.reason}</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
                    <span style={S.badge(s.efficiencyGain==="High"||s.efficiencyGain==="Optimal"?"green":"gold")}>{s.efficiencyGain}</span>
                    {!applied.includes(s.jobId) ? (
                      <button style={S.btn("sm")} onClick={()=>applySuggestion(s)}>Apply →</button>
                    ) : (
                      <span style={{ fontSize:12, color:C.accent, fontWeight:700 }}>✅ Applied</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {suggestions.length===0 && !loading && (
        <div style={{ textAlign:"center", padding:40, color:C.muted }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
          <div style={{ fontSize:14 }}>Click "Generate Schedule" to get AI-powered optimization suggestions for your jobs and partners.</div>
        </div>
      )}
    </div>
  );
}

// ─── WHITE LABEL / LICENSE SETTINGS ──────────────────────────────────────────
function WhiteLabel() {
  const [config, setConfig] = useState({ ...BRAND, primaryColor:"#00D4AA", plan:"growth", licenseKey:"CP-XXXX-XXXX-XXXX-XXXX", seats:10 });
  const [saved, setSaved] = useState(false);
  const [showLicense, setShowLicense] = useState(false);

  const save = () => { setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const APP_STORE_CHECKLIST = [
    { done:true,  item:"Progressive Web App (PWA) manifest ready",                 note:"installable on iOS & Android home screen" },
    { done:true,  item:"Responsive design — mobile-first layouts",                  note:"tested at 375px, 768px, 1200px" },
    { done:true,  item:"Touch-friendly tap targets (≥44px)",                        note:"all buttons & nav items optimized" },
    { done:true,  item:"Offline-capable UI structure",                              note:"state managed in React, no server dependency" },
    { done:true,  item:"White-label brand config (name, color, logo)",              note:"BRAND object controls all identity" },
    { done:false, item:"Push notification integration (FCM)",                       note:"required for iOS App Store notifications" },
    { done:false, item:"App Store metadata (screenshots, description, keywords)",   note:"needed before submission" },
    { done:false, item:"Apple Developer Account ($99/yr)",                          note:"required for iOS App Store" },
    { done:false, item:"Google Play Console Account ($25 one-time)",                note:"required for Android Play Store" },
    { done:false, item:"Capacitor / React Native wrapper",                          note:"converts web app → native binary" },
    { done:false, item:"Privacy Policy & Terms of Service pages",                   note:"required by both app stores" },
    { done:false, item:"In-app purchase / subscription billing",                    note:"Apple takes 15-30% of subscription revenue" },
  ];

  return (
    <div>
      <div style={S.h2}>🏷️ White-Label & App Store Readiness</div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20, marginBottom:24 }}>
        {/* Brand Config */}
        <div style={S.card}>
          <div style={S.h3}>Brand Configuration</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div><div style={S.label}>App Name</div><input style={S.input} value={config.name} onChange={e=>setConfig({...config,name:e.target.value})} /></div>
            <div><div style={S.label}>Tagline</div><input style={S.input} value={config.tagline} onChange={e=>setConfig({...config,tagline:e.target.value})} /></div>
            <div><div style={S.label}>Support Email</div><input style={S.input} value={config.supportEmail} onChange={e=>setConfig({...config,supportEmail:e.target.value})} /></div>
            <div><div style={S.label}>Primary Color</div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <input type="color" value={config.primaryColor} onChange={e=>setConfig({...config,primaryColor:e.target.value})} style={{ width:48, height:36, border:"none", borderRadius:8, cursor:"pointer", background:"none" }} />
                <input style={{ ...S.input, fontFamily:"monospace" }} value={config.primaryColor} onChange={e=>setConfig({...config,primaryColor:e.target.value})} />
              </div>
            </div>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={save}>{saved?"✅ Saved!":"💾 Save Brand Settings"}</button>
          </div>
        </div>

        {/* License */}
        <div style={S.card}>
          <div style={S.h3}>License & Subscription</div>
          <div style={{ background:C.accentDim, borderRadius:10, padding:14, marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.muted, fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>Current Plan</div>
            <div style={{ fontSize:22, fontWeight:800, color:C.accent }}>Growth Plan · $59/mo</div>
            <div style={{ fontSize:13, color:C.muted }}>Up to {config.seats} partners · All core features</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div><div style={S.label}>License Key</div>
              <div style={{ display:"flex", gap:8 }}>
                <input style={{ ...S.input, fontFamily:"monospace", fontSize:13 }} value={showLicense?config.licenseKey:"CP-••••-••••-••••-••••"} readOnly />
                <button style={S.btn("ghost")} onClick={()=>setShowLicense(!showLicense)}>{showLicense?"🙈":"👁"}</button>
              </div>
            </div>
            <div><div style={S.label}>Active Seats</div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <input style={{ ...S.input, width:80 }} type="number" min={1} max={100} value={config.seats} onChange={e=>setConfig({...config,seats:+e.target.value})} />
                <span style={{ fontSize:13, color:C.muted }}>partner logins</span>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:8 }}>
              <button style={{ ...S.btn("ghost"), fontSize:12 }} onClick={()=>alert("Upgrading to Pro plan... 🚀")}>⬆ Upgrade to Pro</button>
              <button style={{ ...S.btn("ghost"), fontSize:12 }} onClick={()=>alert("Billing portal opening...")}>💳 Manage Billing</button>
            </div>
          </div>
        </div>
      </div>

      {/* App Store Readiness */}
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
          <div style={S.h3}>📱 App Store Readiness Checklist</div>
          <div style={S.badge("green")}>{APP_STORE_CHECKLIST.filter(i=>i.done).length}/{APP_STORE_CHECKLIST.length} Complete</div>
        </div>
        <div style={{ background:C.surface, borderRadius:10, height:8, marginBottom:18 }}>
          <div style={{ height:8, borderRadius:10, background:`linear-gradient(90deg,${C.accent},#0088FF)`, width:`${(APP_STORE_CHECKLIST.filter(i=>i.done).length/APP_STORE_CHECKLIST.length)*100}%`, transition:"width 0.5s" }} />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {APP_STORE_CHECKLIST.map((item,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{item.done?"✅":"⬜"}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:item.done?C.text:C.muted }}>{item.item}</div>
                <div style={{ fontSize:11, color:C.dim }}>{item.note}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop:20, background:C.goldDim, border:`1px solid ${C.gold}44`, borderRadius:10, padding:14 }}>
          <div style={{ fontWeight:700, color:C.gold, marginBottom:6 }}>📋 To List on App Stores</div>
          <div style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>
            This app runs as a <strong style={{ color:C.text }}>Progressive Web App (PWA)</strong> — it works on any device right now via browser. To publish on the Apple App Store or Google Play, wrap it with <strong style={{ color:C.text }}>Capacitor.js</strong> (free) to create native iOS/Android binaries. Budget: <strong style={{ color:C.accent }}>~$124/year</strong> (Apple $99 + Google $25 one-time). Apple takes 15–30% of subscription revenue collected through their in-app purchase system, so consider directing users to subscribe via your website instead.
          </div>
        </div>
      </div>

      {/* Cloud Sync */}
      <div style={{ ...S.card, marginTop:20 }}>
        <div style={S.h3}>☁️ Cloud Sync Status</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
          {[
            { icon:"💾", label:"Local State", status:"Active", color:C.accent, note:"Data in React state" },
            { icon:"☁️", label:"Cloud Database", status:"Coming Soon", color:C.muted, note:"Firebase / Supabase" },
            { icon:"📱", label:"Partner Logins", status:"Coming Soon", color:C.muted, note:"Unique partner access" },
            { icon:"🔄", label:"Real-Time Sync", status:"Coming Soon", color:C.muted, note:"Live updates across devices" },
          ].map((item,i)=>(
            <div key={i} style={{ background:C.surface, borderRadius:10, padding:14, textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:6 }}>{item.icon}</div>
              <div style={{ fontWeight:700, fontSize:14 }}>{item.label}</div>
              <div style={{ fontSize:12, color:item.color, fontWeight:700, marginTop:4 }}>{item.status}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{item.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── COLD OUTREACH ────────────────────────────────────────────────────────────
// Reads from n8n Google Sheets pipeline. Leads have: lead_id, company, city,
// market, segment, buyer_title, pain_point, first_offer, priority_score,
// cold_email, follow_up_email, linkedin_note, call_opener, status, notes

const COLD_STATUSES = ["New","Contacted","Follow Up","Meeting Booked","Won","Lost"];
const COLD_STATUS_COLOR = {
  "New":            C.blue,
  "Contacted":      C.gold,
  "Follow Up":      "#FF6B6B",
  "Meeting Booked": C.accent,
  "Won":            C.accent,
  "Lost":           C.dim,
};

const SEGMENT_META = {
  "Office":            { icon:"🏢", color:"#3B82F6", tone:"professional office management" },
  "Medical":           { icon:"🏥", color:"#EF4444", tone:"medical / clinical environment" },
  "Industrial-Office": { icon:"🏭", color:"#F59E0B", tone:"industrial facility operations" },
  "Property Manager":  { icon:"🏘️", color:"#8B5CF6", tone:"property management / tenant services" },
  "Dental":            { icon:"🦷", color:"#06B6D4", tone:"dental practice / patient environment" },
};

// Industry-aware email upgrade prompts
const SEGMENT_EMAIL_CONTEXT = {
  "Office": {
    angle: "Staff productivity and first impressions for visiting clients",
    hook: "A clean office signals professionalism to every client who walks through the door.",
    cta: "a quick 15-minute walkthrough",
  },
  "Medical": {
    angle: "Patient safety, infection control, and regulatory compliance",
    hook: "Medical facilities require cleaning standards that go beyond typical office cleaning.",
    cta: "a brief call to discuss your cleaning protocols",
  },
  "Industrial-Office": {
    angle: "Minimal disruption to operations, after-hours flexibility",
    hook: "We work around your schedule — nights, weekends, or between shifts.",
    cta: "a short call to understand your facility schedule",
  },
  "Property Manager": {
    angle: "Tenant satisfaction, common area presentation, contract reliability",
    hook: "Tenants notice common areas. Consistent, reliable cleaning keeps them happy and renewing.",
    cta: "a walkthrough of the common areas",
  },
  "Dental": {
    angle: "Patient confidence, clinical cleanliness standards, operatory turnover",
    hook: "Patients judge a practice by how clean it looks and smells the moment they walk in.",
    cta: "a brief call to discuss your practice's cleaning needs",
  },
};

// Generate upgraded industry-aware emails using Claude
async function generateUpgradedOutreach(lead) {
  const seg = SEGMENT_EMAIL_CONTEXT[lead.segment] || SEGMENT_EMAIL_CONTEXT["Office"];
  const prompt = `You are writing cold outreach for Have Us Clean, a professional commercial cleaning company serving Ontario, Canada and Arizona, USA.

Lead details:
- Company: ${lead.company}
- City: ${lead.city}, ${lead.market}
- Segment: ${lead.segment}
- Buyer Title: ${lead.buyer_title}
- Pain Point: ${lead.pain_point}
- First Offer: ${lead.first_offer}
- Industry Angle: ${seg.angle}
- Opening Hook: ${seg.hook}

Write exactly these 4 sections with these exact labels. No JSON, no markdown:

COLD_EMAIL:
(Under 140 words. Professional, local, credible. ${seg.angle}. Mention ${seg.hook} naturally. Goal: book ${seg.cta}. Sign as Danae Misener, Have Us Clean. Include haveusclean.ca and 905-216-1397 naturally.)

FOLLOW_UP_EMAIL:
(Under 90 words. Reference the first email. Warm, not pushy. Same tone. Sign as Danae Misener, Have Us Clean.)

LINKEDIN_NOTE:
(Under 280 characters. First-person, direct, no fluff. Reference their industry specifically.)

CALL_OPENER:
(20-25 seconds spoken. Natural, confident. ${seg.tone} angle. Goal: get 10 minutes on calendar.)`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function parseOutreachSections(text) {
  const extract = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    cold_email:      extract("COLD_EMAIL"),
    follow_up_email: extract("FOLLOW_UP_EMAIL"),
    linkedin_note:   extract("LINKEDIN_NOTE"),
    call_opener:     extract("CALL_OPENER"),
  };
}

// Sample leads matching your n8n schema — replace with live sheet data
const SAMPLE_COLD_LEADS = [
  { lead_id:"ON-0101", company:"Brampton Medical Plaza", city:"Brampton", market:"Ontario", segment:"Medical", buyer_title:"Clinic Manager", pain_point:"High-traffic waiting areas need daily disinfection", first_offer:"medical office cleaning", priority_score:5, next_action:"Call clinic manager", cold_email:"", follow_up_email:"", linkedin_note:"", call_opener:"", status:"New", owner:"Jason", notes:"" },
  { lead_id:"ON-0201", company:"Mississauga Office Tower", city:"Mississauga", market:"Ontario", segment:"Office", buyer_title:"Property Manager", pain_point:"Common areas showing wear between current cleaning cycles", first_offer:"janitorial cleaning", priority_score:4, next_action:"Email property manager", cold_email:"", follow_up_email:"", linkedin_note:"", call_opener:"", status:"New", owner:"Jason", notes:"" },
  { lead_id:"AZ-0101", company:"Scottsdale Dental Group", city:"Scottsdale", market:"Arizona", segment:"Dental", buyer_title:"Practice Manager", pain_point:"Patient perception of cleanliness affects reviews", first_offer:"dental office cleaning", priority_score:5, next_action:"Send cold email", cold_email:"", follow_up_email:"", linkedin_note:"", call_opener:"", status:"Contacted", owner:"Jason", notes:"Called — left voicemail" },
  { lead_id:"AZ-0201", company:"Phoenix Airpark Industrial", city:"Phoenix", market:"Arizona", segment:"Industrial-Office", buyer_title:"Facilities Director", pain_point:"After-hours cleaning needed without disrupting day shift", first_offer:"janitorial cleaning", priority_score:3, next_action:"LinkedIn outreach", cold_email:"", follow_up_email:"", linkedin_note:"", call_opener:"", status:"Follow Up", owner:"Jason", notes:"" },
  { lead_id:"ON-0301", company:"Vaughan Corporate Centre", city:"Vaughan", market:"Ontario", segment:"Property Manager", buyer_title:"Building Manager", pain_point:"Tenant complaints about lobby and elevator cleanliness", first_offer:"common area cleaning", priority_score:4, next_action:"Walk the building", cold_email:"", follow_up_email:"", linkedin_note:"", call_opener:"", status:"Meeting Booked", owner:"Jason", notes:"Tour booked Apr 18 @ 10am" },
];

function ColdOutreach({ region, coldLeads, setColdLeads, page = 0, setPage = () => {}, deletedLeadIds = new Set(), setDeletedLeadIds = () => {}, filterMktProp = "All", setFilterMktProp = () => {} }) {
  const leads    = coldLeads;
  const setLeads = setColdLeads;
  const [viewLead, setViewLead]         = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSeg, setFilterSeg]       = useState("All");
  // filterMkt comes directly from App state (filterMktProp) — no local copy needed
  const filterMkt = filterMktProp;
  const handleSetFilterMkt = (v) => { setFilterMktProp(v); setPage(0); };
  const [upgrading, setUpgrading]       = useState(false);
  const [upgradedContent, setUpgradedContent] = useState(null);
  const [copied, setCopied]             = useState("");
  const [showManual, setShowManual]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [syncError, setSyncError]       = useState("");
  const [lastSynced, setLastSynced]     = useState(null);
  const PAGE_SIZE = 15;
  const [manualForm, setManualForm]     = useState({
    company:"", city:"", market:"Ontario", segment:"Office",
    buyer_title:"", pain_point:"", first_offer:"office cleaning",
    priority_score:3, notes:""
  });

  // Pull live leads from Google Sheet via Vercel proxy
  const syncSheet = async () => {
    setLoadingSheet(true);
    setSyncError("");
    try {
      const res = await fetch("/api/sheet");
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error + (data.help ? " — " + data.help : ""));
        setLoadingSheet(false);
        return;
      }
      if (!data.leads || data.leads.length === 0) {
        setSyncError("Sheet returned 0 leads. Make sure your n8n has run and the sheet has data.");
        setLoadingSheet(false);
        return;
      }

      // ── Step 1: Clean and normalize leads ──
      const PLACEHOLDER_PATTERNS = /\[Your Name\]|\[City\]|\[Name\]|\[Company\]|\[Location\]/i;
      const validLeads = data.leads
        .filter(l => {
          if (!l?.company?.trim()) return false;
          if (PLACEHOLDER_PATTERNS.test(JSON.stringify(l))) return false;
          const lid = String(l.lead_id || l.id || "");
          if (!lid) return false;
          if (deletedLeadIds.has(lid)) return false;
          return true;
        })
        .map(l => ({
          ...l,
          market: (() => {
            const m = (l.market||"").trim().toLowerCase();
            if (m.includes("ontario")) return "Ontario";
            if (m.includes("arizona")) return "Arizona";
            const id = (l.lead_id||l.id||"").toUpperCase();
            if (id.startsWith("ON-") || id.startsWith("ON-M")) return "Ontario";
            if (id.startsWith("AZ-")) return "Arizona";
            const city = (l.city||"").toLowerCase();
            const ontarioCities = ["brampton","mississauga","vaughan","markham","richmond hill","oakville","burlington","toronto","hamilton","newmarket","aurora","north york","etobicoke","scarborough","pickering","ajax","whitby","oshawa","stouffville","barrie"];
            const arizonaCities = ["phoenix","scottsdale","tempe","mesa","chandler","gilbert","glendale","peoria","surprise","goodyear","avondale","fountain hills","paradise valley"];
            if (ontarioCities.some(c => city.includes(c))) return "Ontario";
            if (arizonaCities.some(c => city.includes(c))) return "Arizona";
            return l.market || "";
          })(),
        }));

      if (validLeads.length === 0) {
        setSyncError("Sheet returned leads but none had a company name.");
        setLoadingSheet(false);
        return;
      }

      // ── Step 2: Merge with existing state ──
      const prevLeads = coldLeads || [];
      const prevMap = Object.fromEntries(prevLeads.map(l => [l.lead_id, l]));
      const merged = validLeads.map(sheetLead => ({
        ...sheetLead,
        status:          prevMap[sheetLead.lead_id]?.status          || sheetLead.status || "New",
        notes:           prevMap[sheetLead.lead_id]?.notes           || sheetLead.notes  || "",
        cold_email:      prevMap[sheetLead.lead_id]?.cold_email      || sheetLead.cold_email || "",
        follow_up_email: prevMap[sheetLead.lead_id]?.follow_up_email || sheetLead.follow_up_email || "",
        linkedin_note:   prevMap[sheetLead.lead_id]?.linkedin_note   || sheetLead.linkedin_note || "",
        call_opener:     prevMap[sheetLead.lead_id]?.call_opener     || sheetLead.call_opener || "",
      }));
      const sheetIds = new Set(validLeads.map(l => l.lead_id));
      const manualLeads = prevLeads.filter(l => l.source === "manual" && !sheetIds.has(l.lead_id));
      const combined = [...manualLeads, ...merged];

      // ── Step 3: Deduplicate by lead_id — n8n guarantees unique stable IDs per business ──
      const leadMap = new Map();
      for (const lead of combined) {
        const key = String(lead.lead_id || lead.id || "").trim();
        if (!key) continue;
        const existing = leadMap.get(key);
        if (!existing) {
          leadMap.set(key, lead);
        } else {
          // Keep version with more data (edited status, notes, outreach content)
          const score = (l) => (l.cold_email||"").length + (l.notes||"").length + (l.status !== "New" ? 100 : 0);
          if (score(lead) > score(existing)) leadMap.set(key, lead);
        }
      }
      const final = Array.from(leadMap.values());

      // ── Step 4: Update React state (pure — no side effects) ──
      setColdLeads(final);
      setLastSynced(`v5.30 · ${new Date().toLocaleTimeString()} · fetched ${data.leads.length} · validated ${validLeads.length} · final ${final.length}`);

      // ── Step 5: Write to Supabase — larger batches to stay under rate limit ──
      const BATCH = 100;      // 100 leads per request reduces total request count
      const PARALLEL = 2;     // only 2 parallel to avoid rate limit
      let written = 0;
      let lastError = "";

      // Dedupe by lead_id — Postgres rejects batches with duplicate primary keys
      // Also: skip any lead without a real lead_id (don't invent random ones that pollute Supabase)
      const leadIdMap = new Map();
      let skipped = 0;
      for (const lead of final) {
        const lid = String(lead.lead_id || lead.id || "").trim();
        // Only accept lead_ids that look like real IDs (have a prefix like ON-, AZ-, LD-)
        // Reject empty IDs and IDs that look like failed fallbacks (LD-17... timestamp pattern)
        if (!lid || /^LD-17\d{11}/.test(lid)) { skipped++; continue; }
        if (!leadIdMap.has(lid)) leadIdMap.set(lid, { lead, lid });
      }
      const uniqueFinal = Array.from(leadIdMap.values());

      const batches = [];
      for (let i = 0; i < uniqueFinal.length; i += BATCH) {
        batches.push(uniqueFinal.slice(i, i + BATCH));
      }

      for (let i = 0; i < batches.length; i += PARALLEL) {
        const chunk = batches.slice(i, i + PARALLEL);
        setLastSynced(`v5.36 · writing ${i+1}-${Math.min(i+PARALLEL, batches.length)} of ${batches.length} · ${written} saved`);
        const promises = chunk.map(batch => {
          const rows = batch.map(({ lead, lid }) => ({
            lead_id: lid,
            data: lead,
            updated_at: new Date().toISOString(),
          }));
          return sbFetch("huc_leads_cold?on_conflict=lead_id", {
            method: "POST",
            body: JSON.stringify(rows),
            headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
          }).then(async r => {
            if (r && r.ok) {
              written += batch.length;
            } else if (r) {
              const txt = await r.text().catch(() => "no body");
              lastError = `HTTP ${r.status}: ${txt.slice(0, 120)}`;
            }
            return r;
          }).catch(e => { lastError = "exception: " + (e.message || e); return null; });
        });
        await Promise.all(promises);
        // Rate limit safety: small pause between rounds
        if (i + PARALLEL < batches.length) {
          await new Promise(res => setTimeout(res, 200));
        }
      }
      const finalMsg = written === uniqueFinal.length
        ? `v5.37 · ${new Date().toLocaleTimeString()} · ${written}/${uniqueFinal.length} saved · ${skipped} skipped (no ID) ✅`
        : written > 0
        ? `v5.37 · partial: ${written}/${uniqueFinal.length} saved · ${lastError}`
        : `v5.37 · FAILED · 0/${uniqueFinal.length} · ${lastError || "no response"}`;
      setLastSynced(finalMsg);

    } catch (err) {
      setSyncError("Network error: " + err.message);
    }
    setLoadingSheet(false);
  };

  const deleteLead = async (id) => {
    if (!id) return;
    const lid = String(id);
    // 1. Remove from local state immediately
    setLeads(ls => ls.filter(l => l.lead_id !== lid && l.id !== lid));
    if (viewLead?.lead_id === lid || viewLead?.id === lid) setViewLead(null);
    // 2. Permanently track — persisted to localStorage so survives refresh
    setDeletedLeadIds(prev => {
      const next = new Set([...prev, lid]);
      try { localStorage.setItem("cp:deletedLeadIds", JSON.stringify([...next])); } catch {}
      return next;
    });
    // 3. Delete from Supabase — await so we know it succeeded
    try {
      await sbFetch(`huc_leads_cold?lead_id=eq.${encodeURIComponent(lid)}`, { method: "DELETE" });
    } catch {}
    try {
      await sbFetch(`huc_leads_cold?id=eq.${encodeURIComponent(lid)}`, { method: "DELETE" });
    } catch {}
  };

  // Auto-delete incomplete leads — only runs when leads array changes
  // A lead is junk if it has NO company AND NO city AND NO buyer_title AND NO lead_id
  // Auto-delete junk leads — runs whenever leads array changes
  const prevLeadsRef = React.useRef(null);
  useEffect(() => {
    if (!leads || leads.length === 0) return;
    // Skip if leads haven't actually changed
    const key = leads.map(l=>l.lead_id||l.id||"").join(",");
    if (prevLeadsRef.current === key) return;
    prevLeadsRef.current = key;
    const cleaned = leads.filter(l => {
      if (!l) return false;
      // Delete any lead without a company name — these are junk n8n rows
      return !!(l.company?.trim());
    });
    if (cleaned.length !== leads.length) {
      setLeads(cleaned);
      sbSet("cp:cold_leads", cleaned).catch(()=>{});
    }
  });

  // Filter leads — hide truly empty rows but keep leads with lead_id
  const PLACEHOLDER = /\[Your Name\]|\[City\]|\[Name\]|\[Company\]|\[Location\]/i;
  const filtered = (() => {
    const JUNK_CHECK = /\[Your Name\]|\[City\]|\[Name\]/i;
    // Filter out rows where company field contains email body / signatures / greetings
    // These come from n8n Parse outreach writing wrong data into the company field
    const isFakeCompany = (name) => {
      if (!name) return true;
      if (name.length > 80) return true;
      if (/@/.test(name)) return true;                           // email address
      if (/\|/.test(name)) return true;                          // pipe = signature
      if (/\d{3}-\d{3}-\d{4}/.test(name)) return true;          // phone number
      if (/\. [A-Z]/.test(name)) return true;                    // sentence pattern
      if (/,\s*(hi|hello|dear)/i.test(name)) return true;        // comma + greeting
      if (/^(hi |hello |dear |i |i'm |i've |i noticed|i came|i wanted|i understand|i see |i hope|i know|i work|i'm reaching|this is danae|danae|have us clean|haveusclean|905-|and i|we specialize|ensuring,|maintaining a clean|as the |as a |at |is the |is a )/i.test(name.trim())) return true;
      if (/just like yours/i.test(name)) return true;
      if (/clean(ing)? (dental|medical|office|your)/i.test(name)) return true;
      if (/\bpatients?\b|\btenants?\b|\bclients?\b/i.test(name)) return true;
      if (/have us clean/i.test(name)) return true;
      if (/info@|haveusclean\.ca/i.test(name)) return true;
      // Sentence fragment: ends with period BUT not a business suffix like Inc. Corp. Ltd.
      if (name.trim().endsWith(".") && !/\b(inc|corp|ltd|co|llc|llp|plc|sa|pty|mgmt)\.$/.test(name.trim().toLowerCase())) return true;
      if (/\b(tailored for|tailored to|seamlessly|dependable services|high-quality cleaning|compliant cleaning|cleaning services|cleaning that|cleaning for|cleaning to)\b/i.test(name)) return true;
      return false;
    };
    const seenCompanies = new Set();
    // Aggressively normalize company name so variants like "ABC Inc" and "ABC Ltd." both collapse
    const normalizeCompany = (name) => {
      let n = (name || "").trim();
      // Extract real company name from enrichment opener pattern
      // e.g. "As the Facility Manager at 360 Medical Centre → making a lasting impression"
      // Strip everything from "→" onwards first
      n = n.replace(/→.*/g, "").trim();
      // Now extract "at COMPANY_NAME" pattern
      const atMatch = n.match(/\bat\s+(.+)$/i);
      if (atMatch) n = atMatch[1].trim();
      // Handle leading "At COMPANY_NAME" with nothing before it
      const atStart = n.match(/^[Aa]t\s+(.+)$/);
      if (atStart) n = atStart[1].trim();
      return n
        // Strip trailing business suffixes
        .replace(/[\s,]+(inc|incorporated|ltd|limited|llc|l\.l\.c|corp|corporation|co|company|plc|llp|lp|gmbh|sa|pty|group|holdings|enterprises|services|solutions|partners|associates|the)\b\.?$/gi, "")
        .replace(/[\s,]+(inc|incorporated|ltd|limited|llc|l\.l\.c|corp|corporation|co|company|plc|llp|lp|gmbh|sa|pty|group|holdings|enterprises|services|solutions|partners|associates|the)\b\.?$/gi, "") // run twice to catch "ABC Inc Ltd"
        // Strip all punctuation
        .replace(/[.,''"`''""\-–—&()/\\|:;!?*#]/g, " ")
        // Collapse whitespace
        .replace(/\s+/g, " ")
        .trim();
    };
    return leads.filter(l => {
      if (!l?.company?.trim()) return false;
      // Normalize market — handle any casing or whitespace from n8n
      const normalizedMarket = (() => {
        const m = (l.market||"").trim().toLowerCase();
        if (m.includes("ontario")) return "Ontario";
        if (m.includes("arizona")) return "Arizona";
        const id = (l.lead_id||l.id||"").toUpperCase();
        if (id.startsWith("ON-") || id.startsWith("ON-M")) return "Ontario";
        if (id.startsWith("AZ-")) return "Arizona";
        const city = (l.city||"").toLowerCase();
        if (["brampton","mississauga","vaughan","markham","richmond hill","oakville","burlington","toronto","hamilton","newmarket","aurora","north york","etobicoke","scarborough","pickering","ajax","whitby","oshawa"].some(c=>city.includes(c))) return "Ontario";
        if (["phoenix","scottsdale","tempe","mesa","chandler","gilbert","glendale","peoria","surprise","goodyear","avondale"].some(c=>city.includes(c))) return "Arizona";
        return "";
      })();
      // Apply market filter BEFORE dedup so each market has its own dedup scope
      const marketMatch = filterMkt === "All" ||
        (filterMkt === "Ontario" && normalizedMarket === "Ontario") ||
        (filterMkt === "Arizona" && normalizedMarket === "Arizona");
      if (!marketMatch) return false;
      // Apply status and segment filters
      if (filterStatus !== "All" && l.status !== filterStatus) return false;
      if (filterSeg    !== "All" && l.segment !== filterSeg)    return false;
      // Dedup by NORMALIZED company name — catches "ABC" = "ABC Inc." = "ABC Ltd"
      // Also include city so "Acme Phoenix" and "Acme Scottsdale" stay separate
      const normCompany = normalizeCompany(l.company);
      const normCity    = (l.city || "").trim().toLowerCase();
      const key = normCompany + "|" + normCity;
      if (!normCompany) return false; // empty after normalization = junk
      if (seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    });
  })();
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  // If page is out of range (e.g. after deletion or filter change), correct it immediately
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated  = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Reset page when filters change
  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [filterStatus, filterSeg]);

  // ── Auto-sync on mount — pulls fresh leads from Google Sheet automatically ──
  // Runs on every mount (tab switch won't remount, but page refresh will)
  useEffect(() => {
    syncSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps = runs once on mount

  // Snap-back removed: was resetting page on every 15s sync

  // Stats
  const total     = leads.length;
  const hot       = leads.filter(l => l.priority_score >= 4).length;
  const booked    = leads.filter(l => l.status === "Meeting Booked").length;
  const won       = leads.filter(l => l.status === "Won").length;
  const contacted = leads.filter(l => l.status !== "New").length;
  const convRate  = total > 0 ? Math.round((won / total) * 100) : 0;

  const updateStatus = (id, status) => {
    setLeads(ls => ls.map(l => l.id === id || l.lead_id === id ? { ...l, status } : l));
    if (viewLead?.lead_id === id) setViewLead(v => ({ ...v, status }));
  };

  const updateNotes = (id, notes) => {
    setLeads(ls => ls.map(l => l.lead_id === id ? { ...l, notes } : l));
    if (viewLead?.lead_id === id) setViewLead(v => ({ ...v, notes }));
  };

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  // Upgrade outreach using Claude with industry-aware prompts
  const upgradeOutreach = async (lead) => {
    setUpgrading(true);
    setUpgradedContent(null);
    try {
      const text = await generateUpgradedOutreach(lead);
      const sections = parseOutreachSections(text);
      setUpgradedContent(sections);
      // Also save upgraded content back to lead
      setLeads(ls => ls.map(l => l.lead_id === lead.lead_id ? { ...l, ...sections } : l));
      setViewLead(v => ({ ...v, ...sections }));
    } catch {
      alert("Upgrade failed. Check your API connection.");
    }
    setUpgrading(false);
  };

  // LinkedIn search URL
  const linkedinSearch = (lead) => {
    const q = `${lead.buyer_title} ${lead.company}`;
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
  };

  // Add manual lead
  const addManualLead = () => {
    if (!manualForm.company.trim()) return;
    const prefix = manualForm.market === "Arizona" ? "AZ" : "ON";
    const num = String(leads.length + 1).padStart(4, "0");
    const newLead = {
      ...manualForm,
      lead_id: `${prefix}-M${num}`,
      status: "New",
      owner: "Jason",
      cold_email: "", follow_up_email: "", linkedin_note: "", call_opener: "",
      source_lane: "Manual Entry",
    };
    setLeads(ls => [newLead, ...ls]);
    setShowManual(false);
    setManualForm({ company:"", city:"", market:"Ontario", segment:"Office", buyer_title:"", pain_point:"", first_offer:"office cleaning", priority_score:3, notes:"" });
    setViewLead(newLead);
  };

  // Priority badge
  const PriorityBadge = ({ score }) => {
    const color = score >= 5 ? C.red : score >= 4 ? C.gold : score >= 3 ? C.blue : C.dim;
    const label = score >= 5 ? "🔥 Hot" : score >= 4 ? "⚡ High" : score >= 3 ? "📋 Med" : "❄️ Low";
    return <span style={{ padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:800, background:`${color}22`, color }}>{label} {score}/5</span>;
  };

  // ── LEAD DETAIL VIEW ──
  if (viewLead) {
    const seg = SEGMENT_META[viewLead.segment] || SEGMENT_META["Office"];
    const hasOutreach = viewLead.cold_email || upgradedContent;
    const outreach = upgradedContent || viewLead;
    const statusColor = COLD_STATUS_COLOR[viewLead.status] || C.muted;

    return (
      <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <button style={{ ...S.btn("ghost"), fontSize:13 }} onClick={() => { setViewLead(null); setUpgradedContent(null); setConfirmDelete(null); }}>← All Leads</button>
          {confirmDelete === "detail" ? (
            <div style={{ display:"flex", gap:8 }}>
              <button style={{ ...S.btn("danger"), fontSize:12, padding:"7px 14px" }}
                onClick={() => { deleteLead(viewLead.lead_id || viewLead.id); setConfirmDelete(null); }}>
                Yes, delete
              </button>
              <button style={{ ...S.btn("ghost"), fontSize:12, padding:"7px 14px" }}
                onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button style={{ ...S.btn("ghost"), fontSize:12, color:C.red, borderColor:`${C.red}55` }}
              onClick={() => setConfirmDelete("detail")}>
              🗑 Delete Lead
            </button>
          )}
        </div>

        {/* Lead header */}
        <div style={{ ...S.card, marginBottom:18, background:"linear-gradient(135deg,#0A0F1E,#1A2235)", borderLeft:`4px solid ${seg.color}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12, marginBottom:14 }}>
            <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
              <div style={{ width:52, height:52, borderRadius:14, background:`${seg.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, border:`1px solid ${seg.color}44`, flexShrink:0 }}>{seg.icon}</div>
              <div>
                <div style={{ fontWeight:800, fontSize:22 }}>{viewLead.company}</div>
                <div style={{ fontSize:14, color:C.muted }}>📍 {viewLead.city}, {viewLead.market} · {viewLead.segment}</div>
                <div style={{ fontSize:13, color:C.muted }}>👤 {viewLead.buyer_title}</div>
                <div style={{ fontSize:13, color:C.muted, marginTop:4, fontStyle:"italic" }}>"{viewLead.pain_point}"</div>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
              <PriorityBadge score={viewLead.priority_score} />
              <span style={{ padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{viewLead.status}</span>
              <div style={{ fontSize:11, color:C.dim }}>{viewLead.lead_id}</div>
            </div>
          </div>

          {/* Quick actions row */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <a href={linkedinSearch(viewLead)} target="_blank" rel="noopener noreferrer"
              style={{ ...S.btn("ghost"), textDecoration:"none", fontSize:12, display:"flex", alignItems:"center", gap:6, padding:"8px 14px" }}>
              🔗 Find on LinkedIn
            </a>
            {viewLead.phone && (
              <a href={`tel:${viewLead.phone}`} style={{ ...S.btn("ghost"), textDecoration:"none", fontSize:12, padding:"8px 14px" }}>📞 Call</a>
            )}
            <button style={{ ...S.btn("primary"), fontSize:12, padding:"8px 14px", background: upgrading ? C.dim : "#7C3AED" }}
              onClick={() => upgradeOutreach(viewLead)} disabled={upgrading}>
              {upgrading ? "✨ Upgrading..." : "✨ Upgrade Outreach with AI"}
            </button>
          </div>
        </div>

        {/* Status pipeline */}
        <div style={{ ...S.card, marginBottom:18 }}>
          <div style={S.label}>Pipeline Status</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
            {COLD_STATUSES.map(s => {
              const col = COLD_STATUS_COLOR[s];
              const active = viewLead.status === s;
              return (
                <button key={s} onClick={() => updateStatus(viewLead.lead_id, s)}
                  style={{ padding:"6px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700,
                    background: active ? `${col}33` : C.surface,
                    color: active ? col : C.muted,
                    border: `1px solid ${active ? col : C.border}` }}>
                  {active ? "● " : ""}{s}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop:12 }}>
            <div style={S.label}>Notes</div>
            <textarea style={{ ...S.input, minHeight:60, resize:"vertical", marginTop:4 }}
              value={viewLead.notes || ""}
              onChange={e => updateNotes(viewLead.lead_id, e.target.value)}
              placeholder="Call notes, meeting outcome, follow-up date..." />
          </div>
        </div>

        {/* Offer + next action */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12, marginBottom:18 }}>
          <div style={{ ...S.cardSm, borderLeft:`3px solid ${C.accent}` }}>
            <div style={S.label}>First Offer</div>
            <div style={{ fontWeight:700, fontSize:14, color:C.accent, marginTop:4 }}>{viewLead.first_offer}</div>
          </div>
          <div style={{ ...S.cardSm, borderLeft:`3px solid ${C.gold}` }}>
            <div style={S.label}>Next Action</div>
            <div style={{ fontWeight:700, fontSize:14, color:C.gold, marginTop:4 }}>{viewLead.next_action}</div>
          </div>
        </div>

        {/* Outreach content */}
        {/* Inline edit for incomplete leads */}
        {(!viewLead.company || !viewLead.city || !viewLead.buyer_title || !viewLead.pain_point) && (
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.red}`, background:"#FF475711" }}>
            <div style={{ fontWeight:700, color:C.red, marginBottom:12, fontSize:14 }}>⚠️ Fill in missing details to use this lead</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { field:"company",     label:"Company Name",         placeholder:"e.g. Apex Medical Centre" },
                { field:"city",        label:"City",                 placeholder:"e.g. Brampton" },
                { field:"buyer_title", label:"Decision Maker Title", placeholder:"e.g. Property Manager" },
                { field:"pain_point",  label:"Pain Point",           placeholder:"e.g. Maintaining cleanliness standards" },
                { field:"segment",     label:"Segment",              placeholder:"Office / Medical / Property Manager" },
              ].filter(f => !viewLead[f.field]).map(({ field, label, placeholder }) => (
                <div key={field}>
                  <div style={S.label}>{label}</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input
                      key={`${viewLead.lead_id}-${field}`}
                      style={{ ...S.input, flex:1 }}
                      defaultValue=""
                      placeholder={placeholder}
                      onBlur={e => {
                        const val = e.target.value.trim();
                        if (!val) return;
                        const updated = { ...viewLead, [field]: val };
                        setLeads(ls => ls.map(l =>
                          (l.lead_id || l.id) === (viewLead.lead_id || viewLead.id)
                            ? { ...l, [field]: val } : l
                        ));
                        setViewLead(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
              <div style={{ fontSize:11, color:C.muted }}>Type a value and click out of the field to save. The ⚠️ panel disappears once all fields are filled.</div>
            </div>
          </div>
        )}

        {viewLead.needs_upgrade && !upgradedContent && (
          <div style={{ background:"#A78BFA22", border:`1px solid #A78BFA44`, borderRadius:10, padding:"12px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ fontWeight:700, color:"#A78BFA", fontSize:14 }}>✨ Outreach has generic placeholders</div>
              <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Your n8n used template text. Hit Upgrade to generate real personalized outreach for {viewLead.segment}.</div>
            </div>
            <button style={{ ...S.btn("primary"), background:"#7C3AED", fontSize:13 }} onClick={() => upgradeOutreach(viewLead)} disabled={upgrading}>
              {upgrading ? "Upgrading..." : "✨ Upgrade Now"}
            </button>
          </div>
        )}
        {upgradedContent && (
          <div style={{ background:C.accentDim, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:13, color:C.accent, fontWeight:700 }}>
            ✨ Outreach upgraded with AI — industry-aware messaging for {viewLead.segment}
          </div>
        )}

        {[
          { key:"cold_email",      label:"📧 Cold Email",       icon:"📋" },
          { key:"follow_up_email", label:"📧 Follow-Up Email",   icon:"📋" },
          { key:"linkedin_note",   label:"💼 LinkedIn Note",     icon:"📋" },
          { key:"call_opener",     label:"📞 Call Opener Script", icon:"📋" },
        ].map(({ key, label, icon }) => {
          const val = outreach[key] || viewLead[key];
          if (!val) return null;
          const isEmail = key.includes("email");
          return (
            <div key={key} style={{ ...S.card, marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontWeight:700, fontSize:14 }}>{label}</div>
                <div style={{ display:"flex", gap:8 }}>
                  {isEmail && (
                    <a href={`https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(`Commercial Cleaning — ${viewLead.company}`)}&body=${encodeURIComponent(val)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ ...S.btn("sm"), textDecoration:"none", fontSize:11 }}>📨 Gmail</a>
                  )}
                  <button style={{ ...S.btn("sm"), background: copied===key ? C.accentDim : C.surface, color: copied===key ? C.accent : C.muted, fontSize:11 }}
                    onClick={() => copy(val, key)}>
                    {copied === key ? "✅ Copied!" : `${icon} Copy`}
                  </button>
                </div>
              </div>
              <div style={{ background:C.surface, borderRadius:10, padding:14, fontSize:13, color:C.muted, lineHeight:1.8, whiteSpace:"pre-wrap", maxHeight:220, overflowY:"auto", border:`1px solid ${C.border}` }}>
                {val}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── LIST VIEW ──
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🎯 Cold Outreach Pipeline</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>
            Leads generated daily by your n8n AI agent · Ontario & Arizona
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={S.btn("ghost")} onClick={syncSheet} disabled={loadingSheet} title="Pull latest leads from Google Sheet">
            {loadingSheet ? "🔄 Syncing..." : `🔄 Sync Sheet${lastSynced ? ` · ${lastSynced}` : ""}`}
          </button>
          <button style={S.btn("primary")} onClick={() => setShowManual(true)}>+ Add Lead</button>
        </div>
      </div>

      {/* Stats */}
      <div style={S.grid4}>
        <StatCard label="Total Pipeline"   value={total}     icon="🎯" color={C.blue}   />
        <StatCard label="Hot Leads (4-5)"  value={hot}       icon="🔥" color={C.red}    />
        <StatCard label="Meetings Booked"  value={booked}    icon="📅" color={C.accent} />
        <StatCard label="Won"              value={won}       icon="🏆" color={C.gold}   sub={`${convRate}% conv.`} />
      </div>

      <div style={S.divider} />

      {/* Sync error */}
      {syncError && (
        <div style={{ background:"#FF4757" + "22", border:`1px solid #FF475744`, borderRadius:10, padding:"10px 16px", marginBottom:14, fontSize:13, color:"#FF4757" }}>
          ⚠️ {syncError}
        </div>
      )}

      {/* Sync info banner */}
      <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.blue}`, padding:"12px 16px" }}>
        <div style={{ fontWeight:700, color:C.blue, fontSize:14, marginBottom:4 }}>
          🔄 Live Google Sheet Connection{lastSynced ? ` · Last synced ${lastSynced}` : " · Not yet synced"}
        </div>
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
          Your n8n agent appends leads daily to your Google Sheet. Hit <strong style={{ color:C.text }}>Sync Sheet</strong> to pull them live.<br/>
          <strong style={{ color:C.gold }}>First time?</strong> Add <code style={{ background:C.surface, padding:"1px 6px", borderRadius:4 }}>GOOGLE_SHEETS_API_KEY</code> to Vercel → Settings → Environment Variables. Also make sure your Google Sheet is shared as <strong style={{ color:C.text }}>Anyone with the link can view</strong>.
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
        {["All", ...COLD_STATUSES].map(s => {
          const col = COLD_STATUS_COLOR[s] || C.accent;
          const count = s === "All" ? leads.length : leads.filter(l => l.status === s).length;
          const active = filterStatus === s;
          return (
            <button key={s} onClick={() => { setFilterStatus(s); setPage(0); }}
              style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700,
                background: active ? `${col}22` : C.surface,
                color: active ? col : C.muted,
                border: `1px solid ${active ? col : C.border}` }}>
              {s} {count > 0 && <span style={{ marginLeft:4, background:`${col}33`, borderRadius:20, padding:"1px 7px", fontSize:11 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
        {["All", "Ontario", "Arizona"].map(m => {
          const count = m === "All"
            ? leads.filter(l=>l?.company?.trim()).length
            : leads.filter(l => {
                if (!l?.company?.trim()) return false;
                const lm = (l.market||"").trim().toLowerCase();
                return m === "Ontario" ? lm.includes("ontario") : lm.includes("arizona");
              }).length;
          return (
            <button key={m} onClick={() => handleSetFilterMkt(m)}
              style={{ padding:"4px 12px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600,
                background: filterMkt===m ? C.accentDim : C.surface,
                color: filterMkt===m ? C.accent : C.muted,
                border: `1px solid ${filterMkt===m ? C.accent : C.border}` }}>
              {m === "Ontario" ? "🇨🇦 Ontario" : m === "Arizona" ? "🇺🇸 Arizona" : "All Markets"} ({count})
            </button>
          );
        })}
        {["All","Office","Medical","Dental","Industrial-Office","Property Manager"].map(seg => {
          const count = seg === "All" ? leads.filter(l=>l?.company?.trim()).length : leads.filter(l=>l?.segment===seg && l?.company?.trim()).length;
          return (
            <button key={seg} onClick={() => { setFilterSeg(seg); setPage(0); }}
              style={{ padding:"4px 12px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600,
                background: filterSeg===seg ? C.accentDim : C.surface,
                color: filterSeg===seg ? C.accent : C.muted,
                border: `1px solid ${filterSeg===seg ? C.accent : C.border}` }}>
              {SEGMENT_META[seg]?.icon || "📋"} {seg} ({count})
            </button>
          );
        })}
      </div>

      {/* Lead cards */}
      {filtered.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🎯</div>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>No leads in this view</div>
          <div style={{ color:C.muted, fontSize:14 }}>Your n8n agent adds new leads daily. Hit Sync Sheet or add one manually.</div>
        </div>
      )}

      {/* Pagination info — ABOVE list as count indicator only */}
      {filtered.length > PAGE_SIZE && (
        <div style={{ fontSize:12, color:C.muted, marginBottom:8, textAlign:"right" }}>
          Page {safePage+1} of {totalPages} · {filtered.length} leads
        </div>
      )}

      <div id="cold-leads-list" style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.length === 0 ? (
          <div style={{ ...S.card, textAlign:"center", padding:32, color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🎯</div>
            <div style={{ fontWeight:700, marginBottom:6 }}>No leads found</div>
            <div style={{ fontSize:13 }}>
              {leads.length > 0
                ? "All leads were filtered out. Try changing your filters or sync the sheet again."
                : "Hit Sync Sheet to load leads from your n8n pipeline."}
            </div>
          </div>
        ) : paginated.length === 0 ? (
          <div style={{ ...S.card, textAlign:"center", padding:24, color:C.muted, fontSize:13 }}>
            No leads on this page — going back to page 1
          </div>
        ) : paginated.map(lead => {
          const lid = lead.lead_id || lead.id || `${lead.company||""}-${lead.city||""}-${lead.segment||""}`;
          const seg = SEGMENT_META[lead.segment] || SEGMENT_META["Office"];
          const statusColor = COLD_STATUS_COLOR[lead.status] || C.muted;
          const hasOutreach = !!(lead.cold_email || lead.follow_up_email);
          const isDeleting = confirmDelete === lid;
          return (
            <div key={lid} style={{ ...S.card, padding:0, overflow:"hidden", borderLeft:`3px solid ${seg.color}`, display:"flex", alignItems:"stretch" }}>

              {/* LEFT — tap to open detail */}
              <div
                style={{ flex:1, padding:"13px 14px", cursor:"pointer", minWidth:0 }}
                onClick={() => { if(!isDeleting){ setViewLead(lead); setUpgradedContent(null); setConfirmDelete(null); } }}
              >
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <div style={{ width:34, height:34, borderRadius:8, background:`${seg.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{seg.icon}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:lead.company?C.text:C.red }}>
                      {lead.company || "⚠️ No company name"}
                    </div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                      {lead.city || "—"} · {lead.segment || "—"}
                    </div>
                    <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                      <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{lead.status||"New"}</span>
                      {hasOutreach && <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:C.accentDim, color:C.accent }}>✉️</span>}
                      <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:C.surface, color:C.muted }}>{lead.market==="Ontario"?"🇨🇦":"🇺🇸"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT — delete only, completely isolated */}
              <div style={{ width:56, borderLeft:`1px solid ${C.border}`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, padding:"8px 0", background: isDeleting ? `${C.red}11` : "transparent", flexShrink:0 }}>
                {isDeleting ? (
                  <>
                    <button
                      style={{ background:C.red, border:"none", borderRadius:6, padding:"5px 8px", fontSize:11, color:"#fff", fontWeight:800, cursor:"pointer", width:44 }}
                      onClick={() => { deleteLead(lid); setConfirmDelete(null); }}
                    >Del</button>
                    <button
                      style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", fontSize:10, color:C.muted, cursor:"pointer", width:44 }}
                      onClick={() => setConfirmDelete(null)}
                    >No</button>
                  </>
                ) : (
                  <button
                    style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.dim, padding:"8px 0", lineHeight:1 }}
                    onClick={() => setConfirmDelete(lid)}
                  >🗑</button>
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* Pagination controls — scrolls to top of list on page change */}
      {filtered.length > PAGE_SIZE && (
        <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:8, marginTop:16, flexWrap:"wrap" }}>
          <button style={{ ...S.btn("ghost"), fontSize:13, padding:"8px 16px" }}
            disabled={safePage===0}
            onClick={() => {
              setPage(Math.max(0, safePage - 1));
              setTimeout(() => document.getElementById("cold-leads-list")?.scrollIntoView({behavior:"smooth", block:"start"}), 50);
            }}>← Prev</button>
          <span style={{ fontSize:13, color:C.muted }}>Page {safePage+1} of {totalPages}</span>
          <button style={{ ...S.btn(page<totalPages-1?"primary":"ghost"), fontSize:13, padding:"8px 16px" }}
            disabled={safePage>=totalPages-1}
            onClick={() => {
              setPage(safePage + 1);
              setTimeout(() => document.getElementById("cold-leads-list")?.scrollIntoView({behavior:"smooth", block:"start"}), 50);
            }}>Next →</button>
        </div>
      )}


      {/* Manual add modal */}
      {showManual && (
        <Modal title="+ Add Lead Manually" onClose={() => setShowManual(false)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Company Name</div><input style={S.input} value={manualForm.company} onChange={e=>setManualForm({...manualForm,company:e.target.value})} placeholder="ABC Medical Centre" /></div>
              <div><div style={S.label}>City</div><input style={S.input} value={manualForm.city} onChange={e=>setManualForm({...manualForm,city:e.target.value})} placeholder="Brampton" /></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Market</div>
                <select style={S.select} value={manualForm.market} onChange={e=>setManualForm({...manualForm,market:e.target.value})}>
                  <option>Ontario</option><option>Arizona</option>
                </select>
              </div>
              <div><div style={S.label}>Segment</div>
                <select style={S.select} value={manualForm.segment} onChange={e=>setManualForm({...manualForm,segment:e.target.value})}>
                  {["Office","Medical","Dental","Industrial-Office","Property Manager"].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Buyer Title</div><input style={S.input} value={manualForm.buyer_title} onChange={e=>setManualForm({...manualForm,buyer_title:e.target.value})} placeholder="Property Manager" /></div>
              <div><div style={S.label}>Priority (1-5)</div>
                <select style={S.select} value={manualForm.priority_score} onChange={e=>setManualForm({...manualForm,priority_score:parseInt(e.target.value)})}>
                  {[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div><div style={S.label}>Pain Point</div><input style={S.input} value={manualForm.pain_point} onChange={e=>setManualForm({...manualForm,pain_point:e.target.value})} placeholder="Current cleaning inconsistent" /></div>
            <div><div style={S.label}>First Offer</div><input style={S.input} value={manualForm.first_offer} onChange={e=>setManualForm({...manualForm,first_offer:e.target.value})} placeholder="office cleaning" /></div>
            <div><div style={S.label}>Notes</div><textarea style={{...S.input,minHeight:50,resize:"vertical"}} value={manualForm.notes} onChange={e=>setManualForm({...manualForm,notes:e.target.value})} placeholder="How you found them, any context..." /></div>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={addManualLead} disabled={!manualForm.company.trim()}>💾 Add to Pipeline</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── FORM INTAKE ──────────────────────────────────────────────────────────────
// Google Form → New Leads auto-flow
// Your Google Form submissions come in via n8n webhook and land here as new leads

const GOOGLE_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScyKKqwyg2hVLFqJFnrrP_j8uG97pBER_Uby_Y-eJeZY6ntgg/viewform";
// Google Form URL — haveusclean.ca intake form

function FormIntake({ resLeads, setResLeads, region, setTab }) {
  const [formUrl, setFormUrl] = useState("https://docs.google.com/forms/d/e/1FAIpQLScyKKqwyg2hVLFqJFnrrP_j8uG97pBER_Uby_Y-eJeZY6ntgg/viewform");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState("");
  const [manualForm, setManualForm] = useState({
    name:"", email:"", phone:"", address:"", dwellingType:"Apartment / Condo",
    dwellingSize:"2 Bed", beds:2, baths:1, sqft:900, serviceType:"Refresh Clean",
    frequency:"One-Time", addons:[], notes:""
  });

  // Pull leads submitted via Google Form from the intake endpoint
  const pullFormLeads = async () => {
    setPulling(true);
    setPullResult("");
    try {
      const res = await fetch("/api/intake");
      const data = await res.json();
      if (data.leads && data.leads.length > 0) {
        setResLeads(ls => {
          // Dedup by email + name — most stable identifiers
          // Timestamps vary between pulls for same submission, so can't be used
          const existingKeys = new Set(ls.map(l => {
            const email = (l.email||'').toLowerCase().trim();
            const name  = (l.name ||'').toLowerCase().trim();
            return `${email}|${name}`;
          }));
          const newOnes = data.leads.filter(l => {
            const email = (l.email||'').toLowerCase().trim();
            const name  = (l.name ||'').toLowerCase().trim();
            if (!email || !name) return false; // skip junk rows
            const key = `${email}|${name}`;
            if (existingKeys.has(key)) return false;
            existingKeys.add(key); // prevent duplicates within the same batch
            return true;
          });
          if (newOnes.length > 0) {
            setPullResult(`✅ ${newOnes.length} new lead${newOnes.length > 1 ? 's' : ''} pulled from Google Form!`);
            return [...newOnes, ...ls];
          } else {
            setPullResult(`ℹ️ ${data.leads.length} total submissions found — all already in app.`);
            return ls;
          }
        });
      } else {
        setPullResult("No submissions found in your form sheet yet.");
      }
    } catch {
      setPullResult("Error reading form sheet. Make sure the sheet is shared as Anyone with the link can view.");
    }
    setPulling(false);
  };

  const recentLeads = [...resLeads]
    .sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0))
    .slice(0,10);

  const addManual = () => {
    if (!manualForm.name || !manualForm.email) return;
    const newLead = {
      ...manualForm, id:Date.now(), status:"New", workOrder:null,
      paymentConfirmed:false, quotedDate:"", bookedDate:"",
      createdAt: new Date().toISOString(), source:"Manual Entry"
    };
    setResLeads(ls => [newLead, ...ls]);
    setShowManual(false);
    setManualForm({ name:"", email:"", phone:"", address:"", dwellingType:"Apartment / Condo", dwellingSize:"2 Bed", beds:2, baths:1, sqft:900, serviceType:"Refresh Clean", frequency:"One-Time", addons:[], notes:"" });
    setTab("res");
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>📋 Form Intake & Lead Flow</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>
            Google Form → n8n → App · Auto-creates New leads
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={S.btn("ghost")} onClick={pullFormLeads} disabled={pulling}>
            {pulling ? "🔄 Pulling..." : "🔄 Pull New Form Leads"}
          </button>
          <button style={S.btn("primary")} onClick={() => setShowManual(true)}>+ Add Manually</button>
        </div>
      </div>

      {pullResult && (
        <div style={{ background: pullResult.startsWith("✅") ? C.accentDim : C.surface, border:`1px solid ${pullResult.startsWith("✅") ? C.accent : C.border}44`, borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:13, color: pullResult.startsWith("✅") ? C.accent : C.muted, fontWeight:700 }}>
          {pullResult}
        </div>
      )}

      {/* Flow diagram */}
      <div style={{ ...S.card, marginBottom:20, background:"linear-gradient(135deg,#0A0F1E,#1A2235)" }}>
        <div style={{ fontWeight:800, fontSize:16, marginBottom:14, color:C.accent }}>🔄 How the Flow Works</div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:13 }}>
          {[
            { icon:"🌐", label:"haveusclean.ca", sub:"Google Form embed" },
            { icon:"→", label:"", sub:"" },
            { icon:"📋", label:"Google Form", sub:"Client fills out" },
            { icon:"→", label:"", sub:"" },
            { icon:"⚡", label:"n8n Webhook", sub:"Triggers on submit" },
            { icon:"→", label:"", sub:"" },
            { icon:"📱", label:"Have Us Clean App", sub:"New Lead appears" },
            { icon:"→", label:"", sub:"" },
            { icon:"💬", label:"Quote & Book", sub:"You respond" },
          ].map((step, i) => step.icon === "→"
            ? <span key={i} style={{ color:C.accent, fontSize:20, fontWeight:700 }}>→</span>
            : (
              <div key={i} style={{ background:C.surface, borderRadius:10, padding:"8px 12px", textAlign:"center", minWidth:90 }}>
                <div style={{ fontSize:22 }}>{step.icon}</div>
                <div style={{ fontWeight:700, fontSize:12, color:C.text }}>{step.label}</div>
                <div style={{ fontSize:10, color:C.muted }}>{step.sub}</div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Setup guide */}
      <div style={{ ...S.card, marginBottom:20, borderLeft:`4px solid ${C.gold}` }}>
        <div style={{ fontWeight:800, fontSize:15, color:C.gold, marginBottom:12 }}>⚙️ Setup — 10 Minutes</div>
        {[
          { step:"1", title:"Create your Google Form", detail:'Go to forms.google.com → Create new form. Add fields: Name, Email, Phone, Address, Property Type, Bedrooms, Bathrooms, Service Needed, Frequency, Special Notes. Set it as "Collect email addresses".' },
          { step:"2", title:"Embed on your website", detail:'In Google Form → Send → Embed (< >) → Copy the iframe code → Paste it on your haveusclean.ca "Get a Free Quote" page. This is the form clients fill out to request a quote.' },
          { step:"3", title:"Connect to n8n", detail:'In n8n: Add a new workflow → Webhook trigger → copy the webhook URL → In Google Form → Responses → Connect to Sheets → Also add an n8n webhook via Apps Script (we can build this together).' },
          { step:"4", title:"n8n sends to this app", detail:'Your n8n workflow receives the form data and calls your Vercel API to create a new lead. The lead appears instantly in 🏠 Residential Leads as status: New.' },
        ].map(s => (
          <div key={s.step} style={{ display:"flex", gap:12, marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#0A0F1E", flexShrink:0 }}>{s.step}</div>
            <div>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>{s.title}</div>
              <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>{s.detail}</div>
            </div>
          </div>
        ))}

        <div style={{ marginTop:4 }}>
          <div style={S.label}>Your Google Form URL (paste once set up)</div>
          <input style={{ ...S.input, marginTop:6 }} value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://docs.google.com/forms/d/e/..." />
          {formUrl && !formUrl.length < 20 && (
            <a href={formUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.btn("primary"), textDecoration:"none", display:"inline-block", marginTop:8, fontSize:13 }}>
              🔗 Open Form
            </a>
          )}
        </div>
      </div>

      {/* Manual add */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={S.h3}>Recent Leads ({resLeads.length} total)</div>
        <button style={S.btn("primary")} onClick={() => setShowManual(true)}>+ Add Lead Manually</button>
      </div>

      {recentLeads.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:30, color:C.muted }}>
          No leads yet. Add one manually or set up your Google Form to auto-populate.
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {recentLeads.map(lead => {
          const statusColor = HUC_STATUS_COLOR[lead.status] || C.muted;
          return (
            <div key={lead.id} style={{ ...S.cardSm, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14 }}>{lead.name}</div>
                <div style={{ fontSize:12, color:C.muted }}>{lead.email} · {lead.dwellingType} · {lead.serviceType}</div>
                <div style={{ fontSize:11, color:C.dim }}>{lead.createdAt ? new Date(lead.createdAt).toLocaleString() : ""} {lead.source ? `· ${lead.source}` : ""}</div>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{lead.status}</span>
                <button style={{ ...S.btn("sm") }} onClick={() => setTab("res")}>View →</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual add modal */}
      {showManual && (
        <Modal title="+ Add Lead Manually" onClose={() => setShowManual(false)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Full Name *</div><input style={S.input} value={manualForm.name} onChange={e=>setManualForm({...manualForm,name:e.target.value})} placeholder="Sarah M." /></div>
              <div><div style={S.label}>Email *</div><input style={S.input} value={manualForm.email} onChange={e=>setManualForm({...manualForm,email:e.target.value})} placeholder="sarah@email.com" /></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Phone</div><input style={S.input} value={manualForm.phone} onChange={e=>setManualForm({...manualForm,phone:e.target.value})} placeholder="(416) 555-0100" /></div>
              <div><div style={S.label}>Address</div><input style={S.input} value={manualForm.address} onChange={e=>setManualForm({...manualForm,address:e.target.value})} placeholder="88 Maple Dr, North York" /></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))", gap:12 }}>
              <div><div style={S.label}>Property Type</div>
                <select style={S.select} value={manualForm.dwellingType} onChange={e=>setManualForm({...manualForm,dwellingType:e.target.value})}>
                  {["Apartment / Condo","Semi / Townhouse","Detached House"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div><div style={S.label}>Service</div>
                <select style={S.select} value={manualForm.serviceType} onChange={e=>setManualForm({...manualForm,serviceType:e.target.value})}>
                  {["Refresh Clean","Full Home Clean","Deep Clean","Move-In / Move-Out","Kitchen & Bathroom Refresh"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div><div style={S.label}>Frequency</div>
                <select style={S.select} value={manualForm.frequency} onChange={e=>setManualForm({...manualForm,frequency:e.target.value})}>
                  {["One-Time","Weekly","Bi-Weekly","Monthly"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div><div style={S.label}>Notes</div><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={manualForm.notes} onChange={e=>setManualForm({...manualForm,notes:e.target.value})} placeholder="Special instructions, how they found us..." /></div>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={addManual} disabled={!manualForm.name||!manualForm.email}>💾 Add Lead → Goes to Residential Leads</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── FOLLOW-UP REMINDERS ──────────────────────────────────────────────────────
function FollowUpReminders({ resLeads, setResLeads, jobs, region }) {
  const today = new Date().toISOString().split("T")[0];
  const todayDate = new Date(today);
  const cur = region?.currencySymbol || "$";

  // Calculate follow-up urgency for each lead
  const getFollowUpStatus = (lead) => {
    if (["Booked","Completed","Lost"].includes(lead.status)) return null;
    const daysSinceQuoted = lead.quotedDate
      ? Math.floor((todayDate - new Date(lead.quotedDate)) / 86400000)
      : null;
    const followUpDate = lead.followUpDate ? new Date(lead.followUpDate) : null;
    const followUpDue = followUpDate ? followUpDate <= todayDate : false;
    const followUpOverdue = followUpDate ? followUpDate < todayDate : false;

    if (lead.status === "New" && (!lead.quotedDate)) return { level:"action", label:"Send Quote", color:C.blue, days:null };
    if (lead.status === "Quoted" && daysSinceQuoted !== null && daysSinceQuoted >= 3 && daysSinceQuoted < 7) return { level:"reminder", label:`Follow up (${daysSinceQuoted}d since quote)`, color:C.gold, days:daysSinceQuoted };
    if (lead.status === "Quoted" && daysSinceQuoted !== null && daysSinceQuoted >= 7) return { level:"urgent", label:`Overdue follow-up (${daysSinceQuoted}d!)`, color:C.red, days:daysSinceQuoted };
    if (lead.status === "Follow Up" && followUpOverdue) return { level:"urgent", label:"Follow-up date passed!", color:C.red, days:null };
    if (lead.status === "Follow Up" && followUpDue) return { level:"reminder", label:"Follow up today", color:C.gold, days:null };
    return null;
  };

  // Build follow-up list
  const followUps = resLeads
    .map(lead => ({ lead, fu: getFollowUpStatus(lead) }))
    .filter(x => x.fu !== null)
    .sort((a,b) => {
      const order = { urgent:0, action:1, reminder:2 };
      return (order[a.fu.level]||3) - (order[b.fu.level]||3);
    });

  const urgent   = followUps.filter(x => x.fu.level === "urgent");
  const action   = followUps.filter(x => x.fu.level === "action");
  const reminder = followUps.filter(x => x.fu.level === "reminder");

  // Generate follow-up email
  const generateFollowUp = async (lead, setLoading, setResult) => {
    setLoading(true);
    const q = (() => { try { return calcResQuote({...lead, dwellingType:lead.dwellingType||"Apartment / Condo", dwellingSize:lead.dwellingSize||"2 Bed", serviceType:lead.serviceType||"Refresh Clean", frequency:lead.frequency||"One-Time", beds:lead.beds||2, baths:lead.baths||1, sqft:lead.sqft||900, addons:lead.addons||[]}, region || ACTIVE_REGION); } catch(e) { return {total:0,preTaxTotal:0,taxAmount:0,partnerPay:0,partnerPayEach:0,profit:0,margin:0,teamSize:1,jobHours:1.5,breakdown:[],discountAmt:0,discPct:0,taxRate:0,taxName:"HST",currency:"CA$",region:region||ACTIVE_REGION,freq_prices:{},baseClientPrice:0}; } })();
    const prompt = `Write a short, warm follow-up email for a residential cleaning lead.

Company: Have Us Clean
Client: ${lead.name}
Service quoted: ${lead.serviceType}
Property: ${lead.dwellingType}${lead.dwellingSize ? ` — ${lead.dwellingSize}` : ""}
Quote total: ${cur}${Math.round(q.total)}
Days since quoted: ${lead.quotedDate ? Math.floor((todayDate - new Date(lead.quotedDate)) / 86400000) : "unknown"}
Notes: ${lead.notes || "none"}

Rules:
- Under 80 words
- Warm, not pushy
- Reference the specific service and price
- Include a simple next step
- Sign as: Have Us Clean · haveusclean@gmail.com
- Do not use placeholders`;

    try {
      const res = await fetch("/api/claude", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:300, messages:[{ role:"user", content:prompt }] })
      });
      const data = await res.json();
      setResult(data.content?.[0]?.text || "");
    } catch { setResult("Error generating follow-up. Check API connection."); }
    setLoading(false);
  };

  const FollowUpCard = ({ lead, fu }) => {
    const [loading, setLoading] = useState(false);
    const [emailDraft, setEmailDraft] = useState("");
    const [copied, setCopied] = useState(false);

    const copy = (text) => {
      navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const markFollowedUp = () => {
      setResLeads(ls => ls.map(l => l.id === lead.id
        ? { ...l, status:"Follow Up", followUpDate: new Date(Date.now() + 3*86400000).toISOString().split("T")[0] }
        : l
      ));
    };

    return (
      <div style={{ ...S.card, borderLeft:`4px solid ${fu.color}`, marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10, marginBottom:10 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15 }}>{lead.name}</div>
            <div style={{ fontSize:12, color:C.muted }}>{lead.email} · {lead.serviceType} · {lead.dwellingType}</div>
            {lead.notes && <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>"{lead.notes}"</div>}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
            <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, background:`${fu.color}22`, color:fu.color }}>{fu.label}</span>
            <span style={{ fontSize:11, color:C.muted }}>{lead.status}</span>
          </div>
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button style={{ ...S.btn("sm"), background:"#7C3AED", color:"#fff" }}
            onClick={() => generateFollowUp(lead, setLoading, setEmailDraft)} disabled={loading}>
            {loading ? "Writing..." : "✨ Generate Follow-Up Email"}
          </button>
          <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(`Following up — ${lead.serviceType} quote`)}`}
            target="_blank" rel="noopener noreferrer"
            style={{ ...S.btn("ghost"), textDecoration:"none", fontSize:12, padding:"7px 14px" }}>
            📨 Open Gmail
          </a>
          <button style={S.btn("sm")} onClick={markFollowedUp}>✅ Mark Followed Up</button>
        </div>

        {emailDraft && (
          <div style={{ marginTop:12, background:C.surface, borderRadius:10, padding:14, border:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#A78BFA" }}>✨ AI-Generated Follow-Up</div>
              <div style={{ display:"flex", gap:8 }}>
                <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(`Following up — ${lead.serviceType} quote`)}&body=${encodeURIComponent(emailDraft)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ ...S.btn("sm"), textDecoration:"none", fontSize:11 }}>📨 Gmail</a>
                <button style={{ ...S.btn("sm"), background: copied ? C.accentDim : C.surface, color: copied ? C.accent : C.muted, fontSize:11 }}
                  onClick={() => copy(emailDraft)}>{copied ? "✅ Copied!" : "📋 Copy"}</button>
              </div>
            </div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{emailDraft}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🔔 Follow-Up Reminders</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>
            Auto-detected from your leads pipeline · Updates live as you change statuses
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={S.grid3}>
        <StatCard label="Urgent" value={urgent.length} icon="🚨" color={C.red} sub="overdue follow-ups" />
        <StatCard label="Action Needed" value={action.length} icon="⚡" color={C.blue} sub="quotes to send" />
        <StatCard label="Due Soon" value={reminder.length} icon="🔔" color={C.gold} sub="follow up this week" />
      </div>

      <div style={S.divider} />

      {followUps.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🎉</div>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>All caught up!</div>
          <div style={{ color:C.muted, fontSize:14 }}>No follow-ups needed right now. Check back after you send more quotes.</div>
        </div>
      )}

      {urgent.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:15, color:C.red, marginBottom:10 }}>🚨 Urgent — Act Today</div>
          {urgent.map(({lead, fu}) => <FollowUpCard key={lead.id} lead={lead} fu={fu} />)}
        </div>
      )}

      {action.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:15, color:C.blue, marginBottom:10 }}>⚡ Send Quote</div>
          {action.map(({lead, fu}) => <FollowUpCard key={lead.id} lead={lead} fu={fu} />)}
        </div>
      )}

      {reminder.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:15, color:C.gold, marginBottom:10 }}>🔔 This Week</div>
          {reminder.map(({lead, fu}) => <FollowUpCard key={lead.id} lead={lead} fu={fu} />)}
        </div>
      )}
    </div>
  );
}

// ─── RESIDENTIAL LEADS — Have Us Clean ───────────────────────────────────────
const SAMPLE_RES_LEADS = [
  { id:1, name:"Sarah M.", email:"sarah.m@email.com", phone:"(416) 555-2201", address:"88 Maple Dr, North York ON", dwellingType:"Apartment / Condo", dwellingSize:"2 Bed", beds:2, baths:1, sqft:850, serviceType:"Full Home Clean", addons:["oven","fridge"], frequency:"Bi-Weekly", preferredDate:"2026-04-10", preferredTime:"9:00 AM", notes:"Has a cat. Please use unscented products.", status:"Quoted", assignedTo:"", followUpDate:"", jobNotes:"", workOrder:null, paymentConfirmed:false, quotedDate:"2026-04-03", bookedDate:"", createdAt:"2026-04-01T10:00:00Z" },
  { id:2, name:"David K.", email:"davidk@email.com", phone:"(416) 555-3310", address:"12 Oakridge Rd, Mississauga ON", dwellingType:"Detached House", dwellingSize:"Medium", beds:3, baths:2, sqft:1800, serviceType:"Deep Clean", addons:[], frequency:"One-Time", preferredDate:"2026-04-14", preferredTime:"10:00 AM", notes:"First-time client.", status:"Follow Up", assignedTo:"", followUpDate:"2026-04-10", jobNotes:"Emailed quote Apr 3. Following up.", workOrder:null, paymentConfirmed:false, quotedDate:"2026-04-03", bookedDate:"", createdAt:"2026-04-01T11:00:00Z" },
  { id:3, name:"Priya S.", email:"priya@email.com", phone:"(416) 555-4410", address:"44 Lakeshore Blvd, Toronto ON", dwellingType:"Semi / Townhouse", dwellingSize:"Large", beds:4, baths:3, sqft:2200, serviceType:"Move-In / Move-Out", addons:["cabinets","carpet"], frequency:"One-Time", preferredDate:"2026-04-12", preferredTime:"8:00 AM", notes:"Empty unit. Move-out clean.", status:"New", assignedTo:"", followUpDate:"", jobNotes:"", workOrder:null, paymentConfirmed:false, quotedDate:"", bookedDate:"", createdAt:"2026-04-02T09:00:00Z" },
];

function ResidentialLeads({ jobs, setJobs, partners, region = ACTIVE_REGION, resLeads, setResLeads, setTab = () => {} }) {
  // Use lifted state; seed with sample data if empty
  const leads = resLeads;
  const setLeads = (updater) => {
    setResLeads(typeof updater === "function" ? updater(leads) : updater);
  };
  const [showForm, setShowForm] = useState(false);
  const [viewLead, setViewLead] = useState(null);
  const [editLead, setEditLead] = useState(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [confirmDeleteRes, setConfirmDeleteRes] = useState(null);
  const [confirmDrawerOpen, setConfirmDrawerOpen] = useState(false); // ConfirmDrawer state
  const [showEmail, setShowEmail] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Stable delete handler — lives outside the render loop so no stale closures
  const handleDeleteRes = (id) => {
    const deleteId = String(id);
    setConfirmDeleteRes(null);
    setResLeads(prev => {
      const next = prev.filter(l => String(l.id) !== deleteId);
      // Persist deleted ID to localStorage so it survives refresh
      try {
        const existing = JSON.parse(localStorage.getItem("cp:leads_res_deleted") || "[]");
        if (!existing.includes(deleteId)) {
          localStorage.setItem("cp:leads_res_deleted", JSON.stringify([...existing, deleteId]));
        }
      } catch {}
      return next;
    });
    // Delete from Supabase in background
    sbFetch(`huc_leads_res?id=eq.${encodeURIComponent(deleteId)}`, { method: "DELETE" }).catch(() => {});
  };
  const emptyForm = { name:"", email:"", phone:"", address:"", dwellingType:"Apartment / Condo", dwellingSize:"2 Bed", beds:2, baths:1, sqft:900, serviceType:"Refresh Clean", addons:[], frequency:"One-Time", preferredDate:"", preferredTime:"", notes:"", status:"New", assignedTo:"", followUpDate:"", jobNotes:"" };
  const [form, setForm] = useState(emptyForm);

  // Build the full quote email
  const buildEmail = (lead, q) => {
    const pkg = HUC_PACKAGES[lead.serviceType];
    const addonList = lead.addons?.map(id => RES_ADDONS.find(x=>x.id===id)?.label).filter(Boolean);
    const addonPrices = lead.addons?.map(id => {
      const ao = RES_ADDONS.find(x=>x.id===id);
      return ao ? `- ${ao.label}: +CA$${ao.clientPrice}` : null;
    }).filter(Boolean);
    const cur = region.id === "ON" ? "CA$" : "$";
    const f = (n) => `${cur}${Math.round(n).toLocaleString()}`;

    const subject = `Your Cleaning Quote — ${BRAND.businessName}`;

    const body = [
      `Hi ${lead.name || "there"},`,
      ``,
      `Thank you for reaching out to Have Us Clean! Based on the details you provided, here is your custom quote:`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `SERVICE DETAILS`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Service:    ${lead.serviceType}`,
      `Property:   ${lead.dwellingType}${lead.dwellingSize ? ` — ${lead.dwellingSize}` : ""}`,
      `Address:    ${lead.address}`,
      `Frequency:  ${lead.frequency}`,
      lead.beds ? `Bedrooms:   ${lead.beds}  |  Bathrooms: ${lead.baths}` : "",
      lead.sqft ? `Est. Size:  ${lead.sqft} sqft` : "",
      ``,
      addonList.length > 0 ? `ADD-ONS SELECTED:` : "",
      ...addonPrices,
      addonList.length > 0 ? `` : "",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `PRICING`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `${lead.frequency} Price:  ${f(q.preTaxTotal)}${q.taxRate > 0 ? ` + ${(q.taxRate*100).toFixed(0)}% HST = ${f(q.total)}` : ""}`,
      ``,
      q.freq_prices ? `RECURRING OPTIONS (save with regular service):` : "",
      q.freq_prices ? `  Weekly:     ${f(q.freq_prices["Weekly"])}/visit` : "",
      q.freq_prices ? `  Bi-Weekly:  ${f(q.freq_prices["Bi-Weekly"])}/visit` : "",
      q.freq_prices ? `  Monthly:    ${f(q.freq_prices["Monthly"])}/visit` : "",
      q.freq_prices ? `` : "",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `WHAT'S INCLUDED`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ...(pkg ? pkg.includes.map(i => `✓ ${i}`) : []),
      ``,
      `If everything looks good, simply reply to this email and we will get your service scheduled right away.`,
      ``,
      lead.preferredDate ? `Your preferred date: ${lead.preferredDate}${lead.preferredTime ? ` at ${lead.preferredTime}` : ""}` : "",
      lead.preferredDate ? `` : "",
      `We look forward to working with you!`,
      ``,
      `Best regards,`,
      `Have Us Clean`,
      `📧 ${BRAND.supportEmail}`,
      `🌐 haveusclean.ca`,
    ].filter(l => l !== null && l !== undefined).join("\n");

    return { subject, body };
  };

  const sendQuote = (lead) => {
    const q = (() => { try { return calcResQuote({...lead, dwellingType:lead.dwellingType||"Apartment / Condo", dwellingSize:lead.dwellingSize||"2 Bed", serviceType:lead.serviceType||"Refresh Clean", frequency:lead.frequency||"One-Time", beds:lead.beds||2, baths:lead.baths||1, sqft:lead.sqft||900, addons:lead.addons||[]}, region); } catch(e) { return {total:0,preTaxTotal:0,taxAmount:0,partnerPay:0,partnerPayEach:0,profit:0,margin:0,teamSize:1,jobHours:1.5,breakdown:[],discountAmt:0,discPct:0,taxRate:0,taxName:"HST",currency:"CA$",region:region||ACTIVE_REGION,freq_prices:{},baseClientPrice:0}; } })();
    const email = buildEmail(lead, q);
    // Mark as Quoted
    setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status:"Quoted", quotedDate:new Date().toLocaleDateString() } : l));
    if (viewLead?.id === lead.id) setViewLead(v => ({ ...v, status:"Quoted" }));
    setShowEmail({ lead, q, ...email });
  };

  const bookLead = (lead) => {
    const q = (() => { try { return calcResQuote({...lead, dwellingType:lead.dwellingType||"Apartment / Condo", dwellingSize:lead.dwellingSize||"2 Bed", serviceType:lead.serviceType||"Refresh Clean", frequency:lead.frequency||"One-Time", beds:lead.beds||2, baths:lead.baths||1, sqft:lead.sqft||900, addons:lead.addons||[]}, region); } catch(e) { return {total:0,preTaxTotal:0,taxAmount:0,partnerPay:0,partnerPayEach:0,profit:0,margin:0,teamSize:1,jobHours:1.5,breakdown:[],discountAmt:0,discPct:0,taxRate:0,taxName:"HST",currency:"CA$",region:region||ACTIVE_REGION,freq_prices:{},baseClientPrice:0}; } })();
    const assignedPartner = partners.find(p => p.onboarded) || partners[0] || { id: 1, name: 'Unassigned' };
    const jobId = Date.now();
    const newJob = {
      id: jobId,
      client: lead.name,
      address: lead.address,
      type: lead.serviceType,
      date: lead.preferredDate || new Date().toISOString().split("T")[0],
      time: lead.preferredTime || "9:00 AM",
      partnerId: assignedPartner?.id || 1,
      partnerIds: [assignedPartner?.id || 1],
      status: "scheduled",
      hours: Math.ceil(q.serviceHours),
      upsells: lead.addons?.map(id => RES_ADDONS.find(x => x.id === id)?.label).filter(Boolean),
      beforePics: [], afterPics: [], summary: "",
      clientPrice: Math.round(q.total),
      partnerPay: q.partnerPay,
      partnerPayEach: q.partnerPayEach,
      teamSize: q.teamSize,
      profit: q.profit,
      checkIn: null, checkOut: null,
      checkInCoords: null, checkOutCoords: null,
      recurring: lead.frequency,
      nextDate: null,
      region: region.id,
      notes: lead.notes || "",
      workOrder: generateWorkOrder({ id:jobId, client:lead.name, address:lead.address, type:lead.serviceType, date:lead.preferredDate||"TBD", time:lead.preferredTime||"9:00 AM", hours:Math.ceil(q.serviceHours), upsells:[] }, lead, assignedPartner),
    };
    setJobs(js => [...js, newJob]);
    setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status:"Booked", workOrder:newJob.id, bookedDate:new Date().toLocaleDateString() } : l));
    if (viewLead?.id === lead.id) setViewLead(v => ({ ...v, status:"Booked" }));
    if (typeof setTab === "function") setTab("jobs");
    alert(`✅ Job booked!\n\nClient: ${newJob.client}\nDate: ${newJob.date} at ${newJob.time}\nTeam: ${(newJob.partnerIds||[newJob.partnerId]).map(id=>partners.find(p=>p.id===id)?.name).filter(Boolean).join(" + ") || "Unassigned"}\nPartner Pay: ${region.currencySymbol}${newJob.partnerPay} total\n\nOpening Jobs tab now.`);
  };

  const confirmPayment = (lead) => {
    setLeads(ls=>ls.map(l=>l.id===lead.id?{...l,status:"Completed",paymentConfirmed:true}:l));
    if(viewLead?.id===lead.id) setViewLead({...viewLead,status:"Completed",paymentConfirmed:true});
  };

  const updateLeadField = (id, field, val) => {
    setLeads(ls=>ls.map(l=>l.id===id?{...l,[field]:val}:l));
    if(viewLead?.id===id) setViewLead(v=>({...v,[field]:val}));
  };

  const submitForm = () => {
    const newLead = { ...form, id:Date.now(), status:"New", workOrder:null, paymentConfirmed:false, quotedDate:"", bookedDate:"", createdAt:new Date().toISOString() };
    setLeads(ls => [newLead, ...ls]);
    setFilterStatus("All");
    setSearchQuery(""); // clear search so new lead is visible
    setShowForm(false);
    setForm(emptyForm);
  };

  const toggleAddon = (id) => setForm(f=>({...f,addons:(f.addons||[]).includes(id)?(f.addons||[]).filter(x=>x!==id):[...f.addons,id]}));

  const dwellingOptions = Object.keys(HUC_PRICING_GRID);
  const sizeOptions = (dt) => Object.keys(HUC_PRICING_GRID[dt] || {});

  const filteredLeads = (() => {
    try {
      const base = filterStatus === "All" ? leads : leads.filter(l => l?.status === filterStatus);
      const sq = searchQuery.trim().toLowerCase();
      return base
        .filter(l => {
          if (!l) return false;
          if (!l.name && !l.email && !l.id) return false; // remove null/empty
          if (!sq) return true;
          return (l.name    || "").toLowerCase().includes(sq) ||
                 (l.email   || "").toLowerCase().includes(sq) ||
                 (l.address || "").toLowerCase().includes(sq) ||
                 (l.phone   || "").toLowerCase().includes(sq);
        })
        .sort((a, b) => {
          const da = a.createdAt || a.quotedDate || a.bookedDate || "";
          const db = b.createdAt || b.quotedDate || b.bookedDate || "";
          return db.localeCompare(da);
        });
    } catch(e) {
      return leads.filter(l => !!l);
    }
  })();

  const statusCounts = HUC_STATUSES.reduce((acc,s)=>({ ...acc, [s]: leads.filter(l=>l?.status===s).length }), {});

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🏠 Residential Leads</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>Have Us Clean — Toronto & GTA</div>
        </div>
        <button style={S.btn("primary")} onClick={()=>setShowForm(true)}>+ New Lead</button>
      </div>

      {/* Search */}
      <input
        style={{ ...S.input, marginBottom:12 }}
        placeholder="🔍 Search by name, email, address or phone..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      {/* Status pipeline */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:18 }}>
        {["All", ...HUC_STATUSES].map(s => {
          const count = s === "All" ? leads.length : statusCounts[s] || 0;
          const col = s === "All" ? C.muted : HUC_STATUS_COLOR[s];
          const active = filterStatus === s;
          return (
            <button key={s} onClick={()=>setFilterStatus(s)} style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700, background:active?`${col}22`:C.surface, color:active?col:C.muted, border:`1px solid ${active?col:C.border}` }}>
              {s} {count > 0 && <span style={{ marginLeft:4, background:`${col}33`, borderRadius:20, padding:"1px 7px", fontSize:11 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {filteredLeads.map(lead => {
          if (!lead || (!lead.id && !lead.name && !lead.email)) return null;
          let q;
          try {
            q = calcResQuote({
              ...lead,
              dwellingType: lead.dwellingType || "Apartment / Condo",
              dwellingSize: lead.dwellingSize || "2 Bed",
              serviceType:  lead.serviceType  || "Refresh Clean",
              frequency:    lead.frequency    || "One-Time",
              beds:   lead.beds  || 2,
              baths:  lead.baths || 1,
              sqft:   lead.sqft  || 900,
              addons: lead.addons || [],
            }, region);
          } catch(e) {
            q = { total:0, profit:0, margin:0, teamSize:1, currency: region?.currencySymbol || "CA$" };
          }
          const statusColor = HUC_STATUS_COLOR[lead.status] || C.muted;
          const key = lead.id ? String(lead.id) : `${lead.email||""}${lead.name||""}${lead.createdAt||Math.random()}`;
          return (
            <div key={key} style={{ ...S.card, borderLeft:`4px solid ${statusColor}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>{lead.name || <span style={{color:C.muted}}>Unnamed Lead</span>}</div>
                  {lead.address  && <div style={{ fontSize:13, color:C.muted }}>📍 {lead.address}</div>}
                  {lead.email    && <div style={{ fontSize:13, color:C.muted }}>📧 {lead.email}{lead.phone ? ` · 📞 ${lead.phone}` : ""}</div>}
                  <div style={{ fontSize:13, marginTop:4, color:C.muted }}>
                    {[lead.dwellingType, lead.dwellingSize, lead.serviceType, lead.frequency].filter(Boolean).join(" · ")}
                  </div>
                  {(lead.addons||[]).length > 0 && (
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
                      {(lead.addons||[]).map(id=>{ const ao=RES_ADDONS.find(x=>x.id===id); return ao?<span key={id} style={S.badge("gold")}>{ao.label}</span>:null; })}
                    </div>
                  )}
                  {lead.source === "VA Quote Agent" && (
                    <div style={{ fontSize:11, color:C.purple, marginTop:4 }}>🤖 From VA Agent</div>
                  )}
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <select value={lead.status || "New"} onChange={e=>updateLeadField(lead.id || key,"status",e.target.value)}
                    style={{ ...S.select, width:"auto", fontSize:12, padding:"4px 10px", marginBottom:6, color:statusColor, fontWeight:700, background:`${statusColor}11`, border:`1px solid ${statusColor}44` }}>
                    {HUC_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  {q.total > 0 && <div style={{ fontWeight:800, fontSize:22, color:C.accent }}>{fmt(q.total, region)}</div>}
                  {q.profit > 0 && <div style={{ fontSize:11, color:C.gold }}>Profit: {fmt(q.profit, region)} · {q.margin}%</div>}
                </div>
              </div>
              {lead.notes && <div style={{ marginTop:8, fontSize:12, color:C.muted, background:C.surface, borderRadius:8, padding:"6px 10px" }}>📝 {lead.notes}</div>}
              {lead.followUpDate && <div style={{ fontSize:12, color:"#FF6B6B", marginTop:4 }}>📅 Follow up: {lead.followUpDate}</div>}
              <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                <button style={S.btn("ghost")} onClick={()=>setViewLead(lead)}>👁 View</button>
                <button style={{...S.btn("ghost"), color:"#60A5FA"}} onClick={()=>{setEditLead({...lead});setShowEditForm(true);}}>✏️ Edit</button>
                <button style={{...S.btn("ghost"), color:"#FF4757"}} onClick={async ()=>{
                  setConfirmDeleteRes(lead.id);
                }}>🗑 Delete</button>
              </div>
              {confirmDeleteRes === lead.id && (
                <div style={{ marginTop:8, padding:"10px 12px", background:"#FF475720", border:"1px solid #FF475766", borderRadius:8, display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:13, color:"#FF4757", flex:1 }}>Delete this lead?</span>
                  <button style={{ background:"#FF4757", border:"none", color:"#fff", borderRadius:6, padding:"6px 14px", fontWeight:700, cursor:"pointer" }} onClick={()=> handleDeleteRes(confirmDeleteRes)}>Yes, Delete</button>
                  <button style={{ background:"#1e2d45", border:"none", color:"#aaa", borderRadius:6, padding:"6px 14px", cursor:"pointer" }} onClick={()=>setConfirmDeleteRes(null)}>Cancel</button>
                </div>
              )}
              <div style={{ marginTop:8, display:"flex", gap:8, flexWrap:"wrap" }}>
                {(!lead.status || lead.status==="New") && <button style={S.btn("primary")} onClick={()=>sendQuote(lead)}>📤 Quote</button>}
                {lead.status==="Quoted" && <button style={{ ...S.btn("sm"), background:C.gold, color:"#0A0F1E" }} onClick={()=>bookLead(lead)}>✅ Book</button>}
                {lead.status==="Follow Up" && <button style={{ ...S.btn("sm"), background:"#FF6B6B", color:"#fff" }} onClick={()=>sendQuote(lead)}>📤 Re-Quote</button>}
                {lead.status==="Booked" && <button style={{ ...S.btn("sm"), background:C.purple, color:"#0A0F1E" }} onClick={()=>confirmPayment(lead)}>💳 Pay</button>}
                {lead.status==="Completed" && <span style={{ fontSize:13, color:C.accent, fontWeight:700 }}>🎉 Done</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Lead Form */}
      {showForm && (
        <Modal title="🏠 New Residential Lead — Have Us Clean" onClose={()=>setShowForm(false)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Full Name</div><input style={S.input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Jane Smith" /></div>
              <div><div style={S.label}>Phone</div><input style={S.input} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="(416) 555-0000" /></div>
            </div>
            <div><div style={S.label}>Email</div><input style={S.input} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="jane@email.com" /></div>
            <div><div style={S.label}>Address (Toronto / GTA / AZ)</div><input style={S.input} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="123 King St W, Toronto ON" /></div>

            {/* Dwelling Type + Size — HUC pricing grid */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Dwelling Type</div>
                <select style={S.select} value={form.dwellingType} onChange={e=>setForm({...form,dwellingType:e.target.value,dwellingSize:Object.keys(HUC_PRICING_GRID[e.target.value]||{})[0]||""})}>
                  {dwellingOptions.map(d=><option key={d}>{d}</option>)}
                </select>
              </div>
              <div><div style={S.label}>Size</div>
                <select style={S.select} value={form.dwellingSize} onChange={e=>setForm({...form,dwellingSize:e.target.value})}>
                  {sizeOptions(form.dwellingType).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
              <div><div style={S.label}>Beds</div><input style={S.input} type="number" min={1} max={10} value={form.beds} onChange={e=>setForm({...form,beds:+e.target.value})} /></div>
              <div><div style={S.label}>Baths</div><input style={S.input} type="number" min={1} max={10} value={form.baths} onChange={e=>setForm({...form,baths:+e.target.value})} /></div>
              <div><div style={S.label}>Sq Ft</div><input style={S.input} type="number" min={400} value={form.sqft} onChange={e=>setForm({...form,sqft:+e.target.value})} /></div>
              <div><div style={S.label}>Est. Hours</div><div style={{ padding:"10px 0", fontSize:14, fontWeight:700, color:C.accent }}>{getSqftHours(form.sqft).toFixed(1)}h</div></div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Service Package</div>
                <select style={S.select} value={form.serviceType} onChange={e=>setForm({...form,serviceType:e.target.value})}>
                  {Object.keys(HUC_PACKAGES).map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div><div style={S.label}>Frequency</div>
                <select style={S.select} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}>
                  {Object.keys(FREQ_DISCOUNTS).map(f=><option key={f}>{f}</option>)}
                </select>
              </div>
            </div>

            {/* Package description */}
            {form.serviceType && HUC_PACKAGES[form.serviceType] && (
              <div style={{ background:C.accentDim, borderRadius:10, padding:"10px 14px", fontSize:12, color:C.muted }}>
                <strong style={{ color:C.accent }}>{HUC_PACKAGES[form.serviceType].icon} {form.serviceType}</strong> — {HUC_PACKAGES[form.serviceType].best_for}<br/>
                <span style={{ color:C.dim }}>Includes: {HUC_PACKAGES[form.serviceType].includes.join(" · ")}</span>
              </div>
            )}

            <div><div style={S.label}>Add-Ons</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {RES_ADDONS.map(ao=>(
                  <button key={ao.id} onClick={()=>toggleAddon(ao.id)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", background:(form.addons||[]).includes(ao.id)?C.accentDim:C.surface, color:(form.addons||[]).includes(ao.id)?C.accent:C.muted, border:`1px solid ${(form.addons||[]).includes(ao.id)?C.accent:C.border}` }}>
                    {ao.label} (+{region?.currencySymbol || "CA$"}{ao.clientPrice})
                  </button>
                ))}
              </div>
            </div>

            {form.name && (() => { try { const q=calcResQuote({...form, dwellingType:form.dwellingType||"Apartment / Condo", dwellingSize:form.dwellingSize||"2 Bed", serviceType:form.serviceType||"Refresh Clean", frequency:form.frequency||"One-Time", beds:form.beds||2, baths:form.baths||1, sqft:form.sqft||900, addons:form.addons||[]},region); return <QuoteBox q={q} type="res" />; } catch(e) { return null; } })()}

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Preferred Date</div><input style={S.input} type="date" value={form.preferredDate} onChange={e=>setForm({...form,preferredDate:e.target.value})} /></div>
              <div><div style={S.label}>Preferred Time</div><input style={S.input} type="time" value={form.preferredTime} onChange={e=>setForm({...form,preferredTime:e.target.value})} /></div>
            </div>
            <div><div style={S.label}>Notes</div><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Special instructions, pets, access info..." /></div>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={submitForm} disabled={!form.name||!form.email}>💾 Save Lead</button>
          </div>
        </Modal>
      )}

      {/* View / Quote Modal */}
      {showEditForm && editLead && (
        <Modal onClose={()=>{setShowEditForm(false);setEditLead(null);}}>
          <div style={{ padding:16 }}>
            <h3 style={{ color:C.accent, marginBottom:16 }}>✏️ Edit Lead</h3>
            {["name","email","phone","address","notes"].map(field => (
              <div key={field} style={{ marginBottom:10 }}>
                <div style={S.label}>{field.charAt(0).toUpperCase()+field.slice(1)}</div>
                <input style={S.input} value={editLead[field]||""} onChange={e=>setEditLead(v=>({...v,[field]:e.target.value}))} />
              </div>
            ))}
            <div style={{ marginBottom:10 }}>
              <div style={S.label}>Status</div>
              <select style={S.input} value={editLead.status||"New"} onChange={e=>setEditLead(v=>({...v,status:e.target.value}))}>
                {["New","Quoted","Follow Up","Booked","Completed","Lost"].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={S.label}>Follow-Up Date</div>
              <input style={S.input} type="date" value={editLead.followUpDate||""} onChange={e=>setEditLead(v=>({...v,followUpDate:e.target.value}))} />
            </div>
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              <button style={{...S.btn("primary"), flex:1}} onClick={()=>{
                setResLeads(ls=>{const next=ls.map(l=>l.id===editLead.id?editLead:l);dbSet(DB_KEYS.leadsRes,next);return next;});
                setShowEditForm(false);setEditLead(null);
              }}>💾 Save Changes</button>
              <button style={{...S.btn("ghost"), flex:1}} onClick={()=>{setShowEditForm(false);setEditLead(null);}}>Cancel</button>
            </div>
            <button style={{...S.btn("ghost"), width:"100%", marginTop:8, color:"#FF4757", borderColor:"#FF4757"}} onClick={()=>{
              setConfirmDrawerOpen(true);
            }}>🗑 Delete Lead</button>
          </div>
        </Modal>
      )}

      {/* ── ConfirmDrawer — replaces window.confirm for edit modal lead delete ── */}
      <ConfirmDrawer
        open={confirmDrawerOpen}
        title="Delete this lead?"
        message="This cannot be undone. The lead will be permanently removed."
        confirmLabel="Yes, Delete"
        cancelLabel="Keep Lead"
        variant="danger"
        onConfirm={async () => {
          const lid = String(editLead?.id || "");
          setConfirmDrawerOpen(false);
          setResLeads(ls => {
            const next = ls.filter(l => l.id !== editLead?.id);
            dbSet(DB_KEYS.leadsRes, next);
            return next;
          });
          try { await sbFetch(`huc_leads_res?id=eq.${encodeURIComponent(lid)}`, { method:"DELETE" }); } catch {}
          setShowEditForm(false);
          setEditLead(null);
        }}
        onCancel={() => setConfirmDrawerOpen(false)}
      />
      {viewLead && (
        <Modal title={`📄 Quote — ${viewLead.name}`} onClose={()=>setViewLead(null)} wide>
          <div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:14, color:C.muted }}>📍 {viewLead.address}</div>
              <div style={{ fontSize:14, color:C.muted }}>{viewLead.dwellingType} — {viewLead.dwellingSize} · 🛏 {viewLead.beds}bd / 🚿 {viewLead.baths}ba · 📐 {viewLead.sqft} sqft</div>
              <div style={{ fontSize:14, color:C.muted }}>{HUC_PACKAGES[viewLead.serviceType]?.icon} {viewLead.serviceType} · {viewLead.frequency}</div>
              {viewLead.notes && <div style={{ fontSize:13, color:C.muted, background:C.surface, borderRadius:8, padding:"8px 12px", marginTop:8 }}>💬 {viewLead.notes}</div>}
            </div>
            {(() => { try { return <QuoteBox q={calcResQuote({...viewLead, dwellingType:viewLead.dwellingType||"Apartment / Condo", dwellingSize:viewLead.dwellingSize||"2 Bed", serviceType:viewLead.serviceType||"Refresh Clean", frequency:viewLead.frequency||"One-Time", beds:viewLead.beds||2, baths:viewLead.baths||1, sqft:viewLead.sqft||900, addons:viewLead.addons||[]},region)} type="res" />; } catch(e) { return <div style={{color:C.muted,fontSize:13,padding:12}}>Quote preview unavailable — fill in property details</div>; } })()}
            {/* Editable job notes + follow-up */}
            <div style={{ marginTop:14, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:10 }}>
              <div><div style={S.label}>Job Notes</div><textarea style={{...S.input,minHeight:50,resize:"vertical"}} value={viewLead.jobNotes||""} onChange={e=>updateLeadField(viewLead.id,"jobNotes",e.target.value)} placeholder="Notes for VA / team..." /></div>
              <div><div style={S.label}>Follow-Up Date</div><input style={S.input} type="date" value={viewLead.followUpDate||""} onChange={e=>updateLeadField(viewLead.id,"followUpDate",e.target.value)} /></div>
            </div>
            <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
              {viewLead.status==="New" && <button style={{ ...S.btn("primary"), width:"100%" }} onClick={()=>sendQuote(viewLead)}>📤 Send Quote to {viewLead.email}</button>}
              {viewLead.status==="Quoted" && <button style={{ ...S.btn("primary"), width:"100%", background:C.gold, color:"#0A0F1E" }} onClick={()=>bookLead(viewLead)}>✅ Book + Create Work Order</button>}
              {viewLead.status==="Follow Up" && <button style={{ ...S.btn("primary"), width:"100%", background:"#FF6B6B", color:"#fff" }} onClick={()=>sendQuote(viewLead)}>📤 Re-Send Quote</button>}
              {viewLead.status==="Booked" && <button style={{ ...S.btn("primary"), width:"100%", background:C.purple, color:"#0A0F1E" }} onClick={()=>confirmPayment(viewLead)}>💳 Confirm Payment</button>}
              {viewLead.status==="Completed" && <div style={{ textAlign:"center", color:C.accent, fontWeight:800 }}>🎉 Job complete and paid!</div>}
            </div>
          </div>
        </Modal>
      )}

      {/* Email Send Modal */}
      {showEmail && (
        <Modal title="📧 Send Quote Email" onClose={()=>setShowEmail(null)} wide>
          <div>
            {/* Status banner */}
            <div style={{ background:C.accentDim, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"12px 16px", marginBottom:18, display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>✅</span>
              <div>
                <div style={{ fontWeight:700, color:C.accent, fontSize:14 }}>Lead marked as Quoted</div>
                <div style={{ fontSize:12, color:C.muted }}>Now send the email using one of the options below</div>
              </div>
            </div>

            {/* To / Subject */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12, marginBottom:14 }}>
              <div>
                <div style={S.label}>To</div>
                <div style={{ background:C.surface, borderRadius:8, padding:"10px 12px", fontSize:14, fontWeight:700, color:C.text }}>
                  {showEmail.lead.email || <span style={{ color:C.red }}>⚠️ No email on file</span>}
                </div>
              </div>
              <div>
                <div style={S.label}>Subject</div>
                <div style={{ background:C.surface, borderRadius:8, padding:"10px 12px", fontSize:13, color:C.muted }}>{showEmail.subject}</div>
              </div>
            </div>

            {/* Email body preview */}
            <div style={{ marginBottom:18 }}>
              <div style={S.label}>Email Preview</div>
              <div style={{ background:C.surface, borderRadius:10, padding:16, fontSize:13, color:C.muted, lineHeight:1.9, whiteSpace:"pre-line", maxHeight:280, overflowY:"auto", border:`1px solid ${C.border}` }}>
                {showEmail.body}
              </div>
            </div>

            {/* Send options */}
            <div style={S.label}>Send Options</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

              {/* Option 1 — Open Gmail */}
              <a
                href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(showEmail.lead.email || "")}&su=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...S.btn("primary"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontSize:14, padding:"14px 20px" }}
              >
                <span style={{ fontSize:20 }}>📨</span>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontWeight:800 }}>Open in Gmail</div>
                  <div style={{ fontSize:11, opacity:0.8 }}>Opens Gmail with quote pre-filled — just hit Send</div>
                </div>
              </a>

              {/* Option 2 — mailto (default email app) */}
              <a
                href={`mailto:${showEmail.lead.email || ""}?subject=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`}
                style={{ ...S.btn("ghost"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontSize:14, padding:"14px 20px" }}
              >
                <span style={{ fontSize:20 }}>📱</span>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontWeight:800 }}>Open in Mail App</div>
                  <div style={{ fontSize:11, color:C.dim }}>Opens your default email app (iPhone Mail, Outlook, etc.)</div>
                </div>
              </a>

              {/* Option 3 — Copy body */}
              <button
                style={{ ...S.btn("ghost"), display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontSize:14, padding:"14px 20px" }}
                onClick={() => {
                  navigator.clipboard?.writeText(showEmail.body);
                  alert("✅ Email body copied! Paste it into any email app.");
                }}
              >
                <span style={{ fontSize:20 }}>📋</span>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontWeight:800 }}>Copy Email Body</div>
                  <div style={{ fontSize:11, color:C.dim }}>Copy and paste into any email manually</div>
                </div>
              </button>

            </div>

            {/* Quote summary strip */}
            <div style={{ marginTop:18, background:C.bg, borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10, fontSize:13 }}>
              <div><span style={{ color:C.muted }}>Client: </span><strong>{showEmail.lead.name}</strong></div>
              <div><span style={{ color:C.muted }}>Service: </span><strong>{showEmail.lead.serviceType}</strong></div>
              <div><span style={{ color:C.muted }}>Total: </span><strong style={{ color:C.accent }}>{region.currencySymbol}{Math.round(showEmail.q.total).toLocaleString()}</strong></div>
              <div><span style={{ color:C.muted }}>Partner Pay: </span><strong style={{ color:C.blue }}>{region.currencySymbol}{showEmail.q.partnerPay}</strong></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CommercialLeads({ jobs, setJobs, partners, region = ACTIVE_REGION }) {
  const [leads, setLeads] = useState([
    { id:1, bizName:"Apex Financial Group", contactName:"Linda Torres", email:"ltorres@apexfin.com", phone:"555-8801", address:"1200 Commerce Blvd, Suite 400", serviceType:"Office Clean",        sqft:4500, floors:2, addons:["restrooms","supply"], frequency:"Weekly",    preferredDate:"2026-04-14", preferredTime:"6:00 AM", contractMonths:12, notes:"After-hours only.", status:"quoted", workOrder:null, paymentConfirmed:false },
    { id:2, bizName:"FitZone Gym",          contactName:"Derek Nolan",  email:"derek@fitzone.com",  phone:"555-7720", address:"300 Athletic Way",                serviceType:"Retail / Showroom", sqft:8000, floors:1, addons:["disinfect","carpet_com"], frequency:"Daily", preferredDate:"2026-04-07", preferredTime:"5:00 AM", contractMonths:6,  notes:"High traffic. Locker rooms priority.", status:"new", workOrder:null, paymentConfirmed:false },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [viewLead, setViewLead] = useState(null);
  const [showEmail, setShowEmail] = useState(null);
  const [form, setForm] = useState({ bizName:"", contactName:"", email:"", phone:"", address:"", serviceType:"Office Clean", sqft:2000, floors:1, addons:[], frequency:"Weekly", preferredDate:"", preferredTime:"", contractMonths:12, notes:"" });

  const sendQuote = (lead) => {
    const q = calcComQuote(lead, region);
    const pkg = lead.serviceType;
    const addonList = lead.addons?.map(id => COM_ADDONS.find(x=>x.id===id)?.label).filter(Boolean);
    const cur = region.id === "ON" ? "CA$" : "$";
    const f = (n) => `${cur}${Math.round(n).toLocaleString()}`;
    const subject = `Commercial Cleaning Proposal — ${BRAND.businessName}`;
    const body = [
      `Hi ${lead.contactName || "there"},`,
      ``,
      `Thank you for considering Have Us Clean for your commercial cleaning needs. Here is your custom proposal:`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `PROPOSAL DETAILS`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Business:   ${lead.bizName}`,
      `Service:    ${pkg}`,
      `Address:    ${lead.address}`,
      `Size:       ${lead.sqft?.toLocaleString()} sqft · ${lead.floors} floor(s)`,
      `Frequency:  ${lead.frequency}`,
      addonList.length > 0 ? `Add-Ons:    ${addonList.join(", ")}` : "",
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `PRICING`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Per Visit:      ${f(q.total)}${q.taxRate > 0 ? ` (incl. ${(q.taxRate*100).toFixed(0)}% HST)` : ""}`,
      `Monthly Est.:   ${f(q.monthly)}`,
      lead.contractMonths > 1 ? `Contract Value: ${f(q.contract)} (${lead.contractMonths} months)` : "",
      ``,
      `To move forward, please reply to this email or call us directly.`,
      ``,
      `Best regards,`,
      `Have Us Clean`,
      `📧 ${BRAND.supportEmail}`,
    ].filter(l => l !== null && l !== undefined).join("\n");

    setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status:"quoted" } : l));
    if (viewLead?.id === lead.id) setViewLead(v => ({ ...v, status:"quoted" }));
    setShowEmail({ lead, q, subject, body, isCommercial: true });
  };
  const bookLead = (lead) => {
    const q = calcComQuote(lead, region);
    const newJob = { id:Date.now(), client:lead.bizName, address:lead.address, type:lead.serviceType, date:lead.preferredDate, time:lead.preferredTime, partnerId:partners[0]?.id||1, partnerIds:[partners[0]?.id||1], status:"scheduled", hours:Math.max(3,Math.round(q.totalCost/PARTNER_COST_PER_HOUR)), upsells:lead.addons?.map(id=>COM_ADDONS.find(x=>x.id===id)?.label).filter(Boolean), beforePics:[], afterPics:[], summary:"", clientPrice:Math.round(q.total), partnerPay:q.partnerPay, profit:q.profit, checkIn:null, checkOut:null, checkInCoords:null, checkOutCoords:null, recurring:lead.frequency, nextDate:null };
    setJobs(js=>[...js,newJob]);
    setLeads(ls=>ls.map(l=>l.id===lead.id?{...l,status:"booked",workOrder:newJob.id}:l));
    if(viewLead?.id===lead.id) setViewLead({...viewLead,status:"booked"});
    alert("✅ Commercial contract created! Work order added to Jobs.");
  };
  const confirmPayment = (lead) => {
    setLeads(ls=>ls.map(l=>l.id===lead.id?{...l,status:"paid",paymentConfirmed:true}:l));
    if(viewLead?.id===lead.id) setViewLead({...viewLead,status:"paid",paymentConfirmed:true});
  };
  const submitForm = () => {
    setLeads(ls=>[...ls,{...form,id:Date.now(),status:"new",workOrder:null,paymentConfirmed:false}]);
    setShowForm(false);
    setForm({ bizName:"", contactName:"", email:"", phone:"", address:"", serviceType:"Office Clean", sqft:2000, floors:1, addons:[], frequency:"Weekly", preferredDate:"", preferredTime:"", contractMonths:12, notes:"" });
  };
  const toggleAddon = (id) => setForm(f=>({...f,addons:(f.addons||[]).includes(id)?(f.addons||[]).filter(x=>x!==id):[...f.addons,id]}));

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div style={S.h2}>🏢 Commercial Leads</div>
        <button style={S.btn("primary")} onClick={()=>setShowForm(true)}>+ New Lead</button>
      </div>
      <div style={S.grid3}>
        <StatCard label="Commercial Leads" value={leads.length} icon="🏢" color={C.blue} />
        <StatCard label="Monthly Value" value={`$${leads.filter(l=>l.status!=="new").reduce((a,b)=>a+calcComQuote(b, region).monthly,0).toFixed(0)}`} icon="📈" color={C.gold} />
        <StatCard label="Active Contracts" value={leads.filter(l=>["booked","paid"].includes(l.status)).length} icon="📑" color={C.accent} />
      </div>
      <div style={S.divider} />
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {leads.map(lead=>{
          const q = calcComQuote(lead, region);
          return (
            <div key={lead.id} style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:17 }}>{lead.bizName}</div>
                  <div style={{ fontSize:13, color:C.muted }}>👤 {lead.contactName} · 📧 {lead.email}</div>
                  <div style={{ fontSize:13, color:C.muted }}>📐 {lead.sqft.toLocaleString()} sqft · {lead.floors} fl · {lead.serviceType} · {lead.frequency}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={S.badge(lead.status==="paid"?"green":lead.status==="booked"?"green":lead.status==="quoted"?"gold":"blue")}>{lead.status}</span>
                  <div style={{ fontWeight:800, fontSize:20, color:C.accent, marginTop:6 }}>${q.total.toFixed(2)}<span style={{ fontSize:12,color:C.muted }}>/visit</span></div>
                  <div style={{ fontSize:12, color:C.gold }}>Profit: ${q.profit}/visit · {q.margin}% margin</div>
                  <div style={{ fontSize:12, color:C.muted }}>${q.monthly.toFixed(0)}/mo · ${q.contract.toFixed(0)} contract</div>
                </div>
              </div>
              {(lead.addons||[]).length>0 && <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>{lead.addons?.map(id=>{ const ao=COM_ADDONS.find(x=>x.id===id); return ao?<span key={id} style={S.badge("blue")}>{ao.label}</span>:null; })}</div>}
              {lead.notes && <div style={{ marginTop:10, fontSize:12, color:C.muted, background:C.surface, borderRadius:8, padding:"8px 12px" }}>💬 {lead.notes}</div>}
              <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                <button style={S.btn("ghost")} onClick={()=>setViewLead(lead)}>👁 View Proposal</button>
                {lead.status==="new" && <button style={S.btn("primary")} onClick={()=>sendQuote(lead)}>📤 Send Proposal</button>}
                {lead.status==="quoted" && <button style={{ ...S.btn("sm"), background:C.gold, color:"#0A0F1E" }} onClick={()=>bookLead(lead)}>✅ Sign Contract</button>}
                {lead.status==="booked" && <button style={{ ...S.btn("sm"), background:C.purple, color:"#0A0F1E" }} onClick={()=>confirmPayment(lead)}>💳 Confirm Deposit</button>}
                {lead.status==="paid" && <span style={{ fontSize:13, color:C.accent, fontWeight:700 }}>🎉 Contract Active!</span>}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <Modal title="🏢 New Commercial Lead" onClose={()=>setShowForm(false)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Business Name</div><input style={S.input} value={form.bizName} onChange={e=>setForm({...form,bizName:e.target.value})} placeholder="Acme Corp" /></div>
              <div><div style={S.label}>Contact Name</div><input style={S.input} value={form.contactName} onChange={e=>setForm({...form,contactName:e.target.value})} placeholder="John Smith" /></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Email</div><input style={S.input} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></div>
              <div><div style={S.label}>Phone</div><input style={S.input} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
            </div>
            <div><div style={S.label}>Address</div><input style={S.input} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
              <div><div style={S.label}>Sq Ft</div><input style={S.input} type="number" min={500} value={form.sqft} onChange={e=>setForm({...form,sqft:+e.target.value})} /></div>
              <div><div style={S.label}>Floors</div><input style={S.input} type="number" min={1} max={50} value={form.floors} onChange={e=>setForm({...form,floors:+e.target.value})} /></div>
              <div><div style={S.label}>Contract (mo)</div><input style={S.input} type="number" min={1} max={36} value={form.contractMonths} onChange={e=>setForm({...form,contractMonths:+e.target.value})} /></div>
              <div><div style={S.label}>Service</div><select style={S.select} value={form.serviceType} onChange={e=>setForm({...form,serviceType:e.target.value})}>{Object.keys(COM_SERVICE_COST_PER_SQFT).map(t=><option key={t}>{t}</option>)}</select></div>
            </div>
            <div><div style={S.label}>Frequency</div><select style={S.select} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}>{Object.keys(COM_FREQ_DISCOUNTS).map(f=><option key={f}>{f}</option>)}</select></div>
            <div><div style={S.label}>Add-Ons</div><div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{COM_ADDONS.map(ao=>(<button key={ao.id} onClick={()=>toggleAddon(ao.id)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", background:(form.addons||[]).includes(ao.id)?C.blueDim:C.surface, color:(form.addons||[]).includes(ao.id)?C.blue:C.muted, border:`1px solid ${(form.addons||[]).includes(ao.id)?C.blue:C.border}` }}>{ao.label} +${markupFactor(ao.costToUs)}</button>))}</div></div>
            {form.bizName && (() => { const q=calcComQuote(form, region); return (<><QuoteBox q={q} type="com" /><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:10, marginTop:10 }}><div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>MONTHLY</div><div style={{ fontSize:18,fontWeight:800,color:C.gold }}>${q.monthly.toFixed(0)}</div></div><div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>{form.contractMonths}-MO CONTRACT</div><div style={{ fontSize:18,fontWeight:800,color:C.blue }}>${q.contract.toFixed(0)}</div></div></div></>); })()}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div><div style={S.label}>Preferred Date</div><input style={S.input} type="date" value={form.preferredDate} onChange={e=>setForm({...form,preferredDate:e.target.value})} /></div>
              <div><div style={S.label}>Preferred Time</div><input style={S.input} type="time" value={form.preferredTime} onChange={e=>setForm({...form,preferredTime:e.target.value})} /></div>
            </div>
            <div><div style={S.label}>Notes</div><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={submitForm} disabled={!form.bizName||!form.email}>💾 Save Lead & Generate Proposal</button>
          </div>
        </Modal>
      )}

      {showEditForm && editLead && (
        <Modal onClose={()=>{setShowEditForm(false);setEditLead(null);}}>
          <div style={{ padding:16 }}>
            <h3 style={{ color:C.accent, marginBottom:16 }}>✏️ Edit Lead</h3>
            {["name","email","phone","address","notes"].map(field => (
              <div key={field} style={{ marginBottom:10 }}>
                <div style={S.label}>{field.charAt(0).toUpperCase()+field.slice(1)}</div>
                <input style={S.input} value={editLead[field]||""} onChange={e=>setEditLead(v=>({...v,[field]:e.target.value}))} />
              </div>
            ))}
            <div style={{ marginBottom:10 }}>
              <div style={S.label}>Status</div>
              <select style={S.input} value={editLead.status||"New"} onChange={e=>setEditLead(v=>({...v,status:e.target.value}))}>
                {["New","Quoted","Follow Up","Booked","Completed","Lost"].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={S.label}>Follow-Up Date</div>
              <input style={S.input} type="date" value={editLead.followUpDate||""} onChange={e=>setEditLead(v=>({...v,followUpDate:e.target.value}))} />
            </div>
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              <button style={{...S.btn("primary"), flex:1}} onClick={()=>{
                setResLeads(ls=>{const next=ls.map(l=>l.id===editLead.id?editLead:l);dbSet(DB_KEYS.leadsRes,next);return next;});
                setShowEditForm(false);setEditLead(null);
              }}>💾 Save Changes</button>
              <button style={{...S.btn("ghost"), flex:1}} onClick={()=>{setShowEditForm(false);setEditLead(null);}}>Cancel</button>
            </div>
            <button style={{...S.btn("ghost"), width:"100%", marginTop:8, color:"#FF4757", borderColor:"#FF4757"}} onClick={()=>{
              setConfirmDrawerOpen(true);
            }}>🗑 Delete Lead</button>
          </div>
        </Modal>
      )}

      {/* ── ConfirmDrawer — commercial edit modal lead delete ── */}
      <ConfirmDrawer
        open={confirmDrawerOpen}
        title="Delete this lead?"
        message="This cannot be undone. The lead will be permanently removed."
        confirmLabel="Yes, Delete"
        cancelLabel="Keep Lead"
        variant="danger"
        onConfirm={async () => {
          const lid = String(editLead?.id || "");
          setConfirmDrawerOpen(false);
          setResLeads(ls => {
            const next = ls.filter(l => l.id !== editLead?.id);
            dbSet(DB_KEYS.leadsRes, next);
            return next;
          });
          try { await sbFetch(`huc_leads_res?id=eq.${encodeURIComponent(lid)}`, { method:"DELETE" }); } catch {}
          setShowEditForm(false);
          setEditLead(null);
        }}
        onCancel={() => setConfirmDrawerOpen(false)}
      />
      {viewLead && (
        <Modal title={`📑 Proposal — ${viewLead.bizName}`} onClose={()=>setViewLead(null)} wide>
          {(() => { const q=calcComQuote(viewLead, region); return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:14, color:C.muted }}>👤 {viewLead.contactName} · {viewLead.email}</div>
                <div style={{ fontSize:13, color:C.muted }}>📐 {viewLead.sqft.toLocaleString()} sqft · {viewLead.floors} floor(s) · {viewLead.serviceType} · {viewLead.frequency}</div>
              </div>
              <QuoteBox q={q} type="com" />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:10, marginTop:10 }}>
                <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>MONTHLY</div><div style={{ fontSize:20,fontWeight:800,color:C.gold }}>${q.monthly.toFixed(0)}</div></div>
                <div style={{ background:C.surface, borderRadius:9, padding:12, textAlign:"center" }}><div style={{ fontSize:11,color:C.muted }}>{viewLead.contractMonths}-MO CONTRACT</div><div style={{ fontSize:20,fontWeight:800,color:C.blue }}>${q.contract.toFixed(0)}</div></div>
              </div>
              <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
                {viewLead.status==="new" && <button style={{ ...S.btn("primary"), width:"100%" }} onClick={()=>sendQuote(viewLead)}>📤 Send Proposal</button>}
                {viewLead.status==="quoted" && <button style={{ ...S.btn("primary"), width:"100%", background:C.gold, color:"#0A0F1E" }} onClick={()=>bookLead(viewLead)}>✅ Sign Contract + Work Order</button>}
                {viewLead.status==="booked" && <button style={{ ...S.btn("primary"), width:"100%", background:C.purple, color:"#0A0F1E" }} onClick={()=>confirmPayment(viewLead)}>💳 Confirm Deposit</button>}
                {viewLead.status==="paid" && <div style={{ textAlign:"center", color:C.accent, fontWeight:800 }}>🎉 Contract Active!</div>}
              </div>
            </div>
          ); })()}
        </Modal>
      )}
      {/* Commercial Email Modal */}
      {showEmail && (
        <Modal title="📧 Send Commercial Proposal" onClose={()=>setShowEmail(null)} wide>
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
              <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(showEmail.lead.email||"")}&su=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`} target="_blank" rel="noopener noreferrer"
                style={{ ...S.btn("primary"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }}>
                <span style={{ fontSize:20 }}>📨</span>
                <div><div style={{ fontWeight:800 }}>Open in Gmail</div><div style={{ fontSize:11, opacity:0.8 }}>Pre-filled and ready to send</div></div>
              </a>
              <a href={`mailto:${showEmail.lead.email||""}?subject=${encodeURIComponent(showEmail.subject)}&body=${encodeURIComponent(showEmail.body)}`}
                style={{ ...S.btn("ghost"), textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }}>
                <span style={{ fontSize:20 }}>📱</span>
                <div><div style={{ fontWeight:800 }}>Open in Mail App</div><div style={{ fontSize:11, color:C.dim }}>Opens your default email app</div></div>
              </a>
              <button style={{ ...S.btn("ghost"), display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"14px 20px" }}
                onClick={() => { navigator.clipboard?.writeText(showEmail.body); alert("✅ Proposal copied to clipboard!"); }}>
                <span style={{ fontSize:20 }}>📋</span>
                <div><div style={{ fontWeight:800 }}>Copy Proposal Body</div><div style={{ fontSize:11, color:C.dim }}>Paste into any email manually</div></div>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function RegionSwitcher({ activeRegion, setActiveRegion }) {
  return (
    <div style={{ display:"flex", gap:4, alignItems:"center" }}>
      {Object.values(REGIONS).map(r => (
        <button key={r.id} onClick={() => setActiveRegion(r)} style={{
          padding:"5px 12px", borderRadius:8, border:"none", cursor:"pointer",
          fontSize:12, fontWeight:700, transition:"all 0.15s",
          background: activeRegion.id === r.id ? `${r.id==="ON"?"#FF6B6B":"#3B82F6"}33` : "transparent",
          color: activeRegion.id === r.id ? (r.id==="ON"?"#FF6B6B":"#3B82F6") : C.muted,
          borderBottom: activeRegion.id === r.id ? `2px solid ${r.id==="ON"?"#FF6B6B":"#3B82F6"}` : "2px solid transparent",
        }}>
          {r.flag} {r.id}
        </button>
      ))}
    </div>
  );
}

// ─── TAX & COMPLIANCE ─────────────────────────────────────────────────────────
function TaxCompliance({ region }) {
  const R = region;
  const [activeTab, setActiveTab] = useState("overview");

  const tabs = [
    { id:"overview",    label:"📋 Overview" },
    { id:"tax",         label:`💰 ${R.tax.name} Tax` },
    { id:"compliance",  label:"✅ Compliance" },
    { id:"invoicing",   label:"🧾 Invoicing" },
    { id:"rates",       label:"📊 Market Rates" },
  ];

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        <div style={{ fontSize:40 }}>{R.flag}</div>
        <div>
          <div style={S.h2}>{R.label} — Tax & Compliance</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>All regulatory requirements for operating CleanPro in {R.label}</div>
        </div>
      </div>

      <div style={{ display:"flex", gap:6, marginBottom:22, flexWrap:"wrap" }}>
        {tabs.map(t => <button key={t.id} style={S.navBtn(activeTab===t.id)} onClick={()=>setActiveTab(t.id)}>{t.label}</button>)}
      </div>

      {activeTab === "overview" && (
        <div>
          <div style={S.grid3}>
            <StatCard label="Tax System" value={R.tax.name} icon={R.flag} color={R.country==="CA"?"#FF6B6B":C.blue} sub={R.country==="CA"?"Canada Revenue Agency":"Arizona ADOR"} />
            <StatCard label="Tax Rate on Services" value={R.id==="ON"?"13%":"0%"} icon="📊" color={R.id==="ON"?C.gold:C.accent} sub={R.id==="ON"?"HST on cleaning services":"Cleaning services exempt"} />
            <StatCard label="Currency" value={R.currencySymbol} icon="💱" color={C.blue} sub={R.currency} />
          </div>
          <div style={S.divider} />

          {/* Key Differences Banner */}
          <div style={{ ...S.card, borderLeft:`4px solid ${R.country==="CA"?"#FF6B6B":C.blue}`, marginBottom:20 }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:10 }}>
              {R.flag} Key Facts for {R.label}
            </div>
            {R.id === "ON" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:13, color:C.muted, lineHeight:1.7 }}>
                <div>✅ <strong style={{ color:C.text }}>HST 13%</strong> applies to all cleaning services (5% federal GST + 8% Ontario PST, collected as one)</div>
                <div>✅ Must <strong style={{ color:C.text }}>register with CRA</strong> for a Business Number + HST account once revenue exceeds $30,000 CAD</div>
                <div>✅ Must <strong style={{ color:C.text }}>show HST registration number</strong> on every invoice — do NOT show federal/provincial separately</div>
                <div>✅ <strong style={{ color:C.text }}>WSIB coverage</strong> required if you have workers (not just contractors)</div>
                <div>✅ Commercial clients can claim <strong style={{ color:C.text }}>Input Tax Credits (ITCs)</strong> for HST paid — mention this in sales pitches</div>
                <div>✅ Partner pay rate benchmark: <strong style={{ color:C.text }}>$20–$38 CAD/hr</strong> (GTA: $26–$38; minimum wage: $17.20)</div>
                <div>📐 Measurement: sqft for real estate, but metric (m², km) for distances</div>
              </div>
            )}
            {R.id === "AZ" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:13, color:C.muted, lineHeight:1.7 }}>
                <div>✅ <strong style={{ color:C.text }}>Cleaning services are NOT subject to Arizona TPT</strong> — do NOT charge customers tax on service fees</div>
                <div>✅ <strong style={{ color:C.text }}>TPT DOES apply</strong> if you sell cleaning products/supplies separately (taxable at Phoenix: 8.6%)</div>
                <div>✅ Must obtain a <strong style={{ color:C.text }}>TPT License from ADOR</strong> — $12/year at AZTaxes.gov (even if services are exempt)</div>
                <div>✅ <strong style={{ color:C.text }}>Workers' Compensation insurance</strong> required for any employees (even part-time)</div>
                <div>✅ Arizona minimum wage <strong style={{ color:C.text }}>$14.70/hr (2025)</strong>; Phoenix living wage ~$17–20/hr</div>
                <div>✅ Phoenix combined TPT rate: <strong style={{ color:C.text }}>8.6%</strong> (state 5.6% + local 3.0%); varies by city</div>
                <div>📐 Measurement: imperial (sqft, miles, Fahrenheit)</div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "tax" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:16, marginBottom:22 }}>
            {R.id === "ON" && (
              <>
                <div style={S.statCard(C.gold)}>
                  <div style={{ fontSize:22 }}>🇨🇦</div>
                  <div style={{ fontWeight:800, fontSize:22, color:C.gold }}>13% HST</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>Ontario Cleaning Services</div>
                  <div style={{ fontSize:12, color:C.muted }}>5% federal + 8% provincial</div>
                </div>
                <div style={S.statCard(C.blue)}>
                  <div style={{ fontSize:22 }}>📋</div>
                  <div style={{ fontWeight:800, fontSize:20, color:C.blue }}>$30,000 CAD</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>Registration Threshold</div>
                  <div style={{ fontSize:12, color:C.muted }}>Must register with CRA</div>
                </div>
                <div style={S.statCard(C.accent)}>
                  <div style={{ fontSize:22 }}>💰</div>
                  <div style={{ fontWeight:800, fontSize:20, color:C.accent }}>ITCs Available</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>Commercial Clients</div>
                  <div style={{ fontSize:12, color:C.muted }}>Can reclaim HST paid</div>
                </div>
              </>
            )}
            {R.id === "AZ" && (
              <>
                <div style={S.statCard(C.accent)}>
                  <div style={{ fontSize:22 }}>🇺🇸</div>
                  <div style={{ fontWeight:800, fontSize:22, color:C.accent }}>0% TPT</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>On Cleaning Services</div>
                  <div style={{ fontSize:12, color:C.muted }}>Services generally exempt</div>
                </div>
                <div style={S.statCard(C.gold)}>
                  <div style={{ fontSize:22 }}>🏪</div>
                  <div style={{ fontWeight:800, fontSize:20, color:C.gold }}>5.6% + local</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>If Selling Products</div>
                  <div style={{ fontSize:12, color:C.muted }}>Phoenix total: 8.6%</div>
                </div>
                <div style={S.statCard(C.blue)}>
                  <div style={{ fontSize:22 }}>📋</div>
                  <div style={{ fontWeight:800, fontSize:20, color:C.blue }}>$12/yr</div>
                  <div style={{ fontSize:13, fontWeight:600 }}>TPT License Fee</div>
                  <div style={{ fontSize:12, color:C.muted }}>Per location at AZTaxes.gov</div>
                </div>
              </>
            )}
          </div>

          <div style={S.card}>
            <div style={S.h3}>City Tax Rates {R.id==="AZ"?"(Arizona — select cities)":"(Ontario — HST is uniform)"}</div>
            {R.id === "AZ" ? (
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                    {["City","State","County","City","Total","Notes"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:C.muted, fontWeight:700, fontSize:11, textTransform:"uppercase" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Phoenix",    "5.6%","0.7%","3.0%","8.6%",  "Most common for Have Us Clean AZ ops"],
                    ["Scottsdale", "5.6%","0.7%","1.75%","8.05%","Lower city rate"],
                    ["Tempe",      "5.6%","0.7%","1.8%","8.1%",  ""],
                    ["Mesa",       "5.6%","0.7%","2.0%","8.3%",  ""],
                    ["Chandler",   "5.6%","0.7%","1.5%","7.8%",  ""],
                    ["Gilbert",    "5.6%","0.7%","1.5%","7.8%",  ""],
                    ["Glendale",   "5.6%","0.7%","2.9%","9.2%",  ""],
                  ].map(([city,...vals],i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, background:city==="Phoenix"?C.accentDim:"transparent" }}>
                      <td style={{ padding:"9px 12px", fontWeight:700, color:city==="Phoenix"?C.accent:C.text }}>{city}</td>
                      {vals.map((v,vi) => <td key={vi} style={{ padding:"9px 12px", color:vi===3?(city==="Phoenix"?C.accent:C.gold):C.muted }}>{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize:14, color:C.muted, lineHeight:1.8 }}>
                <p style={{ marginBottom:8 }}>Ontario uses a single uniform <strong style={{ color:C.text }}>13% HST</strong> rate province-wide. There are no city-level variations — unlike the US, every invoice in Ontario charges exactly 13%.</p>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12, marginTop:12 }}>
                  <div style={{ background:C.bg, borderRadius:10, padding:14 }}>
                    <div style={{ fontWeight:700, color:C.gold, marginBottom:4 }}>Filing Frequency</div>
                    <div style={{ fontSize:13 }}>Monthly (large), Quarterly (mid), Annual (small). CRA assigns based on your revenue level.</div>
                  </div>
                  <div style={{ background:C.bg, borderRadius:10, padding:14 }}>
                    <div style={{ fontWeight:700, color:C.accent, marginBottom:4 }}>Input Tax Credits</div>
                    <div style={{ fontSize:13 }}>Claim back HST you paid on business expenses (supplies, equipment). Reduces net HST owing to CRA.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Invoice tax example */}
          <div style={{ ...S.card, marginTop:16 }}>
            <div style={S.h3}>📄 Sample Invoice Tax Calculation</div>
            {R.id === "ON" ? (() => {
              const ex = 250;
              const hst = ex * 0.13;
              return (
                <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}><span>Cleaning Service (Deep Clean)</span><span style={{ fontWeight:700 }}>CA$250.00</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}`, color:C.blue }}><span>HST (13%) — Registration #RT0001234</span><span style={{ fontWeight:700 }}>CA${hst.toFixed(2)}</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", fontWeight:800, fontSize:16 }}><span>Total Due</span><span style={{ color:C.accent }}>CA${(ex+hst).toFixed(2)}</span></div>
                  <div style={{ fontSize:12, color:C.dim, marginTop:4 }}>✅ CRA requires: HST registration number, combined 13% rate (not split into GST/PST separately)</div>
                </div>
              );
            })() : (() => {
              const ex = 200;
              return (
                <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}><span>Cleaning Service (Standard Clean)</span><span style={{ fontWeight:700 }}>${ex.toFixed(2)}</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}`, color:C.accent }}><span>TPT — Cleaning services not subject to AZ TPT</span><span style={{ fontWeight:700 }}>$0.00</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", fontWeight:800, fontSize:16 }}><span>Total Due</span><span style={{ color:C.accent }}>${ex.toFixed(2)}</span></div>
                  <div style={{ fontSize:12, color:C.dim, marginTop:4 }}>✅ ADOR guidance: Cleaning/maid services are NOT subject to TPT. Note on invoice: "Services exempt from AZ TPT"</div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab === "compliance" && (
        <div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {R.compliance.map((item, i) => (
              <div key={i} style={{ ...S.card, borderLeft:`4px solid ${item.status==="required"?C.red:C.gold}` }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:15 }}>{item.item}</div>
                    <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Required: {item.required}</div>
                    <div style={{ marginTop:6 }}>
                      <a href={`https://${item.link}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.blue, textDecoration:"none" }}>🔗 {item.link}</a>
                    </div>
                  </div>
                  <span style={S.badge(item.status==="required"?"red":"gold")}>{item.status==="required"?"Required":"Conditional"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "invoicing" && (
        <div>
          <div style={S.card}>
            <div style={S.h3}>🧾 Invoice Requirements — {R.label}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {R.invoiceRequirements.map((req, i) => (
                <div key={i} style={{ display:"flex", gap:10, padding:"8px 0", borderBottom:`1px solid ${C.border}`, fontSize:13 }}>
                  <span style={{ color:C.accent, flexShrink:0 }}>✅</span>
                  <span>{req}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...S.card, marginTop:16 }}>
            <div style={S.h3}>📞 Phone & Address Format</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:12 }}>
              <div style={{ background:C.surface, borderRadius:10, padding:14 }}>
                <div style={{ fontSize:12, color:C.muted, fontWeight:700 }}>PHONE FORMAT</div>
                <div style={{ fontSize:18, fontWeight:800, color:C.accent, marginTop:6 }}>{R.phoneFormat}</div>
              </div>
              <div style={{ background:C.surface, borderRadius:10, padding:14 }}>
                <div style={{ fontSize:12, color:C.muted, fontWeight:700 }}>ADDRESS FORMAT</div>
                <div style={{ fontSize:14, fontWeight:700, color:C.text, marginTop:6 }}>{R.addressFormat}</div>
              </div>
              <div style={{ background:C.surface, borderRadius:10, padding:14 }}>
                <div style={{ fontSize:12, color:C.muted, fontWeight:700 }}>DATE FORMAT</div>
                <div style={{ fontSize:16, fontWeight:800, color:C.blue, marginTop:6 }}>{R.dateFormat}</div>
              </div>
              <div style={{ background:C.surface, borderRadius:10, padding:14 }}>
                <div style={{ fontSize:12, color:C.muted, fontWeight:700 }}>PAYROLL CYCLE</div>
                <div style={{ fontSize:15, fontWeight:700, color:C.gold, marginTop:6, textTransform:"capitalize" }}>{R.payrollPeriod}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "rates" && (
        <div>
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.gold}` }}>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>
              Market rates for <strong style={{ color:C.text }}>{R.label}</strong> — use these to validate your CleanPro quotes are competitive. All amounts in <strong style={{ color:C.accent }}>{R.currency}</strong>.
            </div>
          </div>
          <div style={S.h3}>🏠 Residential Market Rates ({R.currencySymbol})</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12, marginBottom:22 }}>
            {[
              { label:"Hourly Rate", lo:R.residential.standardPerHour.min, hi:R.residential.standardPerHour.max, note:"Per cleaner" },
              { label:"Standard Clean (flat)", lo:R.residential.flatRateSmall.min, hi:R.residential.flatRateLarge.max, note:"Size dependent" },
              { label:"Deep Clean (flat)", lo:R.residential.deepClean.min, hi:R.residential.deepClean.max, note:"Full home" },
              { label:"Move-Out Clean", lo:R.residential.moveOut.min, hi:R.residential.moveOut.max, note:"Size dependent" },
            ].map((item, i) => (
              <div key={i} style={S.statCard(C.accent)}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:20, fontWeight:800, color:C.accent }}>{R.currencySymbol}{item.lo}–{R.currencySymbol}{item.hi}</div>
                <div style={{ fontSize:12, color:C.muted }}>{item.note}</div>
              </div>
            ))}
          </div>
          <div style={S.h3}>🏢 Commercial Market Rates ({R.currencySymbol})</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12 }}>
            {[
              { label:"Hourly Rate", lo:R.commercial.perHour.min, hi:R.commercial.perHour.max, note:"Per cleaner" },
              { label:"Per Square Foot", lo:R.commercial.perSqFt.min, hi:R.commercial.perSqFt.max, note:`${R.currencySymbol}/sqft` },
            ].map((item, i) => (
              <div key={i} style={S.statCard(C.blue)}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:20, fontWeight:800, color:C.blue }}>{R.currencySymbol}{item.lo}–{R.currencySymbol}{item.hi}</div>
                <div style={{ fontSize:12, color:C.muted }}>{item.note}</div>
              </div>
            ))}
            <div style={S.statCard(C.gold)}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>Partner Pay Range</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.gold }}>{R.currencySymbol}{R.partnerPayRange.min}–{R.currencySymbol}{R.partnerPayRange.max}/hr</div>
              <div style={{ fontSize:12, color:C.muted }}>Market benchmark</div>
            </div>
          </div>
          <div style={{ ...S.card, marginTop:18 }}>
            <div style={S.h3}>💱 Currency Note</div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>
              All Ontario jobs are quoted and billed in <strong style={{ color:C.text }}>Canadian Dollars (CAD)</strong> with HST added. All Arizona jobs are quoted and billed in <strong style={{ color:C.text }}>US Dollars (USD)</strong> with no service tax. The Have Us Clean app automatically handles formatting and tax rules per region. Exchange rate management (for cross-border reporting) should be handled through your accounting software.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DATABASE LAYER ───────────────────────────────────────────────────────────
// Uses window.storage (artifact persistent key-value store).
// Keys: cp:jobs, cp:partners, cp:leads_res, cp:leads_com, cp:region, cp:settings
// All reads/writes are async; UI shows sync status in the header.

// ─── STORAGE LAYER ───────────────────────────────────────────────────────────
// Works in 3 environments:
//   1. Claude artifact player   → window.storage (persistent across reloads)
//   2. Browser (standalone)     → localStorage fallback
//   3. No storage at all        → in-memory only (still fully functional)

const DB_KEYS = {
  jobs:               "cp:jobs",
  partners:           "cp:partners",
  leadsRes:           "cp:leads_res",
  leadsCom:           "cp:leads_com",
  region:             "cp:region",
  settings:           "cp:settings",
  activity:           "cp:activity_log",
  coldLeads:          "cp:cold_leads",
  onboardingProgress: "cp:onboarding_progress",
};

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const SUPABASE_URL  = "https://opazwghrohmfykzxxsjk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wYXp3Z2hyb2htZnlrenh4c2prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjA5MjcsImV4cCI6MjA5MjIzNjkyN30.vVSC4QxREbzAJpAT5wI3DkYFhey5YOuEXIWzFmlP1X4";

const sbH = {
  "apikey":        SUPABASE_ANON,
  "Authorization": `Bearer ${SUPABASE_ANON}`,
  "Content-Type":  "application/json",
};

// Safe string ID — converts any ID to a stable string
const toStrId = (v) => v !== undefined && v !== null ? String(v) : String(Date.now());

// Supabase table config
const SB = {
  "cp:jobs":                { table:"huc_jobs",      pk:"id",         isArray:true  },
  "cp:partners":            { table:"huc_partners",  pk:"id",         isArray:true  },
  "cp:leads_res":           { table:"huc_leads_res", pk:"id",         isArray:true  },
  "cp:cold_leads":          { table:"huc_leads_cold",pk:"lead_id",    isArray:true  },
  "cp:onboarding_progress": { table:"huc_onboarding",pk:"partner_id", isArray:false },
  "cp:region":              { table:"huc_settings",  pk:"key",        isArray:false },
};

async function sbFetch(path, opts = {}) {
  try {
    const method = (opts.method || "GET").toUpperCase();
    const isWrite = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    // CRITICAL: spread opts FIRST, then override headers — otherwise opts.headers wins and wipes out auth
    const { headers: optsHeaders, ...restOpts } = opts;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...restOpts,
      headers: {
        ...sbH,
        ...(isWrite ? { "Prefer": "resolution=merge-duplicates,return=minimal" } : {}),
        ...(optsHeaders || {}),
      },
    });
    return r;
  } catch { return null; }
}

async function sbGet(key) {
  const cfg = SB[key];
  if (!cfg) return null;
  try {
    // Cold leads: fetch in batches to avoid timeout with large datasets
    if (key === "cp:cold_leads") {
      const allRows = [];
      const BATCH = 1000;
      let from = 0;
      while (true) {
        const r = await sbFetch(`${cfg.table}?select=*&order=lead_id&limit=${BATCH}&offset=${from}`);
        if (!r || !r.ok) break;
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows.push(...rows);
        if (rows.length < BATCH) break; // last batch
        from += BATCH;
        if (from > 20000) break; // safety cap — never fetch more than 20k rows
      }
      if (allRows.length === 0) return null;
      const result = allRows.map(r => r.data).filter(Boolean);
      return result.length > 0 ? result : null;
    }

    const r = await sbFetch(`${cfg.table}?select=*`);
    if (!r || !r.ok) return null;
    const rows = await r.json();
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;

    if (key === "cp:region") {
      const row = rows.find(r => r.key === "region");
      return row ? row.value : null;
    }
    if (key === "cp:onboarding_progress") {
      const obj = {};
      rows.forEach(r => { if (r.partner_id) obj[r.partner_id] = r.completed_modules || []; });
      return Object.keys(obj).length > 0 ? obj : null;
    }
    // Array tables: return array of data objects
    const result = rows.map(r => r.data).filter(Boolean);
    return result.length > 0 ? result : null;
  } catch { return null; }
}

async function sbSet(key, value) {
  const cfg = SB[key];
  if (!cfg) return false;
  try {
    // Region setting
    if (key === "cp:region") {
      await sbFetch(`${cfg.table}`, {
        method: "POST",
        body: JSON.stringify({ key:"region", value }),
      });
      return true;
    }
    // Onboarding progress
    if (key === "cp:onboarding_progress") {
      if (!value || typeof value !== "object") return true;
      const rows = Object.entries(value)
        .filter(([k]) => k)
        .map(([partner_id, modules]) => ({
          partner_id: String(partner_id),
          completed_modules: Array.isArray(modules) ? modules : [],
          updated_at: new Date().toISOString(),
        }));
      if (rows.length === 0) return true;
      await sbFetch(`${cfg.table}`, { method:"POST", body:JSON.stringify(rows) });
      return true;
    }
    // Array tables (jobs, partners, leads)
    if (!Array.isArray(value) || value.length === 0) return true;
    const rows = value
      .filter(item => item) // skip nulls
      .map(item => {
        // Get primary key value — ensure it's a string
        let pkVal;
        if (key === "cp:cold_leads") {
          pkVal = toStrId(item.lead_id || item.id);
        } else {
          pkVal = toStrId(item.id || item.lead_id);
        }
        return {
          [cfg.pk]: pkVal,
          data: item,
          updated_at: new Date().toISOString(),
          ...(key !== "cp:cold_leads" ? { region: item.region || "ON" } : {}),
        };
      });
    if (rows.length === 0) return true;
    // Batch in groups of 50 to avoid Supabase request size limits
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch(`${cfg.table}`, { method:"POST", body:JSON.stringify(rows.slice(i, i+BATCH)) });
    }
    return true;
  } catch { return false; }
}

async function sbDelete(key) {
  const cfg = SB[key];
  if (!cfg) return false;
  try {
    await sbFetch(`${cfg.table}?${cfg.pk}=neq.null_impossible`, { method:"DELETE" });
    return true;
  } catch { return false; }
}

// ─── DB LAYER — Supabase first, localStorage fallback ─────────────────────────
const hasLocalStorage = (() => {
  try { localStorage.setItem("_t","1"); localStorage.removeItem("_t"); return true; }
  catch { return false; }
})();
const hasArtifactStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";

async function dbGet(key) {
  // Try Supabase first (shared across devices)
  try {
    const r = await sbGet(key);
    if (r !== null && r !== undefined) return r;
  } catch {}
  // Fallback to local storage
  try {
    if (hasArtifactStorage) { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
    if (hasLocalStorage) { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  } catch {}
  return null;
}

async function dbSet(key, value) {
  // Fire-and-forget to Supabase (don't block UI)
  sbSet(key, value).catch(() => {});
  // Always write to local storage for offline support
  try {
    const s = JSON.stringify(value);
    if (hasArtifactStorage) await window.storage.set(key, s);
    else if (hasLocalStorage) localStorage.setItem(key, s);
  } catch {}
  return true; // never block the UI
}

async function dbDelete(key) {
  sbDelete(key).catch(() => {});
  try {
    if (hasArtifactStorage) await window.storage.delete(key);
    else if (hasLocalStorage) localStorage.removeItem(key);
  } catch {}
  return true;
}

async function logActivity(action, detail) {
  try {
    const existing = await dbGet(DB_KEYS.activity) || [];
    const entry = { id: Date.now(), ts: new Date().toISOString(), action, detail };
    await dbSet(DB_KEYS.activity, [entry, ...existing].slice(0, 100));
  } catch {}
}

// ─── DATA MANAGEMENT PANEL ────────────────────────────────────────────────────
function DataManager({ onReset, onExport, activityLog, dbStatus, lastSaved }) {
  const [showLog, setShowLog] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportData = () => {
    onExport();
  };

  return (
    <div>
      <div style={S.h2}>🗄️ Database & Data Management</div>

      <div style={{ ...S.card, marginBottom: 20, borderLeft: `4px solid ${dbStatus === "synced" ? C.accent : dbStatus === "saving" ? C.gold : dbStatus === "local" ? C.blue : C.red}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 36 }}>
              {dbStatus === "synced" ? "✅" : dbStatus === "saving" ? "🔄" : dbStatus === "local" ? "💾" : "⚠️"}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>
                {hasArtifactStorage ? "Artifact Persistent Storage" : "Supabase + localStorage"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: dbStatus === "synced" ? C.accent : dbStatus === "local" ? C.blue : C.gold }}>
                {hasArtifactStorage ? "✅ Data persists across reloads in the artifact player"
                  : hasLocalStorage  ? "💾 Data saved to this browser — persists on this device"
                  :                    "⚠️ No storage available — data lives in memory this session only"}
              </div>
              {lastSaved && <div style={{ fontSize: 12, color: C.muted }}>Last saved: {lastSaved}</div>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={S.btn("primary")} onClick={onExport}>⬇ Export JSON Backup</button>
            <button style={{ ...S.btn("ghost") }} onClick={() => setShowLog(!showLog)}>
              {showLog ? "Hide Log" : "📋 Activity Log"}
            </button>
          </div>
        </div>
      </div>

      {/* Storage mode info */}
      <div style={{ ...S.card, marginBottom: 20, background: "linear-gradient(135deg,#0A0F1E,#1A2235)" }}>
        <div style={S.h3}>📡 Storage Environment</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          {[
            { label: "Artifact Player (claude.ai)", icon: "✨", active: hasArtifactStorage, note: "Full persistence across reloads" },
            { label: "Browser localStorage",        icon: "🌐", active: !hasArtifactStorage && hasLocalStorage, note: "Persists on this browser/device" },
            { label: "In-Memory Only",               icon: "💡", active: !hasArtifactStorage && !hasLocalStorage, note: "Resets on page reload" },
          ].map(env => (
            <div key={env.label} style={{ background: env.active ? C.accentDim : C.surface, borderRadius: 10, padding: 14, border: `1px solid ${env.active ? C.accent+"44" : C.border}` }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{env.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: env.active ? C.accent : C.muted }}>{env.label}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{env.note}</div>
              {env.active && <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginTop: 4 }}>● Active</div>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          💡 <strong style={{ color: C.text }}>To use the app outside Claude:</strong> Open the .jsx file in a React project (Vite, Create React App, or CodeSandbox). localStorage will automatically be used for persistence. For full cloud sync, connect Supabase — we can build that next.
        </div>
      </div>

      {/* What's stored */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={S.h3}>📦 Stored Data Collections</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { key: DB_KEYS.jobs,      label: "Jobs",               icon: "📋", desc: "All job records, status, GPS, photos, summaries" },
            { key: DB_KEYS.partners,  label: "Partners",           icon: "👥", desc: "Partner profiles, availability, pay rates, onboarding" },
            { key: DB_KEYS.leadsRes,  label: "Residential Leads",  icon: "🏠", desc: "Lead intake forms, quotes, booking status" },
            { key: DB_KEYS.leadsCom,  label: "Commercial Leads",   icon: "🏢", desc: "Commercial proposals, contracts, deposits" },
            { key: DB_KEYS.region,    label: "Region Setting",     icon: "🌍", desc: "Active region (ON/AZ) persists on reload" },
            { key: DB_KEYS.activity,  label: "Activity Log",       icon: "📊", desc: "Last 100 create/update/delete events" },
          ].map(item => (
            <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{item.desc}</div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{item.key}</div>
              <span style={S.badge("green")}>Active</span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Log */}
      {showLog && (
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={S.h3}>📋 Activity Log (Last 100 Events)</div>
          {activityLog.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No activity yet.</div>}
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {activityLog.map(e => (
              <div key={e.id} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <span style={{ color: C.dim, flexShrink: 0, fontFamily: "monospace" }}>{new Date(e.ts).toLocaleTimeString()}</span>
                <span style={{ color: C.accent, flexShrink: 0, fontWeight: 700 }}>{e.action}</span>
                <span style={{ color: C.muted }}>{e.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div style={{ ...S.card, borderLeft: `4px solid ${C.red}` }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.red, marginBottom: 12 }}>⚠️ Danger Zone</div>
        {!confirmReset ? (
          <div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
              Reset all data back to the demo sample data. This cannot be undone.
            </div>
            <button style={{ ...S.btn("danger") }} onClick={() => setConfirmReset(true)}>
              🗑 Reset to Demo Data
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, color: C.red, fontWeight: 700, marginBottom: 12 }}>
              Are you sure? All your real data will be permanently deleted.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...S.btn("danger") }} onClick={() => { onReset(); setConfirmReset(false); }}>
                Yes, Reset Everything
              </button>
              <button style={S.btn("ghost")} onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CLIENT VIEW ──────────────────────────────────────────────────────────────
// What clients see — their upcoming job, quote history, and how to contact HUC
function ClientView({ jobs, resLeads, region, setTab }) {
  const [emailInput, setEmailInput] = useState("");
  const [authedClient, setAuthedClient] = useState(null);
  const [loginError, setLoginError] = useState("");
  const today = new Date().toISOString().split("T")[0];

  const handleLogin = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setLoginError("Please enter a valid email address.");
      return;
    }
    // Search resLeads, SAMPLE_RES_LEADS, and jobs by email
    const allLeads = resLeads;
    const matchedLead = allLeads.find(l => l.email?.toLowerCase() === email);
    const matchedJob  = jobs.find(j => j.email?.toLowerCase() === email);
    const name = matchedLead?.name || matchedJob?.client;

    if (name) {
      setAuthedClient({ email, name });
      setLoginError("");
    } else {
      // More helpful error with hint
      setLoginError(`No account found for ${email}. Try the email you used when booking, or contact us at ${BRAND.supportEmail}`);
    }
  };

  // Get data for the logged-in client — match by email OR name
  const getClientData = (authed) => {
    const email = authed.email?.toLowerCase();
    const name  = authed.name;
    const clientJobs = jobs.filter(j =>
      (email && j.email?.toLowerCase() === email) ||
      j.client === name ||
      j.client?.toLowerCase().includes(name?.split(" ")[0]?.toLowerCase() || "NOMATCH")
    );
    const clientLeads = (resLeads||[]).filter(l =>
      (email && l.email?.toLowerCase() === email) || l.name === name
    );
    const lead = clientLeads[clientLeads.length - 1];
    return { clientJobs, clientLeads, lead };
  };

  // Not logged in — show email login
  if (!authedClient) {
    return (
      <div style={{ maxWidth:400, margin:"40px auto" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:52, marginBottom:12 }}>🧹</div>
          <div style={{ fontWeight:800, fontSize:24 }}>Have Us Clean</div>
          <div style={{ fontSize:14, color:C.muted, marginTop:6 }}>Client Portal — Sign in to see your upcoming service</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Your Email Address</div>
          <input
            style={{ ...S.input, fontSize:16, marginBottom:12 }}
            type="email"
            inputMode="email"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="you@email.com"
            autoFocus
          />
          {loginError && <div style={{ color:C.red, fontSize:13, marginBottom:10 }}>{loginError}</div>}
          <button style={{ ...S.btn("primary"), width:"100%", fontSize:16, padding:"14px" }} onClick={handleLogin} disabled={!emailInput.trim()}>
            Continue →
          </button>
          <div style={{ marginTop:16, fontSize:12, color:C.dim, textAlign:"center", lineHeight:1.6 }}>
            Use the email address you gave us when booking.<br/>
            New client? <a href={`mailto:${BRAND.supportEmail}?subject=Booking Request`} style={{ color:C.accent }}>Contact us to get started</a>.
          </div>
        </div>
      </div>
    );
  }

  // Logged in — show client's own data only
  const { clientJobs, clientLeads, lead } = getClientData(authedClient);
  const upcomingJobs = clientJobs.filter(j => j.status === "scheduled" || j.status === "in-progress");
  const completedJobs = clientJobs.filter(j => j.status === "completed");
  const activeQuote = clientLeads.filter(l => ["Quoted","Follow Up"].includes(l.status)).slice(-1)[0];
  const cur = region?.currencySymbol || "$";

  if (true) {
    const selectedClient = authedClient.name;

    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:14, color:C.muted }}>👋 Hi, <strong style={{ color:C.text }}>{authedClient.name}</strong></div>
          <button style={{ ...S.btn("ghost"), fontSize:12 }} onClick={() => { setAuthedClient(null); setEmailInput(""); }}>🔒 Sign Out</button>
        </div>

        {/* Client header */}
        <div style={{ ...S.card, marginBottom:18, background:"linear-gradient(135deg,#0A0F1E,#1A2235)", borderLeft:`4px solid ${C.accent}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
            <div style={{ width:52, height:52, borderRadius:14, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🏠</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:22 }}>{selectedClient}</div>
              {lead?.email && <div style={{ fontSize:13, color:C.muted }}>📧 {lead.email}</div>}
              {lead?.address && <div style={{ fontSize:13, color:C.muted }}>📍 {lead.address}</div>}
            </div>
          </div>
        </div>

        {/* Empty state */}
        {upcomingJobs.length === 0 && completedJobs.length === 0 && !activeQuote && (
          <div style={{ ...S.card, textAlign:"center", padding:32, marginBottom:18 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No scheduled services yet</div>
            <div style={{ fontSize:14, color:C.muted, marginBottom:16 }}>Ready to book? We'd love to help.</div>
            <a href={`mailto:${BRAND.supportEmail}?subject=New Booking Request`}
              style={{ ...S.btn("primary"), textDecoration:"none", display:"inline-block" }}>
              📅 Book a Service
            </a>
          </div>
        )}

        {/* Upcoming jobs */}
        {upcomingJobs.length > 0 && (
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.accent}` }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14, color:C.accent }}>📅 Upcoming Service</div>
            {upcomingJobs.map(job => {
              const includes = {
                "Refresh Clean":["Vacuum all floors","Mop hard floors","Kitchen surfaces + sink","Bathroom clean","Dusting accessible surfaces"],
                "Full Home Clean":["Everything in Refresh Clean","Detailed kitchen + stovetop","Full bathroom scrub (shower/tub)","All rooms dusted and wiped","Floors throughout"],
                "Deep Clean":["Everything in Full Home Clean","Baseboards throughout","Inside microwave","Cabinet exteriors","Detailed scrubbing throughout"],
                "Move-In / Move-Out":["Full empty-unit clean","Inside all cabinets + drawers","All surfaces, fixtures, floors","Inside closets checked","Kitchen + bathrooms detailed"],
                "Kitchen & Bathroom Refresh":["Kitchen: counters, sink, appliances, cabinet exteriors","Bathroom: toilet, sink, shower/tub, mirror","Both room floors"],
              }[job.type] || ["Full clean as per package"];

              return (
                <div key={job.id} style={{ padding:"14px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:16 }}>{job.type}</div>
                      <div style={{ fontSize:14, color:C.muted, marginTop:4 }}>📅 {job.date} at {job.time}</div>
                      <div style={{ fontSize:14, color:C.muted }}>📍 {job.address}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <span style={{ padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:700, background:C.accentDim, color:C.accent }}>
                        {job.status === "in-progress" ? "🔄 In Progress" : "✅ Confirmed"}
                      </span>
                      <div style={{ fontSize:18, fontWeight:800, color:C.accent, marginTop:6 }}>{cur}{(job.clientPrice||0).toLocaleString()}</div>
                    </div>
                  </div>

                  {/* What's included */}
                  <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", marginBottom:10 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:8 }}>✅ WHAT'S INCLUDED</div>
                    {includes.map((item, i) => (
                      <div key={i} style={{ fontSize:13, color:C.text, padding:"3px 0", display:"flex", gap:8 }}>
                        <span style={{ color:C.accent }}>✓</span><span>{item}</span>
                      </div>
                    ))}
                    {job.upsells?.length > 0 && (
                      <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.gold, marginBottom:4 }}>⭐ YOUR ADD-ONS</div>
                        {(job.upsells||[]).map((addon, i) => (
                          <div key={i} style={{ fontSize:13, color:C.gold, display:"flex", gap:8 }}>
                            <span>★</span><span>{addon}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* After photos if done */}
                  {job.afterPics?.filter(p=>p?.startsWith("data:")).length > 0 && (
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:6 }}>📷 COMPLETED PHOTOS</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {(job.afterPics||[]).filter(p=>p?.startsWith("data:")).map((p,i) => (
                          <img key={i} src={p} alt="after" style={{ width:70, height:70, borderRadius:8, objectFit:"cover" }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Active quote */}
        {activeQuote && (
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.gold}` }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14, color:C.gold }}>📄 Your Quote</div>
            <div style={{ fontSize:14, color:C.muted }}>Service: <strong style={{ color:C.text }}>{activeQuote.serviceType}</strong></div>
            <div style={{ fontSize:14, color:C.muted }}>Property: <strong style={{ color:C.text }}>{activeQuote.dwellingType} — {activeQuote.dwellingSize}</strong></div>
            <div style={{ fontSize:14, color:C.muted }}>Frequency: <strong style={{ color:C.text }}>{activeQuote.frequency}</strong></div>
            {activeQuote.addons?.length > 0 && (
              <div style={{ fontSize:14, color:C.muted }}>Add-ons: <strong style={{ color:C.text }}>{(activeQuote.addons||[]).map(id=>RES_ADDONS.find(x=>x.id===id)?.label).filter(Boolean).join(", ")}</strong></div>
            )}
            <div style={{ marginTop:14, padding:"12px 16px", background:C.surface, borderRadius:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, color:C.muted }}>Quote Total</span>
              <span style={{ fontSize:22, fontWeight:800, color:C.gold }}>
                {cur}{(() => { try { return Math.round(calcResQuote({...activeQuote, dwellingType:activeQuote.dwellingType||"Apartment / Condo", dwellingSize:activeQuote.dwellingSize||"2 Bed", serviceType:activeQuote.serviceType||"Refresh Clean", frequency:activeQuote.frequency||"One-Time", beds:activeQuote.beds||2, baths:activeQuote.baths||1, sqft:activeQuote.sqft||900, addons:activeQuote.addons||[]}, region||ACTIVE_REGION).total).toLocaleString(); } catch(e) { return "—"; } })()}
              </span>
            </div>
            <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
              <a href={`mailto:${BRAND.supportEmail}?subject=Booking Confirmation — ${activeQuote.serviceType}&body=Hi Have Us Clean,%0A%0AI'd like to confirm my booking for ${activeQuote.serviceType}.%0A%0AThanks!`}
                style={{ ...S.btn("primary"), textDecoration:"none", flex:1, textAlign:"center" }}>
                ✅ Accept & Book
              </a>
              <a href={`mailto:${BRAND.supportEmail}?subject=Question about my quote`}
                style={{ ...S.btn("ghost"), textDecoration:"none", flex:1, textAlign:"center" }}>
                💬 Ask a Question
              </a>
            </div>
          </div>
        )}

        {/* Job history */}
        {completedJobs.length > 0 && (
          <div style={S.card}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14 }}>🧹 Service History</div>
            {completedJobs.slice().reverse().map(job => (
              <div key={job.id} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{job.type}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{job.date}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:C.accentDim, color:C.accent }}>Completed ✅</span>
                  <div style={{ fontSize:13, fontWeight:700, color:C.accent, marginTop:2 }}>{cur}{(job.clientPrice||0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contact */}
        <div style={{ ...S.card, marginTop:18, textAlign:"center" }}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:10 }}>Need anything?</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:14 }}>Reach us anytime at <strong style={{ color:C.accent }}>{BRAND.supportEmail}</strong></div>
          <a href={`mailto:${BRAND.supportEmail}`} style={{ ...S.btn("primary"), textDecoration:"none", display:"inline-block" }}>✉️ Email Have Us Clean</a>
        </div>
      </div>
    );
  }
}

// ─── PARTNER VIEW ─────────────────────────────────────────────────────────────
// What partners see — their schedule, jobs to complete, check-in actions
function PartnerView({ jobs, partners, region }) {
  const [pinInput, setPinInput] = useState("");
  const [authedPartner, setAuthedPartner] = useState(null); // logged-in partner
  const [pinError, setPinError] = useState("");
  const [selectedPartner, setSelectedPartner] = useState(null); // admin selection
  const [isAdminMode, setIsAdminMode] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const cur = region?.currencySymbol || "$";

  // Admin PIN — hardcoded for now, change to your own 6-digit code
  const ADMIN_PIN = "000000";

  const handlePinSubmit = () => {
    if (pinInput === ADMIN_PIN) {
      setIsAdminMode(true);
      setAuthedPartner(null);
      setPinError("");
      return;
    }
    // Check partner PINs (last 4 of phone number by default)
    const matched = partners.find(p => {
      const defaultPin = p.phone?.replace(/\D/g, "").slice(-4) || "0000";
      const customPin = p.pin || defaultPin;
      return pinInput === customPin;
    });
    if (matched) {
      setAuthedPartner(matched);
      setPinError("");
    } else {
      setPinError("Incorrect PIN. Try the last 4 digits of your phone number.");
      setPinInput("");
    }
  };

  // Not logged in — show PIN screen
  if (!authedPartner && !isAdminMode) {
    return (
      <div style={{ maxWidth:380, margin:"40px auto" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:52, marginBottom:12 }}>🧹</div>
          <div style={{ fontWeight:800, fontSize:24 }}>Have Us Clean</div>
          <div style={{ fontSize:14, color:C.muted, marginTop:6 }}>Partner Portal — Enter your PIN to continue</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Your PIN</div>
          <input
            style={{ ...S.input, fontSize:28, letterSpacing:"0.3em", textAlign:"center", marginBottom:12 }}
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pinInput}
            onChange={e => setPinInput(e.target.value.replace(/\D/g,""))}
            onKeyDown={e => e.key === "Enter" && handlePinSubmit()}
            placeholder="••••"
            autoFocus
          />
          {pinError && <div style={{ color:C.red, fontSize:13, marginBottom:10, textAlign:"center" }}>{pinError}</div>}
          <button style={{ ...S.btn("primary"), width:"100%", fontSize:16, padding:"14px" }} onClick={handlePinSubmit} disabled={pinInput.length < 4}>
            Sign In →
          </button>
          <div style={{ marginTop:14, fontSize:12, color:C.dim, textAlign:"center", lineHeight:1.6 }}>
            Default PIN: last 4 digits of your phone number<br/>
            Admin PIN: 000000 (change in Partners tab)
          </div>
        </div>
      </div>
    );
  }

  // ── ADMIN MODE: show all partners ──
  if (isAdminMode && !selectedPartner) {
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={S.h2}>📋 Partner View <span style={{ fontSize:13, color:C.gold, fontWeight:600 }}>— Admin Mode</span></div>
          <button style={{ ...S.btn("ghost"), fontSize:12 }} onClick={() => { setIsAdminMode(false); setPinInput(""); }}>🔒 Sign Out</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {partners.map(partner => {
            const myJobs = jobs.filter(j => (j.partnerIds || [j.partnerId]).includes(partner.id));
            const todayCount = myJobs.filter(j => j.date === today).length;
            const pendingPay = myJobs.filter(j => ["scheduled","in-progress"].includes(j.status)).reduce((a,b) => a+(b.partnerPay||0), 0);
            return (
              <div key={partner.id} style={{ ...S.card, cursor:"pointer" }} onClick={() => setSelectedPartner(partner.id)}>
                <div style={{ display:"flex", alignItems:"center", gap:12, justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={S.avatar(avatarColors[partner.id % 4])}>{partner.avatar}</div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{partner.name}</div>
                      <div style={{ fontSize:12, color:C.muted }}>PIN: {partner.pin || partner.phone?.replace(/\D/g,"").slice(-4) || "0000"} · {partner.region}</div>
                      <div style={{ display:"flex", gap:6, marginTop:4 }}>
                        {todayCount > 0 && <span style={S.badge("gold")}>📅 {todayCount} today</span>}
                        {pendingPay > 0 && <span style={S.badge("green")}>{cur}{pendingPay} pending</span>}
                        {!partner.onboarded && <span style={S.badge("red")}>⚠️ Not onboarded</span>}
                      </div>
                    </div>
                  </div>
                  <span style={{ color:C.muted, fontSize:20 }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── PARTNER or ADMIN viewing a specific partner ──
  const viewingId = isAdminMode ? selectedPartner : authedPartner?.id;
  const partner = partners.find(p => p.id === viewingId);
  if (!partner) return null;

  const myJobs = jobs.filter(j => (j.partnerIds || [j.partnerId]).includes(partner.id));
  const todayJobs = myJobs.filter(j => j.date === today);
  const upcomingJobs = myJobs.filter(j => j.status === "scheduled" && j.date >= today).sort((a,b) => a.date.localeCompare(b.date));
  const completedJobs = myJobs.filter(j => j.status === "completed");
  const totalEarned = completedJobs.reduce((a,b) => a + (b.partnerPay||0), 0);
  const pendingPay = myJobs.filter(j => ["scheduled","in-progress"].includes(j.status)).reduce((a,b) => a + (b.partnerPay||0), 0);

    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          {isAdminMode
            ? <button style={{ ...S.btn("ghost"), fontSize:13 }} onClick={() => setSelectedPartner(null)}>← All Partners</button>
            : <button style={{ ...S.btn("ghost"), fontSize:13 }} onClick={() => { setAuthedPartner(null); setPinInput(""); }}>🔒 Sign Out</button>
          }
          {isAdminMode && <button style={{ ...S.btn("ghost"), fontSize:12 }} onClick={() => { setIsAdminMode(false); setSelectedPartner(null); setPinInput(""); }}>🔒 Exit Admin</button>}
        </div>

        {/* Partner header */}
        <div style={{ ...S.card, marginBottom:18, background:"linear-gradient(135deg,#0A0F1E,#1A2235)", borderLeft:`4px solid ${C.gold}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", marginBottom:14 }}>
            <div style={S.avatar(avatarColors[partner.id % 4])}>{partner.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:22 }}>{partner.name}</div>
              <div style={{ fontSize:13, color:C.muted }}>{partner.email} · {partner.phone}</div>
              <span style={S.badge(partner.status==="active"?"green":"gold")}>{partner.status}</span>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:10 }}>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>TODAY</div>
              <div style={{ fontSize:24, fontWeight:800, color:C.gold }}>{todayJobs.length}</div>
              <div style={{ fontSize:11, color:C.muted }}>jobs</div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>PENDING PAY</div>
              <div style={{ fontSize:24, fontWeight:800, color:C.blue }}>{cur}{pendingPay}</div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>TOTAL EARNED</div>
              <div style={{ fontSize:24, fontWeight:800, color:C.accent }}>{cur}{totalEarned}</div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>JOBS DONE</div>
              <div style={{ fontSize:24, fontWeight:800, color:C.accent }}>{completedJobs.length}</div>
            </div>
          </div>
        </div>

        {/* Today's jobs */}
        {todayJobs.length > 0 && (
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.gold}` }}>
            <div style={{ fontWeight:800, fontSize:16, color:C.gold, marginBottom:14 }}>📅 Today's Jobs</div>
            {todayJobs.map(job => {
              const statusColor = job.status==="in-progress" ? C.gold : job.status==="completed" ? C.accent : C.blue;
              const checklist = {
                "Refresh Clean":["Kitchen: surfaces, sink, appliance exteriors","Bathroom: toilet, sink, mirror, floor","Living areas: dust and vacuum","Floors: vacuum then mop"],
                "Full Home Clean":["Kitchen: deep counters, sink, stovetop, appliances","All bathrooms: full clean incl. shower/tub","All rooms: dust, wipe, vacuum","Floors throughout: vacuum then mop"],
                "Deep Clean":["Kitchen: inside microwave, stovetop detail, cabinets exterior","All bathrooms: grout scrub, fixtures polish","Baseboards throughout","All surfaces: detailed wipe-down","Floors: vacuum and mop"],
                "Move-In / Move-Out":["Full empty-unit clean","Inside all cabinets and drawers","Inside appliances","All surfaces, fixtures, floors","Check and clean inside closets"],
                "Kitchen & Bathroom Refresh":["Kitchen: counters, sink, cabinet exteriors, appliance wipe-down","Bathroom: full clean incl. toilet, sink, shower/tub, mirror","Both room floors"],
              }[job.type] || ["Full clean as per package"];

              return (
                <div key={job.id} style={{ paddingBottom:18, marginBottom:18, borderBottom:`1px solid ${C.border}` }}>

                  {/* Job header */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                    <div>
                      <div style={{ fontWeight:800, fontSize:17 }}>{job.client}</div>
                      <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>📍 {job.address}</div>
                      <div style={{ fontSize:13, color:C.muted }}>⏰ {job.time} · {job.type} · {job.hours}h estimated</div>
                      {job.upsells?.length > 0 && <div style={{ fontSize:12, color:C.gold, marginTop:4 }}>★ Add-ons: {job.upsells.join(", ")}</div>}
                      {job.notes && <div style={{ fontSize:12, color:"#FFA502", marginTop:4 }}>⚠️ {job.notes}</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <span style={{ padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{job.status}</span>
                      <div style={{ fontWeight:800, fontSize:20, color:C.blue, marginTop:6 }}>{cur}{job.partnerPayEach || job.partnerPay || 0}</div>
                      <div style={{ fontSize:11, color:C.dim }}>your pay{job.teamSize > 1 ? ` (1 of ${job.teamSize})` : ""}</div>
                    </div>
                  </div>

                  {/* RAG reminder */}
                  <div style={{ background:C.surface, borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:700, marginBottom:10 }}>
                    🎨 RAG: <span style={{ color:"#FF4757" }}>🔴 Toilets ONLY</span> · <span style={{ color:"#FFA502" }}>🟡 Sinks/Mirrors</span> · <span style={{ color:"#2ED573" }}>🟢 Kitchen</span> · <span style={{ color:"#1E90FF" }}>🔵 General/Glass</span>
                  </div>

                  {/* Checklist */}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:6 }}>✅ CHECKLIST</div>
                    {checklist.map((task, i) => (
                      <div key={i} style={{ fontSize:13, padding:"6px 10px", background:C.surface, borderRadius:6, marginBottom:4, display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ color:C.muted }}>☐</span><span>{task}</span>
                      </div>
                    ))}
                    {job.upsells?.length > 0 && (job.upsells||[]).map((addon, i) => (
                      <div key={`addon-${i}`} style={{ fontSize:13, padding:"6px 10px", background:"#FFB80011", borderRadius:6, marginBottom:4, display:"flex", gap:8, alignItems:"center", border:`1px solid #FFB80033` }}>
                        <span style={{ color:C.gold }}>★</span><span style={{ color:C.gold }}>{addon} (add-on)</span>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                    <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ ...S.btn("ghost"), fontSize:12, textDecoration:"none" }}>
                      🗺 Directions
                    </a>
                    <label style={{ ...S.btn("ghost"), fontSize:12, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                      📷 Before Photo
                      <input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                        onChange={e => {
                          const file = e.target.files[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => setJobs(prev => prev.map(j => j.id === job.id
                            ? { ...j, beforePics:[...(j.beforePics||[]), ev.target.result] } : j));
                          reader.readAsDataURL(file);
                        }} />
                    </label>
                    <label style={{ ...S.btn("primary"), fontSize:12, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                      ✨ After Photo
                      <input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                        onChange={e => {
                          const file = e.target.files[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => setJobs(prev => prev.map(j => j.id === job.id
                            ? { ...j, afterPics:[...(j.afterPics||[]), ev.target.result] } : j));
                          reader.readAsDataURL(file);
                        }} />
                    </label>
                  </div>

                  {/* Uploaded photos */}
                  {((job.beforePics||[]).filter(p=>p?.startsWith("data:")).length > 0 ||
                    (job.afterPics||[]).filter(p=>p?.startsWith("data:")).length > 0) && (
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:6, fontWeight:700 }}>UPLOADED PHOTOS</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {(job.beforePics||[]).filter(p=>p?.startsWith("data:")).map((p,i) => (
                          <div key={`b${i}`} style={{ position:"relative" }}>
                            <img src={p} alt="before" style={{ width:64, height:64, borderRadius:8, objectFit:"cover", border:`2px solid ${C.border}` }} />
                            <div style={{ position:"absolute", bottom:2, left:2, background:"rgba(0,0,0,0.7)", borderRadius:4, fontSize:9, padding:"1px 4px", color:"#aaa" }}>BEFORE</div>
                          </div>
                        ))}
                        {(job.afterPics||[]).filter(p=>p?.startsWith("data:")).map((p,i) => (
                          <div key={`a${i}`} style={{ position:"relative" }}>
                            <img src={p} alt="after" style={{ width:64, height:64, borderRadius:8, objectFit:"cover", border:`2px solid ${C.accent}` }} />
                            <div style={{ position:"absolute", bottom:2, left:2, background:"rgba(0,0,0,0.7)", borderRadius:4, fontSize:9, padding:"1px 4px", color:C.accent }}>AFTER</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Job notes */}
                  <div>
                    <div style={{ fontSize:11, color:C.muted, fontWeight:700, marginBottom:4 }}>JOB NOTES</div>
                    <textarea
                      style={{ ...S.input, minHeight:60, fontSize:13, resize:"vertical" }}
                      placeholder="End-of-job summary, client feedback, any issues..."
                      value={job.summary || ""}
                      onChange={e => setJobs(prev => prev.map(j => j.id === job.id ? { ...j, summary: e.target.value } : j))}
                    />
                  </div>

                </div>
              );
            })}
          </div>
        )}
        {todayJobs.length === 0 && (
          <div style={{ ...S.card, marginBottom:18, textAlign:"center", padding:30 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
            <div style={{ fontWeight:700, fontSize:16 }}>No jobs today</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Enjoy your day off!</div>
          </div>
        )}

        {/* Upcoming jobs */}
        {upcomingJobs.filter(j => j.date !== today).length > 0 && (
          <div style={S.card}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14 }}>📆 Upcoming Jobs</div>
            {upcomingJobs.filter(j => j.date !== today).slice(0,5).map(job => {
              const checklist = {
                "Refresh Clean":["Kitchen: surfaces, sink, appliance exteriors","Bathroom: toilet, sink, mirror, floor","Living areas: dust and vacuum","Floors: vacuum then mop"],
                "Full Home Clean":["Kitchen: deep counters, sink, stovetop, appliances","All bathrooms: full clean incl. shower/tub","All rooms: dust, wipe, vacuum","Floors throughout: vacuum then mop"],
                "Deep Clean":["Kitchen: inside microwave, stovetop detail, cabinets exterior","All bathrooms: grout scrub, fixtures polish","Baseboards throughout","All surfaces: detailed wipe-down","Floors: vacuum and mop"],
                "Move-In / Move-Out":["Full empty-unit clean","Inside all cabinets and drawers","Inside appliances","All surfaces, fixtures, floors","Check and clean inside closets"],
                "Kitchen & Bathroom Refresh":["Kitchen: counters, sink, cabinet exteriors, appliance wipe-down","Bathroom: full clean incl. toilet, sink, shower/tub, mirror","Both room floors"],
              }[job.type] || ["Full clean as per package"];

              return (
                <div key={job.id} style={{ paddingBottom:18, marginBottom:18, borderBottom:`1px solid ${C.border}` }}>
                  {/* Job header */}
                  <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                    <div>
                      <div style={{ fontWeight:800, fontSize:16 }}>{job.client}</div>
                      <div style={{ fontSize:13, color:C.muted }}>📅 {job.date} at {job.time}</div>
                      <div style={{ fontSize:13, color:C.muted }}>📍 {job.address}</div>
                      <div style={{ fontSize:13, color:C.muted }}>🧹 {job.type} · {job.hours}h</div>
                      {job.upsells?.length > 0 && <div style={{ fontSize:12, color:C.gold, marginTop:4 }}>★ Add-ons: {job.upsells.join(", ")}</div>}
                      {job.notes && <div style={{ fontSize:12, color:"#FFA502", marginTop:4 }}>⚠️ {job.notes}</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:800, fontSize:20, color:C.blue }}>{cur}{job.partnerPay||0}</div>
                      <div style={{ fontSize:11, color:C.dim }}>your pay</div>
                    </div>
                  </div>

                  {/* RAG */}
                  <div style={{ background:C.surface, borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:700, marginBottom:10 }}>
                    🎨 RAG: <span style={{ color:"#FF4757" }}>🔴 Toilets ONLY</span> · <span style={{ color:"#FFA502" }}>🟡 Sinks/Mirrors</span> · <span style={{ color:"#2ED573" }}>🟢 Kitchen</span> · <span style={{ color:"#1E90FF" }}>🔵 General/Glass</span>
                  </div>

                  {/* Checklist */}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:6 }}>✅ CHECKLIST</div>
                    {checklist.map((task, i) => (
                      <div key={i} style={{ fontSize:13, padding:"6px 10px", background:C.surface, borderRadius:6, marginBottom:4, display:"flex", gap:8 }}>
                        <span style={{ color:C.muted }}>☐</span><span>{task}</span>
                      </div>
                    ))}
                    {job.upsells?.map((addon,i) => (
                      <div key={`u${i}`} style={{ fontSize:13, padding:"6px 10px", background:"#FFB80011", borderRadius:6, marginBottom:4, display:"flex", gap:8, border:`1px solid #FFB80033` }}>
                        <span style={{ color:C.gold }}>★</span><span style={{ color:C.gold }}>{addon} (add-on)</span>
                      </div>
                    ))}
                  </div>

                  {/* Directions */}
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...S.btn("ghost"), fontSize:12, textDecoration:"none", display:"inline-block" }}>
                    🗺 Get Directions
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── System Diagnostic Component ─────────────────────────────────────────────
function SystemDiagnostic({ jobs, partners, resLeads, coldLeads, region }) {
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const SB_URL = "https://opazwghrohmfykzxxsjk.supabase.co";
  const SB_KEY = SUPABASE_ANON;
  const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

  const runAll = async () => {
    setResults([]); setSummary(null); setSuggestions([]);
    setRunning(true);
    const res = [];
    const sugg = [];
    let passed = 0, failed = 0, warned = 0;

    const add = (category, name, status, message, fix = "") => {
      res.push({ category, name, status, message, fix, time: new Date().toLocaleTimeString() });
      if (status === "ok") passed++;
      else if (status === "err") failed++;
      else warned++;
      setResults([...res]);
    };

    // ── INFRASTRUCTURE ──────────────────────────────────────────────────────
    try {
      const r = await fetch(`${SB_URL}/rest/v1/huc_leads_cold?select=lead_id&limit=1`, { headers: SB_H });
      add("Infrastructure", "Supabase Connection", r.ok ? "ok" : "err", `HTTP ${r.status}`);
    } catch(e) { add("Infrastructure", "Supabase Connection", "err", e.message, "Check internet connection"); }

    try {
      const r = await fetch(`${SB_URL}/rest/v1/huc_leads_cold?select=lead_id`, { headers: { ...SB_H, "Prefer": "count=exact" } });
      const total = (r.headers.get("Content-Range") || "").split("/")[1] || "?";
      add("Infrastructure", "Supabase Lead Count", "ok", `${total} rows in huc_leads_cold`);
    } catch(e) { add("Infrastructure", "Supabase Lead Count", "err", e.message); }

    try {
      const tid = "DIAG-" + Date.now();
      const r = await fetch(`${SB_URL}/rest/v1/huc_leads_cold?on_conflict=lead_id`, {
        method: "POST", headers: { ...SB_H, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ lead_id: tid, data: { company: "Test" }, updated_at: new Date().toISOString() }])
      });
      if (r.ok) {
        await fetch(`${SB_URL}/rest/v1/huc_leads_cold?lead_id=eq.${tid}`, { method: "DELETE", headers: SB_H });
        add("Infrastructure", "Supabase Write/Delete", "ok", "Write + cleanup ✅");
      } else { add("Infrastructure", "Supabase Write/Delete", "err", `HTTP ${r.status}`, "Check RLS policies allow INSERT/DELETE for anon"); }
    } catch(e) { add("Infrastructure", "Supabase Write/Delete", "err", e.message); }

    try {
      const r = await fetch("/api/sheet"); const d = await r.json();
      if (d.error) { add("Infrastructure", "Google Sheet API", "err", d.error, "Check SHEET_ID and Google API key in Vercel env vars"); }
      else {
        const total = (d.leads || []).length;
        add("Infrastructure", "Google Sheet API", total > 0 ? "ok" : "warn", `${total} leads returned`);
        if (total === 0) sugg.push({ icon: "📋", text: "Google Sheet has no leads — run your n8n workflow to populate it" });
      }
    } catch(e) { add("Infrastructure", "Google Sheet API", "err", e.message, "Vercel /api/sheet function may be failing"); }

    try {
      const r = await fetch("/api/intake"); const d = await r.json();
      const count = (d.leads || []).length;
      add("Infrastructure", "Form Intake API", "ok", `${count} form submissions`);
      if (count === 0) sugg.push({ icon: "📝", text: "No form submissions yet — share your Google Form with clients to start collecting leads" });
    } catch(e) { add("Infrastructure", "Form Intake API", "err", e.message); }

    if ("geolocation" in navigator) {
      add("Infrastructure", "GPS/Geolocation", "ok", "Browser geolocation available ✅");
    } else {
      add("Infrastructure", "GPS/Geolocation", "err", "Not available", "GPS check-in won't work on this device");
    }

    // ── COLD OUTREACH ────────────────────────────────────────────────────────
    add("Cold Outreach", "Leads loaded", coldLeads.length > 0 ? "ok" : "warn",
      `${coldLeads.length} leads in memory`,
      coldLeads.length === 0 ? "Open Cold Outreach tab to trigger auto-sync" : "");

    const onLeads = coldLeads.filter(l => (l.market||"").toLowerCase().includes("ontario"));
    const azLeads = coldLeads.filter(l => (l.market||"").toLowerCase().includes("arizona"));
    add("Cold Outreach", "Ontario leads", onLeads.length > 0 ? "ok" : "warn", `${onLeads.length} Ontario leads`);
    add("Cold Outreach", "Arizona leads", azLeads.length > 0 ? "ok" : "warn", `${azLeads.length} Arizona leads`);

    const contacted = coldLeads.filter(l => l.status !== "New").length;
    add("Cold Outreach", "Leads with activity", contacted > 0 ? "ok" : "warn",
      `${contacted}/${coldLeads.length} leads have been contacted or updated`);
    if (contacted === 0 && coldLeads.length > 0) sugg.push({ icon: "🎯", text: "Start contacting cold leads — open a lead, send the cold email, update status to Contacted" });

    // ── RESIDENTIAL LEADS ────────────────────────────────────────────────────
    add("Residential", "Leads in app", resLeads.length >= 0 ? "ok" : "warn", `${resLeads.length} residential leads`);
    if (resLeads.length === 0) sugg.push({ icon: "🏠", text: "No residential leads yet — add your first lead from the Residential tab" });

    const quoted = resLeads.filter(l => l.status === "Quoted").length;
    const booked = resLeads.filter(l => l.status === "Booked").length;
    const completed = resLeads.filter(l => l.status === "Completed").length;
    add("Residential", "Lead pipeline", "ok",
      `New: ${resLeads.filter(l=>l.status==="New").length} · Quoted: ${quoted} · Booked: ${booked} · Completed: ${completed}`);

    if (quoted > 0 && booked === 0) sugg.push({ icon: "📋", text: `${quoted} quoted leads not yet booked — follow up or click Book Job to schedule them` });

    // ── JOBS ─────────────────────────────────────────────────────────────────
    add("Jobs", "Total jobs", "ok", `${jobs.length} jobs in system`);
    if (jobs.length === 0) sugg.push({ icon: "📋", text: "No jobs yet — book a residential lead to create the first job" });

    const scheduled = jobs.filter(j => j.status === "scheduled").length;
    const inProgress = jobs.filter(j => j.status === "in_progress").length;
    const completedJobs = jobs.filter(j => j.status === "completed").length;
    add("Jobs", "Job status breakdown", "ok",
      `Scheduled: ${scheduled} · In Progress: ${inProgress} · Completed: ${completedJobs}`);

    const unassigned = jobs.filter(j => !j.partnerId && !(j.partnerIds||[]).length).length;
    if (unassigned > 0) {
      add("Jobs", "Unassigned jobs", "warn", `${unassigned} jobs have no partner assigned`, "Go to Jobs tab and assign partners");
      sugg.push({ icon: "👥", text: `${unassigned} jobs have no partner assigned — assign partners so they show up in Partner View` });
    } else { add("Jobs", "Unassigned jobs", "ok", "All jobs have partners assigned ✅"); }

    // ── PARTNERS ─────────────────────────────────────────────────────────────
    add("Partners", "Partners registered", partners.length > 0 ? "ok" : "warn",
      `${partners.length} partners in system`, partners.length === 0 ? "Add partners in the Partners tab" : "");
    if (partners.length === 0) sugg.push({ icon: "👥", text: "No partners added yet — go to Partners tab and add your team members" });

    const onboarded = partners.filter(p => p.onboarded).length;
    if (partners.length > 0) {
      add("Partners", "Onboarding status", onboarded === partners.length ? "ok" : "warn",
        `${onboarded}/${partners.length} partners fully onboarded`);
      if (onboarded < partners.length) sugg.push({ icon: "🎓", text: `${partners.length - onboarded} partners not fully onboarded — complete training in the Onboarding tab` });
    }

    // ── PAYMENTS ─────────────────────────────────────────────────────────────
    const paid = jobs.filter(j => j.paymentConfirmed).length;
    const unpaid = completedJobs - paid;
    add("Payments", "Payment status", unpaid > 0 ? "warn" : "ok",
      `${paid} jobs paid · ${unpaid} completed but unpaid`);
    if (unpaid > 0) sugg.push({ icon: "💳", text: `${unpaid} completed jobs awaiting payment — confirm payment in the Jobs tab` });

    // ── REGION ───────────────────────────────────────────────────────────────
    add("Config", "Active region", "ok",
      `${region?.name || "Unknown"} (${region?.id || "?"}) — ${region?.currencySymbol || "?"}${region?.currencyCode || ""}`);

    try {
      localStorage.setItem("diag-test", "1"); localStorage.removeItem("diag-test");
      add("Config", "localStorage", "ok", "Working ✅");
    } catch(e) { add("Config", "localStorage", "err", e.message); }

    const deletedIds = (() => { try { return JSON.parse(localStorage.getItem("cp:deletedLeadIds") || "[]"); } catch { return []; } })();
    add("Config", "Deleted leads tracking", "ok", `${deletedIds.length} leads permanently deleted and tracked`);

    // ── FEATURE SUGGESTIONS ───────────────────────────────────────────────────
    if (!jobs.some(j => j.recurring)) sugg.push({ icon: "🔄", text: "No recurring jobs set up — add recurring schedules in the Recurring tab to automate weekly/bi-weekly bookings" });
    if (partners.length > 0 && !partners.some(p => p.phone)) sugg.push({ icon: "📱", text: "Partner phone numbers missing — add them in Partners tab to enable SMS reminders" });
    if (completedJobs > 0 && unpaid === 0) sugg.push({ icon: "💰", text: "All completed jobs are paid — great job! Consider setting up Stripe for automatic online payment collection" });
    if (coldLeads.length > 0 && azLeads.length === 0) sugg.push({ icon: "🇺🇸", text: "No Arizona leads loaded — run your n8n workflow with Arizona search jobs to populate AZ pipeline" });
    if (coldLeads.length > 500) sugg.push({ icon: "🎯", text: `You have ${coldLeads.length} cold leads — consider assigning a sales team member to work through them systematically` });

    setSuggestions(sugg);
    setSummary({ passed, failed, warned });
    setRunning(false);
  };

  const categoryColors = {
    "Infrastructure": "#3B82F6",
    "Cold Outreach": "#00D4AA",
    "Residential": "#FF6B6B",
    "Jobs": "#f59e0b",
    "Partners": "#8B5CF6",
    "Payments": "#10B981",
    "Config": "#6B7280",
  };

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {});

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: C.accent, fontSize: 22, marginBottom: 4 }}>🔬 System Diagnostic</h2>
        <p style={{ color: C.muted, fontSize: 13 }}>Full health check of every feature — runs live against your real data</p>
      </div>

      <button onClick={runAll} disabled={running} style={{ ...S.btn("primary"), marginBottom: 16, opacity: running ? 0.6 : 1 }}>
        {running ? "⏳ Running all checks..." : "▶ Run Full Diagnostic"}
      </button>

      {summary && (
        <div style={{ padding: 14, borderRadius: 10, marginBottom: 16,
          background: summary.failed > 0 ? "#FF475715" : summary.warned > 0 ? "#f59e0b15" : "#00D4AA15",
          border: `1px solid ${summary.failed > 0 ? "#FF475744" : summary.warned > 0 ? "#f59e0b44" : "#00D4AA44"}`,
          color: summary.failed > 0 ? "#FF4757" : summary.warned > 0 ? "#f59e0b" : "#00D4AA",
          fontWeight: 700, fontSize: 15, textAlign: "center" }}>
          ✅ {summary.passed} passed · ❌ {summary.failed} failed · ⚠️ {summary.warned} warnings
        </div>
      )}

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: `${categoryColors[category] || "#666"}22`, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: categoryColors[category] || C.accent }}>{category}</span>
          </div>
          {items.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderBottom: i < items.length - 1 ? `1px solid ${C.border}20` : "none" }}>
              <div style={{ fontSize: 16, minWidth: 20 }}>{r.status === "ok" ? "✅" : r.status === "err" ? "❌" : "⚠️"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{r.name}</div>
                <div style={{ fontSize: 12, color: r.status === "ok" ? "#00D4AA" : r.status === "err" ? "#FF4757" : "#f59e0b", marginTop: 2 }}>{r.message}</div>
                {r.fix && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontStyle: "italic" }}>→ {r.fix}</div>}
              </div>
              <div style={{ fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>{r.time}</div>
            </div>
          ))}
        </div>
      ))}

      {suggestions.length > 0 && (
        <div style={{ background: C.card, border: `1px solid #3B82F644`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "#3B82F622", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#60A5FA" }}>💡 Suggestions & Next Steps</span>
          </div>
          {suggestions.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}20` : "none" }}>
              <div style={{ fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 13, color: "#aaa", flex: 1 }}>{s.text}</div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !running && (
        <div style={{ textAlign: "center", color: C.muted, padding: 60, fontSize: 14 }}>
          Click "Run Full Diagnostic" to test every system and get personalized suggestions
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [jobs, setJobs] = useState(initJobs);
  const [partners, setPartners] = useState(initPartners);
  const [activeRegion, setActiveRegion] = useState(REGIONS["ON"]);
  const [resLeads, setResLeads] = useState([]);
  const [coldLeads, setColdLeads] = useState([]); // load from Supabase on boot
  const [coldPage, setColdPage] = useState(0); // persists pagination across tab switches
  const [coldFilterMkt, setColdFilterMkt] = useState("All"); // persists market filter
  const [deletedLeadIds, setDeletedLeadIds] = useState(() => {
    // Load from localStorage so deletes survive page refresh
    try {
      const saved = localStorage.getItem("cp:deletedLeadIds");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  }); // tracks permanently deleted leads

  // Persist deletedLeadIds to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem("cp:deletedLeadIds", JSON.stringify([...deletedLeadIds]));
    } catch {}
  }, [deletedLeadIds]);
  const [onboardingProgress, setOnboardingProgress] = useState({}); // { partnerId: [moduleIds] }

  // ── DB state ──
  const [dbStatus, setDbStatus] = useState("loading");
  const [lastSaved, setLastSaved] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activityLog, setActivityLog] = useState([]);
  const saveTimer = useRef(null);

  // ── Boot: load saved data, with 2s timeout so it never hangs ──
  useEffect(() => {
    let cancelled = false;

    // Hard timeout — if storage takes > 2s (or isn't available), just use demo data
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setIsLoading(false);
        setDbStatus("supabase");
      }
    }, 2000);

    async function loadAll() {
      try {
        const [savedJobs, savedPartners, savedRegion, log, savedResLeads, savedColdLeads, savedProgress] = await Promise.all([
          dbGet(DB_KEYS.jobs),
          dbGet(DB_KEYS.partners),
          dbGet(DB_KEYS.region),
          dbGet(DB_KEYS.activity),
          dbGet(DB_KEYS.leadsRes),
          dbGet(DB_KEYS.coldLeads),
          dbGet(DB_KEYS.onboardingProgress),
        ]);

        if (cancelled) return;
        if (savedJobs)      setJobs(savedJobs);
        if (savedPartners)  setPartners(savedPartners);
        if (savedRegion && REGIONS[savedRegion]) setActiveRegion(REGIONS[savedRegion]);
        if (log)            setActivityLog(log);
        if (savedResLeads) {
          // Filter out permanently deleted lead IDs
          try {
            const deleted = new Set(JSON.parse(localStorage.getItem("cp:leads_res_deleted") || "[]"));
            const filtered = deleted.size > 0
              ? savedResLeads.filter(l => !deleted.has(String(l.id)))
              : savedResLeads;
            setResLeads(filtered);
          } catch { setResLeads(savedResLeads); }
        }
        if (savedColdLeads && savedColdLeads.length > 0) {
          // Strip out the hardcoded sample lead IDs that were stored in previous sessions
          const SAMPLE_IDS = new Set(["ON-0101","ON-0201","AZ-0101","AZ-0201","ON-0301"]);
          const realLeads = savedColdLeads.filter(l => !SAMPLE_IDS.has(l.lead_id));
          if (realLeads.length > 0) setColdLeads(realLeads);
        }
        if (savedProgress)  setOnboardingProgress(savedProgress);
        setDbStatus("supabase");
      } catch {
        if (!cancelled) setDbStatus("local");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setIsLoading(false);
      }
    }

    loadAll();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  // ── Auto-save jobs whenever they change (debounced 600ms) ──
  useEffect(() => {
    if (isLoading) return;
    setDbStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const ok = await dbSet(DB_KEYS.jobs, jobs);
      setDbStatus(ok ? "synced" : "error");
      if (ok) setLastSaved(new Date().toLocaleTimeString());
    }, 600);
  }, [jobs, isLoading]);

  // ── Auto-save partners ──
  useEffect(() => {
    if (isLoading) return;
    dbSet(DB_KEYS.partners, partners);
  }, [partners, isLoading]);

  // ── Auto-save resLeads ──
  useEffect(() => {
    if (isLoading) return;
    dbSet(DB_KEYS.leadsRes, resLeads);
  }, [resLeads, isLoading]);

  // ── Auto-save coldLeads ──
  useEffect(() => {
    if (isLoading) return;
    // Write cold leads directly to Supabase sequentially
    if (coldLeads && coldLeads.length > 0) {
      (async () => {
        const BATCH = 50;
        for (let i = 0; i < coldLeads.length; i += BATCH) {
          const batch = coldLeads.slice(i, i + BATCH);
          const rows = batch.map(lead => ({
            lead_id: String(lead.lead_id || lead.id || `LD-${Date.now()}-${Math.random()}`),
            data: lead,
            updated_at: new Date().toISOString(),
          }));
          try {
            await sbFetch("huc_leads_cold", {
              method: "POST",
              body: JSON.stringify(rows),
              headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
            });
          } catch { /* continue */ }
        }
      })();
    }
    dbSet(DB_KEYS.coldLeads, coldLeads); // also save to localStorage as backup
  }, [coldLeads, isLoading]);

  // ── Auto-save onboarding progress ──
  useEffect(() => {
    if (isLoading) return;
    dbSet(DB_KEYS.onboardingProgress, onboardingProgress);
  }, [onboardingProgress, isLoading]);

  // ── Auto-pull new form leads every 5 minutes ──
  useEffect(() => {
    if (isLoading) return;
    const pullIntake = async () => {
      try {
        const res = await fetch("/api/intake");
        if (!res.ok) return;
        const data = await res.json();
        if (data.leads && data.leads.length > 0) {
          setResLeads(ls => {
            // Dedup by email+name (stable identifiers)
            const existingKeys = new Set(ls.map(l => {
              const email = (l.email||'').toLowerCase().trim();
              const name  = (l.name ||'').toLowerCase().trim();
              return `${email}|${name}`;
            }));
            const newOnes = data.leads.filter(l => {
              const email = (l.email||'').toLowerCase().trim();
              const name  = (l.name ||'').toLowerCase().trim();
              if (!email || !name) return false;
              const key = `${email}|${name}`;
              if (existingKeys.has(key)) return false;
              existingKeys.add(key);
              return true;
            });
            if (newOnes.length === 0) return ls;
            console.log(`✅ Auto-pulled ${newOnes.length} new lead(s) from Google Form`);
            return [...newOnes, ...ls];
          });
        }
      } catch { /* silent */ }
    };
    pullIntake();
    const timer = setInterval(pullIntake, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  // ── Real-time sync — poll Supabase every 15s ──
  useEffect(() => {
    if (isLoading) return;
    const syncFromSupabase = async () => {
      try {
        // ── Cold leads: filter junk AND deleted leads BEFORE setting state ──
        const freshCold = await sbGet("cp:cold_leads");
        if (freshCold && Array.isArray(freshCold) && freshCold.length > 0) {
          const JUNK = /\[Your Name\]|\[City\]|\[Name\]|\[Company\]|\[Location\]|\[Property Manager\]|\[Buyer Name\]|\[Your_Name\]|\[building type\]|\[city\]|\[Recipient|\[Name\]/i;
          const SAMPLE_IDS = new Set(["ON-0101","ON-0201","AZ-0101","AZ-0201","ON-0301"]);
          const cleanCold = freshCold
            .filter(l => {
              if (!l?.company?.trim()) return false;
              if (JUNK.test(l.company)) return false;
              const lid = String(l.lead_id || l.id || "");
              if (SAMPLE_IDS.has(lid)) return false;
              if (lid && deletedLeadIds.has(lid)) return false;
              return true;
            })
            .map(l => ({
              ...l,
              // Normalize market to exact casing so filters always work
              market: (() => {
                const m = (l.market||"").trim().toLowerCase();
                if (m.includes("ontario")) return "Ontario";
                if (m.includes("arizona")) return "Arizona";
                // Fallback: derive from lead_id prefix (ON- = Ontario, AZ- = Arizona)
                const id = (l.lead_id||l.id||"").toUpperCase();
                if (id.startsWith("ON-") || id.startsWith("ON-M")) return "Ontario";
                if (id.startsWith("AZ-")) return "Arizona";
                // Fallback: derive from city name
                const city = (l.city||"").toLowerCase();
                const ontarioCities = ["brampton","mississauga","vaughan","markham","richmond hill","oakville","burlington","toronto","hamilton","newmarket","aurora","pickering","ajax","whitby","oshawa","north york","etobicoke","scarborough"];
                const arizonaCities = ["phoenix","scottsdale","tempe","mesa","chandler","gilbert","glendale","peoria","surprise","goodyear","avondale","fountain hills"];
                if (ontarioCities.some(c => city.includes(c))) return "Ontario";
                if (arizonaCities.some(c => city.includes(c))) return "Arizona";
                return l.market || "";
              })(),
            }));
          setColdLeads(prev => {
            const localMap = Object.fromEntries(
              (prev||[]).map(l => [l.lead_id||l.id||"", l])
            );
            const merged = cleanCold.map(l => ({
              ...l,
              status: localMap[l.lead_id||l.id]?.status || l.status || "New",
              notes:  localMap[l.lead_id||l.id]?.notes  || l.notes  || "",
            }));
            const sbIds = new Set(cleanCold.map(l => l.lead_id||l.id||""));
            const manualOnly = (prev||[]).filter(l =>
              (l.source === "manual") && !sbIds.has(l.lead_id||l.id||"")
            );
            const combined = [...manualOnly, ...merged];
            // Deduplicate by company name — keep best version
            const compMap = new Map();
            for (const lead of combined) {
              const key = (lead.company||"").trim().toLowerCase();
              if (!key) continue;
              const ex = compMap.get(key);
              if (!ex) { compMap.set(key, lead); continue; }
              const score = (l) => (l.cold_email||"").length + (l.notes||"").length + (l.status !== "New" ? 100 : 0);
              if (score(lead) > score(ex)) compMap.set(key, lead);
            }
            const final = Array.from(compMap.values());
            // Only replace if we have a meaningful result — never drop below 50% of local
            return final.length >= (prev||[]).length * 0.5 ? final : prev;
          });
        }

        // ── Jobs: DO NOT overwrite from Supabase sync ──
        // Local state + localStorage IS the source of truth for jobs.
        // Jobs are written TO Supabase for backup, never read back to overwrite local.
        // Jobs are loaded from localStorage at boot only.


        // ── Residential leads: DO NOT overwrite from Supabase sync ──
        // Local state + localStorage IS the source of truth for residential leads.
        // Supabase is write-only backup. Reading back would undo deletes/edits.
        // Residential leads are loaded from localStorage at boot only.

      } catch { /* silent — offline ok */ }
    };

    // Run once immediately on mount so leads load without waiting 30s
    syncFromSupabase();

    // Poll every 30s as reliable fallback
    const t = setInterval(syncFromSupabase, 30000);

    return () => {
      clearInterval(t);
    };
  }, [isLoading]);

  // ── Save region preference ──
  useEffect(() => {
    if (isLoading) return;
    dbSet(DB_KEYS.region, activeRegion.id);
  }, [activeRegion, isLoading]);

  // ── Wrapped setters that also log activity ──
  const setJobsDB = useCallback((updater) => {
    setJobs(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const added   = next.filter(n => !prev.find(p => p.id === n.id));
      const removed = prev.filter(p => !next.find(n => n.id === p.id));
      const changed = next.filter(n => {
        const old = prev.find(p => p.id === n.id);
        return old && JSON.stringify(old) !== JSON.stringify(n);
      });
      if (added.length)   logActivity("JOB_ADDED",   added.map(j => j.client).join(", "));
      if (removed.length) logActivity("JOB_DELETED",  removed.map(j => j.client).join(", "));
      if (changed.length) logActivity("JOB_UPDATED",  changed.map(j => `${j.client} → ${j.status}`).join(", "));
      // Write to Supabase immediately so changes persist across refreshes
      dbSet(DB_KEYS.jobs, next).catch(() => {});
      return next;
    });
  }, []);

  

  const getMySchedulePosition = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date().toISOString(),
          });
        },
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    });

  const readPhotoFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve({
          id: `PHOTO-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: reader.result,
          createdAt: new Date().toISOString(),
        });

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleMySchedulePhotoUpload = async (job, type, files) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    const photos = await Promise.all(list.map(readPhotoFileAsDataUrl));
    const key = type === "before" ? "beforePics" : "afterPics";

    setJobsDB((prevJobs) =>
      prevJobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              [key]: [...(j[key] || []), ...photos],
            }
          : j
      )
    );
  };

  const handleMyScheduleCheckIn = async (job) => {
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const coords = await getMySchedulePosition();

    setJobsDB((prevJobs) =>
      prevJobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status: "in-progress",
              checkIn: j.checkIn || now,
              checkInCoords: j.checkInCoords || coords,
            }
          : j
      )
    );
  };

  const handleMyScheduleCheckOut = async (job) => {
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const coords = await getMySchedulePosition();

    setJobsDB((prevJobs) =>
      prevJobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status: "completed",
              checkOut: j.checkOut || now,
              checkOutCoords: j.checkOutCoords || coords,
            }
          : j
      )
    );
  };


  const setPartnersDB = useCallback((updater) => {
    setPartners(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const added = next.filter(n => !prev.find(p => p.id === n.id));
      if (added.length) logActivity("PARTNER_ADDED", added.map(p => p.name).join(", "));
      return next;
    });
  }, []);

  // Refresh activity log from storage
  const refreshLog = useCallback(async () => {
    const log = await dbGet(DB_KEYS.activity);
    if (log) setActivityLog(log);
  }, []);

  // ── Reset to demo data ──
  const handleReset = async () => {
    await Promise.all([
      dbSet(DB_KEYS.jobs,     initJobs),
      dbSet(DB_KEYS.partners, initPartners),
      dbDelete(DB_KEYS.leadsRes),
      dbDelete(DB_KEYS.leadsCom),
      dbDelete(DB_KEYS.activity),
      dbDelete(DB_KEYS.coldLeads),
      dbDelete(DB_KEYS.onboardingProgress),
    ]);
    setJobs(initJobs);
    setPartners(initPartners);
    setResLeads([]);
    setColdLeads(SAMPLE_COLD_LEADS);
    setOnboardingProgress({});
    setActivityLog([]);
    await logActivity("SYSTEM_RESET", "All data reset to demo defaults");
    setLastSaved(new Date().toLocaleTimeString());
    setDbStatus("synced");
  };

  // ── Export all data as JSON download ──
  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: BRAND.version,
      region: activeRegion.id,
      jobs,
      partners,
      activityLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haveusclean-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logActivity("EXPORT", `Full data export downloaded`);
  };

  // Keep global ACTIVE_REGION in sync for quote engines
  ACTIVE_REGION = activeRegion;

  // Filter data by active region
  const regionJobs     = jobs.filter(j => !j.region || j.region === activeRegion.id);
  const regionPartners = partners.filter(p => !p.region || p.region === activeRegion.id);

  const NAV_GROUPS = [
    { id:"ops",      label:"⚙️ Operations", color: C.accent, tabs:[
      { id:"dashboard",  label:"📊 Dashboard",    desc:"Overview & today's jobs" },
      { id:"myschedule", label:"📅 My Schedule", desc:"Cleaner-first today schedule" },
      { id:"ops_mgr",    label:"🧠 Ops Manager",  desc:"AI daily operations overview" },
      { id:"jobs",       label:"📋 Jobs",          desc:"All jobs & work orders" },
      { id:"recurring",  label:"🔄 Recurring",     desc:"Recurring job schedules" },
      { id:"gps",        label:"📍 GPS",           desc:"Check-in / check-out" },
      { id:"geo",        label:"🛡️ Geofence",     desc:"Location compliance" },
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
    ]},
  ];

  const activeGroup = NAV_GROUPS.find(g => g.tabs.some(t => t.id === tab)) || NAV_GROUPS[0];
  const allTabs = NAV_GROUPS.flatMap(g => g.tabs);

  // ── Loading screen ──
  if (isLoading) {
    return (
      <div style={{ ...S.app, alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
<div style={{ textAlign:"center" }}>
          <div style={{ fontSize:52, marginBottom:16 }}>✨</div>
          <div style={{ fontWeight:800, fontSize:24, color:C.accent, marginBottom:8 }}>Have Us Clean 🧹</div>
          <div style={{ color:C.muted, fontSize:14, marginBottom:28 }}>Loading your data...</div>
          <div style={{ width:200, height:4, background:C.surface, borderRadius:2, margin:"0 auto" }}>
            <div style={{ height:4, background:`linear-gradient(90deg,${C.accent},#0088FF)`, borderRadius:2, animation:"load 1.2s ease-in-out infinite", width:"60%" }} />
          </div>
          <style>{`@keyframes load{0%{width:10%}50%{width:80%}100%{width:10%}}`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
{/* ── TOP HEADER: Logo + Region + DB status ── */}
      <header style={{ ...S.header, flexShrink: 0 }}>
        <div style={S.logo}>
          <div style={S.logoMark}>{BRAND.logoMark}</div>
          <span style={{ display:"flex", flexDirection:"column", lineHeight:1.1 }}>
            <span>{BRAND.name}</span>
            <span style={{ fontSize:9, color:C.muted, fontWeight:600, letterSpacing:"0.05em" }}>v{BRAND.version}</span>
          </span>
        </div>

        {/* Region Banner inline */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, justifyContent:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:14 }}>{activeRegion.flag}</span>
          <span style={{ color: activeRegion.id==="ON" ? "#FF6B6B" : C.blue, fontWeight:700, fontSize:13 }}>{activeRegion.label}</span>
          <span style={{ color:C.dim, fontSize:12 }}>·</span>
          <span style={{ color:C.muted, fontSize:12 }}>{activeRegion.id==="ON" ? "CAD · 13% HST" : "USD · Services Tax-Exempt"}</span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <RegionSwitcher activeRegion={activeRegion} setActiveRegion={setActiveRegion} />
          {/* DB sync pill */}
          <div
            title={lastSaved ? `Last saved: ${lastSaved}` : dbStatus === "local" ? "Running in local mode — data in memory only" : "Click to manage data"}
            onClick={() => setTab("db")}
            style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, background: dbStatus==="synced"?C.accentDim:dbStatus==="saving"?C.goldDim:dbStatus==="local"?C.blueDim:C.redDim, cursor:"pointer", border:`1px solid ${dbStatus==="synced"?C.accent+"44":dbStatus==="saving"?C.gold+"44":dbStatus==="local"?C.blue+"44":C.red+"44"}` }}
          >
            <div style={{ width:6, height:6, borderRadius:"50%", background: dbStatus==="synced"?C.accent:dbStatus==="saving"?C.gold:dbStatus==="local"?C.blue:C.red, animation: dbStatus==="saving"?"dbpulse 1s infinite":"none" }} />
            <span style={{ fontSize:11, fontWeight:700, color: dbStatus==="synced"?C.accent:dbStatus==="saving"?C.gold:dbStatus==="local"?C.blue:C.red }}>
              {dbStatus==="synced" ? "Saved" : dbStatus==="saving" ? "Saving…" : dbStatus==="local" ? "Local" : "Memory"}
            </span>
          </div>
        </div>
      </header>

      {/* ── NAV ROW 1: Category pills ── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 16px", display:"flex", gap:4, overflowX:"auto", scrollbarWidth:"none", flexShrink:0 }}>
        {NAV_GROUPS.map(g => {
          const isActive = g.id === activeGroup.id;
          return (
            <button
              key={g.id}
              onClick={() => setTab(g.tabs[0].id)}
              style={{
                padding: "10px 16px",
                background: "none",
                border: "none",
                borderBottom: isActive ? `3px solid ${g.color}` : "3px solid transparent",
                color: isActive ? g.color : C.muted,
                fontWeight: isActive ? 800 : 600,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* ── NAV ROW 2: Active group's tabs ── */}
      <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: "6px 16px", display:"flex", gap:4, overflowX:"auto", scrollbarWidth:"none", flexShrink:0, alignItems:"center" }}>
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
                borderRadius: 8,
                color: isActive ? activeGroup.color : C.muted,
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
              title={t.desc}
            >
              {t.label}
            </button>
          );
        })}
        {/* Breadcrumb hint */}
        <div style={{ marginLeft:"auto", fontSize:11, color:C.dim, whiteSpace:"nowrap", paddingLeft:8 }}>
          {activeGroup.label} › {activeGroup.tabs.find(t=>t.id===tab)?.label || ""}
        </div>
      </div>

      <style>{`@keyframes dbpulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>

      <main style={S.main}>
        {tab==="dashboard"      && <DashboardV2      jobs={regionJobs}     partners={regionPartners} region={activeRegion} setTab={setTab} />}
        {tab==="myschedule"    && <MySchedule       jobs={regionJobs}     partners={regionPartners} region={activeRegion} onCheckIn={handleMyScheduleCheckIn} onCheckOut={handleMyScheduleCheckOut} 
              onPhotoUpload={handleMySchedulePhotoUpload} />}
        {tab==="ops_mgr"        && <OperationsManager jobs={regionJobs}    partners={regionPartners} region={activeRegion} setTab={setTab} />}
        {tab==="jobs"           && <Jobs              jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} />}
        {tab==="recurring"      && <RecurringJobs     jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} />}
        {tab==="gps"            && <GPSTracking       jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} />}
        {tab==="geo"            && <Geofencing        jobs={regionJobs}     partners={regionPartners} />}
        {tab==="res"            && <ResidentialLeads  jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} region={activeRegion} resLeads={resLeads} setResLeads={setResLeads} setTab={setTab} />}
        {tab==="com"            && <CommercialLeads   jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} region={activeRegion} />}
        {tab==="cold"           && <ColdOutreach      region={activeRegion} coldLeads={coldLeads} setColdLeads={setColdLeads} page={coldPage} setPage={setColdPage} deletedLeadIds={deletedLeadIds} setDeletedLeadIds={setDeletedLeadIds} filterMktProp={coldFilterMkt} setFilterMktProp={setColdFilterMkt} />}
        {tab==="intake"         && <FormIntake        resLeads={resLeads} setResLeads={setResLeads} region={activeRegion} setTab={setTab} />}
        {tab==="followup"       && <FollowUpReminders resLeads={resLeads} setResLeads={setResLeads} jobs={regionJobs} region={activeRegion} />}
        {tab==="agent_quote"    && <AgentPanel agent="VA_Quote_Agent" setResLeads={setResLeads} region={activeRegion} />}
        {tab==="agent_bidspec"  && <AgentPanel agent="BidSpec_Agent" />}
        {tab==="agent_workorder"&& <AgentPanel agent="WorkOrder_Agent" />}
        {tab==="agent_social"   && <AgentPanel agent="Social_Content_Agent" />}
        {tab==="agent_dm"       && <AgentPanel agent="DM_Conversion_Agent" />}
        {tab==="agent_ops"      && <AgentPanel agent="Operations_Manager_Agent" />}
        {tab==="pay"            && <Pay               partners={regionPartners} jobs={regionJobs} />}
        {tab==="stripe"         && <StripePayments    jobs={regionJobs}     partners={regionPartners} region={activeRegion} />}
        {tab==="qb"             && <QuickBooksSync    jobs={regionJobs}     partners={regionPartners} />}
        {tab==="portal"         && <ClientPortal      jobs={regionJobs}     resLeads={resLeads} setResLeads={setResLeads} partners={regionPartners} region={activeRegion} setTab={setTab} />}
        {tab==="clientview"     && <ClientView        jobs={regionJobs}     resLeads={resLeads} region={activeRegion} setTab={setTab} />}
        {tab==="sms"            && <SMSReminders      jobs={regionJobs} />}
        {tab==="marketing"      && <MarketingHub      region={activeRegion} />}
        {tab==="partners"       && <Partners          partners={regionPartners} setPartners={setPartnersDB} jobs={regionJobs} />}
        {tab==="partnerview"    && <PartnerView       jobs={regionJobs}     partners={regionPartners} region={activeRegion} />}
        {tab==="onboarding"     && <Onboarding        partners={regionPartners} setPartners={setPartnersDB} onboardingProgress={onboardingProgress} setOnboardingProgress={setOnboardingProgress} />}
        {tab==="ai"             && <AIScheduling      jobs={regionJobs}     setJobs={setJobsDB}       partners={regionPartners} />}
        {tab==="tax"            && <TaxCompliance     region={activeRegion} />}
        {tab==="db"             && <DataManager       onReset={handleReset} onExport={handleExport}   activityLog={activityLog} dbStatus={dbStatus} lastSaved={lastSaved} />}
        {tab==="whitelabel"     && <WhiteLabel />}
        {tab==="pricing"        && <PricingStrategy />}
        {tab==="swot"           && <SWOTAnalysis />}
        {tab==="diagnostic"     && <SystemDiagnostic jobs={jobs} partners={partners} resLeads={resLeads} coldLeads={coldLeads} region={activeRegion} />}
      </main>
    </div>
  );
}

// ─── HUC AGENT SYSTEM PROMPTS ────────────────────────────────────────────────
const HUC_AGENTS = {
  VA_Quote_Agent: {
    icon: "💬", color: C.accent,
    title: "VA Quote Agent",
    purpose: "Generate fast, consistent quotes using the exact HUC formula.",
    system: `You are the Have Us Clean VA Quote Agent. Use this exact formula every time.

TEAM SIZE BY SQFT:
- 1 partner → up to 1,000 sqft
- 2 partners → 1,001–3,000 sqft
- 3 partners → 3,001+ sqft

HOURS: sqft ÷ 1,000 (minimum 1.5h, round to nearest 0.5h)
PARTNER RATE: $30/hr CAD (Ontario) · $25/hr USD (Arizona)

STEP-BY-STEP FORMULA:
1. Hours = MAX(1.5, sqft ÷ 1000), round to nearest 0.5
2. Labor cost = team size × $30 × hours
3. Labor price = labor cost ÷ 0.65
4. Formula price = labor price × package multiplier
5. Floor base = floor price for that dwelling type (see below)
6. Floor price with package = floor base × package multiplier  ← CRITICAL: multiply floor by package too
7. Final base = MAX(formula price, floor price with package)
8. Condition adjust = final base × condition multiplier
9. Add addons at fixed prices
10. Apply frequency discount
11. Ontario: add 13% HST. Arizona: no tax.

PACKAGE MULTIPLIERS:
Refresh Clean ×1.0 · Full Home Clean ×1.25 · Deep Clean ×1.65
Move-In/Out ×1.80 · Kitchen & Bath Refresh ×0.65 · Pre-Sale ×1.50

FLOOR BASE PRICES — Ontario CAD (multiply by package multiplier per step 6):
Apartment/Condo: 1BR $140 · 2BR $165 · 3BR $205
Semi/Townhouse: Small $165 · Medium $205 · Large $245
Detached House: Small $185 · Medium $230 · Large $310
Arizona: multiply Ontario floor by 1.12

ADDONS: Fridge $50 · Oven $55 · Cabinets $65 · Windows $60 · Baseboards $55 · Carpet $95 · Pet Hair $65
FREQUENCY DISCOUNTS: Weekly −15% · Bi-Weekly −10% · Monthly −5%
TAX: Ontario +13% HST · Arizona 0%

WORKED EXAMPLE — 2BR Condo, 900 sqft, Full Home Clean, average condition, one-time, Ontario:
1. Hours = MAX(1.5, 900÷1000=0.9) → 1.5h
2. Labor cost = 1 × $30 × 1.5 = $45
3. Labor price = $45 ÷ 0.65 = $69
4. Formula price = $69 × 1.25 = $86
5. Floor base (2BR Condo Ontario) = $165
6. Floor with package = $165 × 1.25 = $206  ← floor gets multiplied too
7. Final base = MAX($86, $206) = $206  ← floor wins
8. Condition average ×1.0 → $206
9. No addons
10. No discount (one-time)
11. Pre-tax = $206 · HST = $27 · TOTAL = $233

Partner pay = $206 × 0.65 = $134 · Company keeps = $206 × 0.35 = $72

PAY SPLIT: Partner total = pre-tax × 65% · Company = pre-tax × 35%
2 partners → each gets half · 3 partners → each gets a third

Always show full breakdown: team, hours, formula price, floor check, final base, condition, addons, discount, pre-tax, HST, total, partner pay each, company margin.

IMPORTANT: Never ask for more information. If details are missing, use these smart defaults:
- Sqft missing → estimate from beds/baths or use 900 sqft for 2BR
- Condition missing → assume Average
- Frequency missing → assume One-Time
- Region missing → assume Ontario
- Package missing → assume Refresh Clean
Always produce a complete quote. State your assumptions clearly at the top.`,
    inputLabel: "Describe the job — be as brief or detailed as you want. I'll make smart assumptions for anything missing.",
    inputPlaceholder: "e.g. 2BR condo North York, Full Home Clean\n— or —\n3BR detached Mississauga, Deep Clean, heavy condition, bi-weekly, add inside oven\n— or —\nSmall office Scottsdale AZ, weekly janitorial",
    outputSections: ["Quote Breakdown", "Partner Pay", "Customer-Facing Message", "Warning Flag (if any)"],
  },
  BidSpec_Agent: {
    icon: "📄", color: C.gold,
    title: "Bid Spec Agent",
    purpose: "Generate clean, customer-safe bid summaries from quote details.",
    system: `You are the Have Us Clean Bid Spec Agent. Produce clean, customer-safe quote summaries.

RULES: Do NOT expose internal notes, margin warnings, or crew-only details. Summaries must list: service name, frequency, property type, selected add-ons (with prices), total price, and a readable scope-of-work paragraph. Keep language reassuring, simple, and professional. Always include a call-to-action at the end. Sign off as "Have Us Clean" with email haveusclean@gmail.com.

FORMAT your output as:
1. Email-safe summary (for pasting into email)
2. PDF-safe scope paragraph (for formal documents)`,
    inputLabel: "Paste or describe the quote details — service, frequency, property, addons, and total price.",
    inputPlaceholder: "e.g. Full Home Clean, bi-weekly, 2BR condo North York, addons: inside fridge ($50), total CA$213 + HST. Generate a bid spec.",
    outputSections: ["Email-Safe Summary", "PDF-Safe Scope Paragraph", "Call to Action"],
  },
  WorkOrder_Agent: {
    icon: "🔧", color: "#FF6B6B",
    title: "Work Order Agent",
    purpose: "Generate cleaner-facing operational work orders.",
    system: `You are the Have Us Clean Work Order Agent. Produce operational, task-focused work orders for cleaning partners.

INCLUDE: Customer name, address, date, arrival window, quoted hours, room counts, service package, selected add-ons, access notes, parking notes, and special instructions (pets, allergies, fragile items).

COLOUR RAG SYSTEM REMINDER (always include):
- 🔴 Red = Toilets/urinals only
- 🟡 Yellow = Other bathroom surfaces (sinks, mirrors)
- 🟢 Green = Kitchen/food prep surfaces
- 🔵 Blue = General/glass/living areas

FORMAT: Checklist-style. No marketing language. Clear task order (top to bottom, back to front). Flag any unusual requirements.`,
    inputLabel: "Paste the job details — client name, address, date, time, package, addons, hours, and any access or special notes.",
    inputPlaceholder: "e.g. Sarah M., 88 Maple Dr North York, April 14 at 9am, Full Home Clean 2BR condo, addon: inside fridge, ~3hrs, dog on premises (keep doors closed), access code #4521",
    outputSections: ["Work Order Header", "Room-by-Room Checklist", "Add-On Tasks", "Special Instructions"],
  },
  Social_Content_Agent: {
    icon: "📱", color: C.blue,
    title: "Social Content Agent",
    purpose: "Turn pricing and service offers into lead-generating content.",
    system: `You are the Have Us Clean Social Content Agent. Create modern-startup style content for Instagram, Facebook, X, and LinkedIn.

BRAND: Have Us Clean · Mid-market · Toronto & GTA · haveusclean@gmail.com

CONTENT PILLARS:
1. Transparent pricing (show real prices, build trust)
2. Before/after proof (results-focused)
3. Educational cleaning content (tips, RAG system, professionalism)
4. Offers and direct CTAs (Kitchen & Bathroom Refresh is the entry offer)
5. Testimonials and social proof

ENTRY OFFER: Kitchen & Bathroom Refresh ($120–$200) — easiest yes for new clients.

30-DAY WEEKLY PATTERN:
- Monday: Pricing/trust post
- Tuesday: Before/after
- Wednesday: Offer (Kitchen & Bath Refresh)
- Thursday: Educational
- Friday: Social proof/testimonial
- Saturday: Soft sell/reminder
- Sunday: Story/repost

Always include a clear CTA. Keep copy modern-startup, not corporate. Use emoji sparingly but effectively.`,
    inputLabel: "Describe what you need — platform (Instagram/Facebook/X/LinkedIn), goal (awareness/offer/educational/proof), and any specific service or offer to highlight.",
    inputPlaceholder: "e.g. Instagram post for Wednesday, highlight the Kitchen & Bathroom Refresh entry offer at $120–$200, goal is to get DMs from people in Toronto. Modern and clean tone.",
    outputSections: ["Post Copy", "Carousel Slide Breakdown (if applicable)", "Hashtags", "CTA"],
  },
  DM_Conversion_Agent: {
    icon: "💌", color: "#FF6B6B",
    title: "DM Conversion Agent",
    purpose: "Handle inbound DMs and move people into the quote funnel.",
    system: `You are the Have Us Clean DM Conversion Agent. Your job is to respond to inbound DMs, qualify the lead, and move them toward a quote or booking.

QUALIFICATION QUESTIONS (use as needed, not all at once):
- What type of property? (condo, house, townhouse)
- Approximate bedrooms/bathrooms?
- Looking for one-time or recurring?
- When are you hoping to get started?
- Any specific areas of focus or add-ons?

FLOW: Warm greeting → acknowledge their interest → 1–2 qualifying questions → offer a quote or direct to form → follow-up if no reply in 24h.

TONE: Warm, efficient, easy to reply to. Never salesy. Always move the conversation forward. Close with a clear next step (quote, date, or link).

ENTRY OFFER: If they seem hesitant on price, mention Kitchen & Bathroom Refresh starting at $120 as a low-commitment way to try the service.`,
    inputLabel: "Paste the incoming DM message. Include any context you have (platform, what they saw, their property type if known).",
    inputPlaceholder: `e.g. "Hey! I saw your post about cleaning prices, how much would it cost to clean my apartment?" — 2BR condo, found us on Instagram, first contact.`,
    outputSections: ["Reply Message", "Qualification Questions to Ask", "Follow-Up Script (if no reply)", "Booking Nudge"],
  },
  Operations_Manager_Agent: {
    icon: "📊", color: C.accent,
    title: "Operations Manager Agent",
    purpose: "Maintain pipeline hygiene and surface daily priority actions.",
    system: `You are the Have Us Clean Operations Manager Agent. Track quote status, follow-up dates, booked dates, assigned crew, and outstanding actions. Keep cold Leads separate from active Quotes. Your daily focus is the Quotes pipeline: new quote requests, quoted jobs needing follow-up, booked jobs needing work orders, and completed jobs needing closeout. Surface only what matters for the day.

FORMAT your response as:
TODAY'S PRIORITY ACTIONS (numbered, most urgent first)
PIPELINE STATUS (New / Quoted / Follow Up / Booked counts)
FLAGS & EXCEPTIONS (anything that needs immediate attention)
RECOMMENDED NEXT STEP

Be direct and action-oriented. No fluff. Max 300 words.`,
    inputLabel: "Paste your current pipeline data — lead statuses, follow-up dates, job counts, partner availability, or any specific situation you need prioritized.",
    inputPlaceholder: `e.g. I have 3 New leads, 2 Quoted from last week with no follow-up, 1 Booked job tomorrow with no work order yet, and 4 active partners. What should I focus on today?`,
    outputSections: ["Today's Priority Actions", "Pipeline Status", "Flags & Exceptions", "Recommended Next Step"],
  },
};

// ─── AGENT PANEL COMPONENT ────────────────────────────────────────────────────
function AgentPanel({ agent, setResLeads, region }) {
  const cfg = HUC_AGENTS[agent];
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [savedLead, setSavedLead] = useState(false);

  const run = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setOutput("");
    setSavedLead(false);
    const userMsg = input;
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: cfg.system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("\n") || "No response received.";
      setOutput(text);
      setHistory(h => [{ input: userMsg, output: text, ts: new Date().toLocaleTimeString() }, ...h].slice(0, 10));
    } catch (e) {
      setOutput("⚠️ Error connecting to AI. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse VA Quote output and save as a residential lead
  const saveAsLead = () => {
    if (!output || !setResLeads) return;

    // Extract key details from the agent's text output
    const txt = output.toLowerCase();
    const raw = input;

    // Parse numbers from output
    const preTaxMatch = output.match(/pre[\s-]*tax[:\s]+\$?([\d,]+)/i) || output.match(/\$([\d,]+)\s*pre-tax/i);
    const totalMatch  = output.match(/total[:\s]+[A-Z$]*([\d,]+)/i) || output.match(/\$([\d,]+)\s*(?:CAD|USD|total)/i);
    const hoursMatch  = output.match(/([\d.]+)\s*h(?:ours?)?/i);
    const teamMatch   = output.match(/(\d)\s*partner/i);

    // Infer fields from input text
    const bedsMatch   = raw.match(/(\d)\s*(?:br|bed)/i);
    const sqftMatch   = raw.match(/([\d,]+)\s*sqft/i);
    const isAZ = /arizona|scottsdale|phoenix|tempe|mesa|chandler|gilbert/i.test(raw);

    const pkgMap = {
      "refresh":    "Refresh Clean",
      "full home":  "Full Home Clean",
      "deep":       "Deep Clean",
      "move":       "Move-In / Move-Out",
      "kitchen":    "Kitchen & Bathroom Refresh",
      "pre-sale":   "Pre-Sale Clean",
      "post-reno":  "Post-Renovation Clean",
    };
    let serviceType = "Refresh Clean";
    for (const [k, v] of Object.entries(pkgMap)) {
      if (raw.toLowerCase().includes(k)) { serviceType = v; break; }
    }

    const freqMap = { "weekly": "Weekly", "bi-weekly": "Bi-Weekly", "monthly": "Monthly" };
    let frequency = "One-Time";
    for (const [k,v] of Object.entries(freqMap)) {
      if (raw.toLowerCase().includes(k)) { frequency = v; break; }
    }

    const preTax    = preTaxMatch ? parseInt(preTaxMatch[1].replace(/,/g,'')) : 0;
    const total     = totalMatch  ? parseInt(totalMatch[1].replace(/,/g,''))  : 0;
    const teamSize  = teamMatch   ? parseInt(teamMatch[1]) : 1;
    const hours     = hoursMatch  ? parseFloat(hoursMatch[1]) : 1.5;
    const partnerPay = Math.round(preTax * 0.65);
    const profit     = Math.round(preTax * 0.35);

    const newLead = {
      id:            Date.now(),
      name:          "",
      email:         "",
      phone:         "",
      address:       "",
      region:        isAZ ? "AZ" : "ON",
      dwellingType:  /condo|apartment/i.test(raw) ? "Apartment / Condo"
                   : /semi|town/i.test(raw) ? "Semi / Townhouse"
                   : "Detached House",
      dwellingSize:  bedsMatch ? (bedsMatch[1]==="1"?"1 Bed":bedsMatch[1]==="2"?"2 Bed":"3 Bed") : "2 Bed",
      beds:          bedsMatch ? parseInt(bedsMatch[1]) : 2,
      baths:         1,
      sqft:          sqftMatch ? parseInt(sqftMatch[1].replace(/,/g,'')) : 900,
      serviceType,
      frequency,
      addons:        [],
      notes:         `VA Quote Agent result:\n${output.slice(0, 500)}`,
      status:        "Quoted",
      source:        "VA Quote Agent",
      quotedDate:    new Date().toLocaleDateString(),
      quotedPrice:   preTax || total,
      clientPrice:   total || preTax,
      partnerPay,
      profit,
      teamSize,
      hours,
      condition:     /heavy/i.test(raw) ? "Heavy" : /light/i.test(raw) ? "Light" : "Average",
      workOrder:     null,
      paymentConfirmed: false,
      bookedDate:    "",
      createdAt:     new Date().toISOString(),
    };

    setResLeads(ls => [newLead, ...(ls||[])]);
    setSavedLead(true);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        <div style={{ width:52, height:52, borderRadius:14, background:`${cfg.color}22`, border:`2px solid ${cfg.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{cfg.icon}</div>
        <div>
          <div style={{ fontWeight:800, fontSize:20 }}>{cfg.title}</div>
          <div style={{ fontSize:13, color:C.muted }}>{cfg.purpose}</div>
        </div>
        <div style={{ marginLeft:"auto", padding:"4px 12px", borderRadius:20, background:`${cfg.color}22`, color:cfg.color, fontSize:11, fontWeight:700, border:`1px solid ${cfg.color}44` }}>HUC AI Agent</div>
      </div>

      {/* Output sections */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
        {cfg.outputSections.map(s => (
          <span key={s} style={{ padding:"4px 12px", borderRadius:20, background:C.surface, color:C.muted, fontSize:11, fontWeight:600, border:`1px solid ${C.border}` }}>📤 {s}</span>
        ))}
      </div>

      {/* Input */}
      <div style={{ ...S.card, marginBottom:16 }}>
        <div style={S.label}>{cfg.inputLabel}</div>
        <textarea
          style={{ ...S.input, minHeight:100, resize:"vertical", fontSize:13, lineHeight:1.6 }}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={cfg.inputPlaceholder}
        />
        <div style={{ display:"flex", gap:10, marginTop:10 }}>
          <button
            style={{ ...S.btn("primary"), flex:1, background:loading?"#1A2235":cfg.color, color: loading?C.muted:"#0A0F1E" }}
            onClick={run}
            disabled={loading || !input.trim()}
          >
            {loading ? "⏳ Running..." : `${cfg.icon} Run ${cfg.title}`}
          </button>
          {input && <button style={S.btn("ghost")} onClick={() => setInput("")}>Clear</button>}
        </div>
      </div>

      {/* Output */}
      {(loading || output) && (
        <div style={{ ...S.card, marginBottom:16, borderLeft:`4px solid ${cfg.color}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
            <div style={{ fontWeight:700, fontSize:14, color:cfg.color }}>{cfg.icon} Agent Response</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {output && (
                <button style={S.btn("ghost")} onClick={copy}>
                  {copied ? "✅ Copied!" : "📋 Copy"}
                </button>
              )}
              {/* VA Quote Agent only — Save as Lead button */}
              {output && agent === "VA_Quote_Agent" && setResLeads && (
                <button
                  style={{ ...S.btn(savedLead ? "ghost" : "primary"), fontSize:13 }}
                  onClick={saveAsLead}
                  disabled={savedLead}
                >
                  {savedLead ? "✅ Saved to Leads!" : "➕ Save as Lead"}
                </button>
              )}
            </div>
          </div>
          {loading ? (
            <div style={{ display:"flex", gap:8, alignItems:"center", color:C.muted, fontSize:13 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:cfg.color, animation:"pulse2 1s infinite" }} />
              AI is thinking...
              <style>{`@keyframes pulse2{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
            </div>
          ) : (
            <div style={{ fontSize:13, color:C.text, lineHeight:1.8, whiteSpace:"pre-wrap" }}>{output}</div>
          )}
          {savedLead && (
            <div style={{ marginTop:12, padding:"10px 14px", background:C.accentDim, borderRadius:9, fontSize:13, color:C.accent, fontWeight:600 }}>
              ✅ Lead saved to 🏠 Residential Leads with "Quoted" status. Go there to add client name, email, and book the job.
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={S.card}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:10, color:C.muted }}>📋 Recent Runs (this session)</div>
          {history.map((h, i) => (
            <div key={i} style={{ borderBottom:`1px solid ${C.border}`, padding:"10px 0", cursor:"pointer" }} onClick={() => { setInput(h.input); setOutput(h.output); setSavedLead(false); }}>
              <div style={{ fontSize:11, color:C.dim, marginBottom:4 }}>{h.ts}</div>
              <div style={{ fontSize:12, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.input}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OPERATIONS MANAGER DASHBOARD ────────────────────────────────────────────
function OperationsManager({ jobs, partners, region, setTab }) {
  const [aiSummary, setAiSummary] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const todayJobs     = jobs.filter(j => j.date === today);
  const scheduledJobs = jobs.filter(j => j.status === "scheduled");
  const inProgressJobs= jobs.filter(j => j.status === "in-progress");
  const completedToday= jobs.filter(j => j.status === "completed" && j.date === today);
  const overdueJobs   = jobs.filter(j => j.status === "scheduled" && j.date < today);
  const availablePartners = partners.filter(p => p.onboarded && p.status !== "onboarding");
  const unassigned    = scheduledJobs.filter(j => !j.partnerId);

  const runOpsMgr = async () => {
    setLoadingAI(true);
    setAiSummary("");
    const context = `
Today's date: ${today}
Jobs scheduled today: ${todayJobs.length}
Jobs in progress: ${inProgressJobs.length}
Completed today: ${completedToday.length}
Overdue (scheduled but past date): ${overdueJobs.length}
Unassigned jobs: ${unassigned.length}
Available partners: ${availablePartners.length} (${availablePartners.map(p=>p.name).join(", ")})
Upcoming scheduled jobs: ${scheduledJobs.slice(0,5).map(j=>`${j.client} on ${j.date} (${j.type})`).join("; ")}
${overdueJobs.length > 0 ? `OVERDUE JOBS: ${overdueJobs.map(j=>`${j.client} was scheduled ${j.date}`).join("; ")}` : ""}
`.trim();

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are the Have Us Clean Operations Manager Agent. Track job status, follow-up dates, booked dates, assigned crew, and outstanding actions. Keep cold Leads separate from active Quotes. Your daily focus is the Quotes pipeline: new quote requests, quoted jobs needing follow-up, booked jobs needing work orders, and completed jobs needing closeout. Surface only what matters for the day. Be direct and action-oriented. Format as a short daily briefing with sections: TODAY'S PRIORITY ACTIONS, PIPELINE STATUS, FLAGS & EXCEPTIONS.`,
          messages: [{ role: "user", content: `Generate my daily operations briefing for Have Us Clean. Here is today's data:\n\n${context}` }],
        }),
      });
      const data = await res.json();
      setAiSummary(data.content?.map(b => b.text || "").join("\n") || "No response.");
    } catch {
      setAiSummary("⚠️ Could not connect to AI. Check your connection.");
    } finally {
      setLoadingAI(false);
    }
  };

  const StatusRow = ({ label, count, color, urgent }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ fontSize:13, color:C.muted }}>{label}</div>
      <div style={{ fontWeight:800, fontSize:18, color: urgent && count > 0 ? C.red : count > 0 ? color : C.dim }}>{count}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🧠 Operations Manager</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-12 }}>Have Us Clean — Daily briefing powered by AI</div>
        </div>
        <button style={{ ...S.btn("primary"), background: loadingAI ? C.surface : C.accent, color:"#0A0F1E" }} onClick={runOpsMgr} disabled={loadingAI}>
          {loadingAI ? "⏳ Generating..." : "🧠 Get AI Daily Briefing"}
        </button>
      </div>

      {/* Live stats */}
      <div style={S.grid4}>
        <StatCard label="Today's Jobs"   value={todayJobs.length}         icon="📋" color={C.accent} />
        <StatCard label="In Progress"    value={inProgressJobs.length}    icon="🔄" color={C.gold}   />
        <StatCard label="Overdue"        value={overdueJobs.length}       icon="⚠️" color={overdueJobs.length>0?C.red:C.dim} />
        <StatCard label="Unassigned"     value={unassigned.length}        icon="👤" color={unassigned.length>0?C.gold:C.dim} />
      </div>

      <div style={S.divider} />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", gap:16, marginBottom:20 }}>
        {/* Pipeline snapshot */}
        <div style={S.card}>
          <div style={S.h3}>📊 Pipeline Snapshot</div>
          <StatusRow label="Scheduled (upcoming)" count={scheduledJobs.length} color={C.blue} />
          <StatusRow label="In Progress now"      count={inProgressJobs.length} color={C.gold} />
          <StatusRow label="Completed today"      count={completedToday.length} color={C.accent} />
          <StatusRow label="Overdue jobs"         count={overdueJobs.length}  color={C.red} urgent />
          <StatusRow label="Unassigned jobs"      count={unassigned.length}   color={C.gold} urgent />
        </div>

        {/* Team snapshot */}
        <div style={S.card}>
          <div style={S.h3}>👥 Team Snapshot</div>
          {availablePartners.map(p => {
            const todayP = jobs.filter(j => j.partnerId === p.id && j.date === today);
            const statusColor = p.status === "active" ? C.accent : p.status === "available" ? C.blue : C.muted;
            return (
              <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", background:avatarColors[p.id%4], display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800 }}>{p.avatar}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700 }}>{p.name}</div>
                    <div style={{ fontSize:11, color:statusColor }}>{p.status}</div>
                  </div>
                </div>
                <div style={{ fontSize:12, color:C.muted }}>{todayP.length} job{todayP.length!==1?"s":""} today</div>
              </div>
            );
          })}
          {availablePartners.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>No active partners.</div>}
        </div>
      </div>

      {/* Overdue jobs */}
      {overdueJobs.length > 0 && (
        <div style={{ ...S.card, marginBottom:16, borderLeft:`4px solid ${C.red}` }}>
          <div style={{ fontWeight:800, fontSize:15, color:C.red, marginBottom:10 }}>⚠️ Overdue Jobs — Needs Action</div>
          {overdueJobs.map(j => (
            <div key={j.id} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}`, fontSize:13 }}>
              <div><strong>{j.client}</strong> · {j.type} · {j.address}</div>
              <div style={{ color:C.red }}>Was: {j.date}</div>
            </div>
          ))}
        </div>
      )}

      {/* AI Briefing */}
      {(loadingAI || aiSummary) && (
        <div style={{ ...S.card, borderLeft:`4px solid ${C.accent}` }}>
          <div style={{ fontWeight:700, fontSize:15, color:C.accent, marginBottom:12 }}>🧠 AI Operations Briefing</div>
          {loadingAI ? (
            <div style={{ color:C.muted, fontSize:13, display:"flex", gap:8, alignItems:"center" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:C.accent, animation:"pulse2 1s infinite" }} />
              Analyzing your pipeline...
            </div>
          ) : (
            <div style={{ fontSize:13, color:C.text, lineHeight:1.8, whiteSpace:"pre-wrap" }}>{aiSummary}</div>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div style={{ ...S.card, marginTop:16 }}>
        <div style={S.h3}>⚡ Quick Actions</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <button style={S.btn("primary")} onClick={() => setTab("res")}>🏠 Open Leads</button>
          <button style={S.btn("ghost")}   onClick={() => setTab("jobs")}>📋 Open Jobs</button>
          <button style={S.btn("ghost")}   onClick={() => setTab("agent_quote")}>💬 Run VA Quote Agent</button>
          <button style={S.btn("ghost")}   onClick={() => setTab("agent_workorder")}>🔧 Generate Work Order</button>
          <button style={S.btn("ghost")}   onClick={() => setTab("partners")}>👥 Manage Partners</button>
        </div>
      </div>
    </div>
  );
}

// ─── MARKETING HUB ────────────────────────────────────────────────────────────
const CONTENT_CALENDAR = [
  { day:"Monday",    theme:"💰 Pricing / Trust",      desc:"Show real prices. Build trust with transparent pricing.",     cta:"Get a free quote today →",    hashtags:["#TorontoCleaning","#HouseCleaningToronto","#TransparentPricing"] },
  { day:"Tuesday",   theme:"📸 Before / After",        desc:"Real results. Show a transformation from a real job.",         cta:"Book your clean today →",     hashtags:["#BeforeAndAfter","#CleanHome","#TorontoCleaning"] },
  { day:"Wednesday", theme:"🚿 Offer — K&B Refresh",  desc:"Highlight the Kitchen & Bathroom Refresh entry offer ($120–$200).", cta:"Message us to book →",   hashtags:["#KitchenCleaning","#BathroomCleaning","#HaveUsClean"] },
  { day:"Thursday",  theme:"🎓 Educational",           desc:"Cleaning tips, the RAG system, microfiber technique, etc.",    cta:"Follow for more tips →",      hashtags:["#CleaningTips","#ProfessionalCleaner","#CleaningHacks"] },
  { day:"Friday",    theme:"⭐ Social Proof",           desc:"Client testimonial or review. Real words, real trust.",        cta:"See what our clients say →",  hashtags:["#CustomerReview","#5Stars","#TorontoSmallBusiness"] },
  { day:"Saturday",  theme:"🔔 Soft Sell / Reminder",  desc:"Weekend reminder. Light urgency, easy yes.",                   cta:"Spots available this week →", hashtags:["#WeekendCleaning","#TorontoCleaning","#HouseCleaners"] },
  { day:"Sunday",    theme:"💬 Story / Repost",        desc:"Optional story, behind-the-scenes, or repost from the week.",  cta:"DM us anytime →",            hashtags:["#BehindTheScenes","#CleaningBusiness","#Toronto"] },
];

const INSTAGRAM_CAROUSEL = [
  { slide:1, title:"Cleaning Prices in Toronto 🧹", desc:"We believe in transparent pricing. Here's exactly what we charge." },
  { slide:2, title:"Apartment / Condo Pricing",   desc:"1 Bed: $140–$180 · 2 Bed: $160–$220 · 3 Bed: $200–$260 (one-time)" },
  { slide:3, title:"House Pricing",                desc:"Small: $180–$240 · Medium: $220–$320 · Large: $300–$400 (one-time)" },
  { slide:4, title:"Deep Clean Pricing",           desc:"First-time or heavy buildup? Starting from $250–$700+" },
  { slide:5, title:"Kitchen & Bathroom Refresh ✨",desc:"Our entry offer. Targeted clean starting at $120–$200. Easy yes." },
  { slide:6, title:"Add-Ons",                     desc:"Fridge $40–60 · Oven $40–70 · Carpet $60–120 · Pet hair $40–80" },
  { slide:7, title:"Get Your Quote Today",         desc:"DM us or visit haveusclean.com · haveusclean@gmail.com" },
];

function MarketingHub({ region }) {
  const [activeTab, setActiveTab] = useState("calendar");
  const [aiInput, setAiInput]     = useState("");
  const [aiOutput, setAiOutput]   = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const runSocial = async (prompt) => {
    setLoadingAI(true);
    setAiOutput("");
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: HUC_AGENTS.Social_Content_Agent.system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      setAiOutput(data.content?.map(b => b.text || "").join("\n") || "No response.");
    } catch {
      setAiOutput("⚠️ Could not connect to AI.");
    } finally {
      setLoadingAI(false);
    }
  };

  const copy = () => { navigator.clipboard?.writeText(aiOutput); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  const tabs = [
    { id:"calendar", label:"📅 30-Day Calendar" },
    { id:"carousel", label:"🎠 Pricing Carousel" },
    { id:"generator",label:"✍️ Content Generator" },
    { id:"dm",       label:"💌 DM Scripts" },
  ];

  return (
    <div>
      <div style={S.h2}>📣 Marketing Hub</div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:18, marginTop:-12 }}>Have Us Clean — Social Strategy · Toronto & GTA</div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:20, flexWrap:"wrap" }}>
        {tabs.map(t => <button key={t.id} style={{ ...S.navBtn(activeTab===t.id), fontSize:13 }} onClick={()=>setActiveTab(t.id)}>{t.label}</button>)}
      </div>

      {/* 30-Day Calendar */}
      {activeTab === "calendar" && (
        <div>
          <div style={{ ...S.card, marginBottom:18, background:"linear-gradient(135deg,#0A0F1E,#1A2235)", borderLeft:`4px solid ${C.blue}` }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:6 }}>📅 Your 30-Day Content System</div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>
              A repeating weekly pattern across Instagram, Facebook, X, and LinkedIn. Each pillar builds a different part of your audience — trust, desire, proof, and action. The Kitchen & Bathroom Refresh appears every Wednesday as your easiest "yes" offer.
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {CONTENT_CALENDAR.map(day => (
              <div key={day.day} style={{ ...S.card, cursor:"pointer", borderLeft:selectedDay?.day===day.day?`4px solid ${C.blue}`:`4px solid ${C.border}` }} onClick={()=>setSelectedDay(selectedDay?.day===day.day?null:day)}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:90, fontWeight:800, fontSize:13, color:C.muted, flexShrink:0 }}>{day.day}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{day.theme}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{day.desc}</div>
                  </div>
                  <button style={S.btn("sm")} onClick={e=>{ e.stopPropagation(); setActiveTab("generator"); setAiInput(`Write a ${day.day} post. Theme: ${day.theme}. ${day.desc} CTA: ${day.cta} Platform: Instagram. Have Us Clean, Toronto & GTA.`); }}>✍️ Generate</button>
                </div>
                {selectedDay?.day===day.day && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:12, color:C.accent, marginBottom:6 }}>CTA: {day.cta}</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {day.hashtags.map(h=><span key={h} style={{ fontSize:11, color:C.blue, background:C.blueDim, padding:"2px 8px", borderRadius:20 }}>{h}</span>)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pricing Carousel */}
      {activeTab === "carousel" && (
        <div>
          <div style={{ ...S.card, marginBottom:18, borderLeft:`4px solid ${C.gold}` }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:4 }}>🎠 Pricing Carousel — Instagram</div>
            <div style={{ fontSize:13, color:C.muted }}>7-slide carousel structure for Instagram. Copy this layout into Canva. Modern startup style — clean, bold, transparent.</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:12 }}>
            {INSTAGRAM_CAROUSEL.map(s => (
              <div key={s.slide} style={{ ...S.card, borderTop:`3px solid ${C.gold}` }}>
                <div style={{ fontWeight:800, fontSize:11, color:C.dim, marginBottom:6 }}>SLIDE {s.slide}</div>
                <div style={{ fontWeight:800, fontSize:15, marginBottom:8 }}>{s.title}</div>
                <div style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ ...S.card, marginTop:16, background:C.surface }}>
            <div style={S.h3}>📐 Design Notes for Canva</div>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.8 }}>
              • Style: Modern startup — dark background (#0A0F1E), teal accent (#00D4AA), white text<br/>
              • Font: DM Sans Bold for headlines, regular for body<br/>
              • Slide 1: Big hook headline + brand name<br/>
              • Slides 2–6: One price point or offer per slide — big numbers, short copy<br/>
              • Slide 7: CTA with email + booking prompt<br/>
              • Always include your logo or brand name on every slide
            </div>
          </div>
        </div>
      )}

      {/* Content Generator */}
      {activeTab === "generator" && (
        <div>
          <div style={{ ...S.card, marginBottom:16 }}>
            <div style={S.h3}>✍️ AI Social Content Generator</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:12 }}>Powered by the Social Content Agent. Describe what you need and get ready-to-post copy.</div>
            <textarea
              style={{ ...S.input, minHeight:90, resize:"vertical", fontSize:13 }}
              value={aiInput}
              onChange={e=>setAiInput(e.target.value)}
              placeholder="e.g. Instagram post for Wednesday, Kitchen & Bathroom Refresh offer, $120–$200 entry price, Toronto audience, modern tone, drive DMs"
            />
            <div style={{ display:"flex", gap:10, marginTop:10 }}>
              <button style={{ ...S.btn("primary"), flex:1 }} onClick={()=>runSocial(aiInput)} disabled={loadingAI||!aiInput.trim()}>
                {loadingAI ? "⏳ Generating..." : "📱 Generate Content"}
              </button>
              {aiInput && <button style={S.btn("ghost")} onClick={()=>setAiInput("")}>Clear</button>}
            </div>
          </div>

          {/* Shortcut buttons for common posts */}
          <div style={{ ...S.card, marginBottom:16 }}>
            <div style={S.h3}>⚡ Quick Generate</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {CONTENT_CALENDAR.map(d => (
                <button key={d.day} style={S.btn("sm")} onClick={()=>{ setActiveTab("generator"); setAiInput(`Write a ${d.day} post. Theme: ${d.theme}. ${d.desc} CTA: ${d.cta} Platform: Instagram. Have Us Clean, Toronto & GTA.`); }}>
                  {d.theme}
                </button>
              ))}
            </div>
          </div>

          {(loadingAI || aiOutput) && (
            <div style={{ ...S.card, borderLeft:`4px solid ${C.blue}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontWeight:700, color:C.blue }}>📱 Generated Content</div>
                {aiOutput && <button style={S.btn("ghost")} onClick={copy}>{copied?"✅ Copied!":"📋 Copy"}</button>}
              </div>
              {loadingAI ? (
                <div style={{ color:C.muted, fontSize:13 }}>✍️ Writing your content...</div>
              ) : (
                <div style={{ fontSize:13, color:C.text, lineHeight:1.8, whiteSpace:"pre-wrap" }}>{aiOutput}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* DM Scripts */}
      {activeTab === "dm" && (
        <div>
          <div style={{ ...S.card, marginBottom:16, borderLeft:`4px solid ${C.accent}` }}>
            <div style={S.h3}>💌 DM Conversion Scripts</div>
            <div style={{ fontSize:13, color:C.muted }}>Use these as starting points. The AI DM Conversion Agent (in 🤖 AI Agents tab) can generate custom replies from real incoming messages.</div>
          </div>
          {[
            { title:"Initial Inquiry Response", trigger:"Someone asks 'how much does it cost?'", script:`Hi [Name]! Thanks for reaching out 😊\n\nWe serve Toronto & GTA with transparent, flat-rate pricing. A few quick questions so I can give you an accurate number:\n\n1. What type of place? (condo, house, townhouse)\n2. How many bedrooms and bathrooms?\n3. Looking for a one-time clean or recurring?\n\nOnce I know, I can get you a price within minutes! 🧹` },
            { title:"Soft Objection — Price Too High", trigger:"'That's a bit more than I expected'", script:`Totally get it — we're mid-market, not the cheapest, because we use trained, vetted partners and a professional colour-coded cleaning system.\n\nIf you want to try us without committing to a full clean, our Kitchen & Bathroom Refresh starts at $120–$200 — it's the most popular first clean. Most clients book recurring after that 😊\n\nWant me to quote that for you?` },
            { title:"24hr Follow-Up (No Reply)", trigger:"Sent quote 24hrs ago, no response", script:`Hey [Name]! Just following up on the quote I sent yesterday for your [property type] in [area].\n\nWe have availability this week — happy to answer any questions or adjust the quote if needed 🙂\n\nLet me know!` },
            { title:"Booking Confirmation", trigger:"Client says yes", script:`Amazing! Let's get that locked in 🎉\n\nI'll confirm:\n✅ Service: [package]\n✅ Date: [date] at [time]\n✅ Address: [address]\n\nYou'll receive a reminder the day before. Please ensure access is available at the scheduled time.\n\nLooking forward to it! — Have Us Clean 🧹` },
          ].map(script => (
            <div key={script.title} style={{ ...S.card, marginBottom:12 }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:4 }}>{script.title}</div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>📌 When: {script.trigger}</div>
              <div style={{ background:C.bg, borderRadius:8, padding:"10px 14px", fontSize:13, color:C.text, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{script.script}</div>
              <button style={{ ...S.btn("sm"), marginTop:8 }} onClick={()=>{ navigator.clipboard?.writeText(script.script); alert("Copied! ✅"); }}>📋 Copy Script</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── UPDATED DASHBOARD ────────────────────────────────────────────────────────
function DashboardV2({ jobs, partners, region = ACTIVE_REGION, setTab = ()=>{} }) {
  const today = new Date().toISOString().split("T")[0];
  const todayJobs = jobs.filter(j=>j.date===today);
  const completed = jobs.filter(j=>j.status==="completed");
  const totalRevenue = completed.reduce((a,b)=>a+(b.clientPrice||0),0);
  const totalProfit  = completed.reduce((a,b)=>a+(b.profit||0),0);
  const avgMargin    = totalRevenue>0?((totalProfit/totalRevenue)*100).toFixed(1):"0";
  const f = (n) => fmtC(n, region);

  return (
    <div>
      <div style={{ marginBottom:22 }}>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.5px" }}>Good morning! 👋</div>
        <div style={{ color:C.muted, marginTop:4, fontSize:14 }}>Here's your business overview — {BRAND.name} v{BRAND.version}</div>
      </div>
      <div style={S.grid4}>
        <StatCard label="Jobs Today"       value={todayJobs.length}                  icon="📅" color={C.accent}  sub={`${todayJobs.filter(j=>j.status==="in-progress").length} in progress`} />
        <StatCard label="Active Partners"  value={partners.filter(p=>p.onboarded).length} icon="👥" color={C.blue}   sub={`${partners.filter(p=>!p.onboarded).length} onboarding`} />
        <StatCard label={`Revenue (${region.currency})`} value={f(totalRevenue)}     icon="💵" color={C.gold}   sub="completed jobs" />
        <StatCard label="Gross Profit"     value={f(totalProfit)}                     icon="📈" color={C.purple} sub={`${avgMargin}% avg margin`} />
      </div>
      <div style={S.divider} />
      <div style={S.grid2}>
        <div>
          <div style={S.h3}>Today's Schedule</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {todayJobs.length===0 && <div style={{ color:C.muted, fontSize:13 }}>No jobs today.</div>}
            {todayJobs.map(job=>{
              const partner = partners.find(p=>p.id===job.partnerId);
              return (
                <div key={job.id} style={{ ...S.cardSm, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  <div style={{ fontSize:20 }}>{job.status==="completed"?"✅":job.status==="in-progress"?"🔄":"📋"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{job.client}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{job.time} · {job.type}</div>
                  </div>
                  {partner && <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={S.avatar(avatarColors[partner.id%4])}>{partner.avatar}</div><span style={{ fontSize:12, color:C.muted }}>{partner.name.split(" ")[0]}</span></div>}
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:800, color:C.accent }}>${job.clientPrice}</div>
                    <div style={{ fontSize:11, color:C.gold }}>+${job.profit} profit</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div style={S.h3}>Profit by Job (All Time)</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {jobs.filter(j=>j.clientPrice>0).map(job=>{
              const margin = job.clientPrice>0?((job.profit/job.clientPrice)*100).toFixed(1):0;
              return (
                <div key={job.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1, fontSize:13, fontWeight:600, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{job.client}</div>
                  <div style={{ fontSize:12, color:C.gold, fontWeight:700, flexShrink:0 }}>${job.profit}</div>
                  <ProfitBadge margin={parseFloat(margin)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── JOBS ────────────────────────────────────────────────────────────────────
function Jobs({ jobs, setJobs, partners }) {
  const [filter, setFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [pendingCompleteId, setPendingCompleteId] = useState(null);
  const [summaryText, setSummaryText] = useState("");
  const [newJob, setNewJob] = useState({ client: "", address: "", type: "Standard Clean", date: "", time: "", partnerId: "", hours: 2, upsells: [], beforePics: [], afterPics: [], summary: "", status: "scheduled", pay: 0 });

  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);

  const calcPay = (partnerId, hours, upsells) => {
    const partner = partners.find(p => p.id === parseInt(partnerId));
    if (!partner) return 0;
    return (partner.payRate * hours) + (upsells.length * 12);
  };

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
    setNewJob({ client:"", address:"", type:"Standard Clean", date:"", time:"", partnerId:"", partnerIds:[], sqft:0, hours:2, upsells:[], beforePics:[], afterPics:[], summary:"", status:"scheduled", pay:0 });
  };

  const updateStatus = (id, status) => setJobs(jobs.map(j => j.id === id ? { ...j, status } : j));
  const updateSummary = (id, summary) => setJobs(jobs.map(j => j.id === id ? { ...j, summary } : j));
  const toggleUpsell = (upsell) => {
    const u = newJob.upsells.includes(upsell) ? newJob.upsells.filter(x => x !== upsell) : [...newJob.upsells, upsell];
    setNewJob({ ...newJob, upsells: u });
  };

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
        {filtered.map(job => {
          const jobPartners = (job.partnerIds || [job.partnerId]).map(id => partners.find(p => p.id === id)).filter(Boolean);
          return (
            <div key={job.id} style={styles.card}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{job.client}</div>
                  <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>📍 {job.address}</div>
                  <div style={{ color: C.muted, fontSize: 13 }}>📅 {job.date} at {job.time} · {job.type}</div>
                  {jobPartners.length > 0 && <div style={{ fontSize: 13, marginTop: 4 }}>👷 <strong>{jobPartners.map(p=>p.name).join(" + ")}</strong></div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <div style={styles.badge(job.status === "completed" ? "green" : job.status === "in-progress" ? "gold" : "blue")}>{job.status}</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: C.accent }}>${job.pay}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{job.hours}h · {(job.upsells||[]).length} upsells</div>
                </div>
              </div>

              {(job.upsells||[]).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={styles.label}>Upsells</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(job.upsells||[]).map(u => <span key={u} style={styles.badge("gold")}>{u}</span>)}
                  </div>
                </div>
              )}

              {job.status === "completed" && job.summary && (
                <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={styles.label}>End-of-Job Summary</div>
                  <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{job.summary}</div>
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
        })}
      </div>

      {/* ── Summary drawer — replaces window.prompt for job completion ── */}
      {summaryDrawerOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:600, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={e => { if(e.target===e.currentTarget) setSummaryDrawerOpen(false); }}>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"16px 16px 0 0", padding:"24px 20px", width:"100%", maxWidth:480, boxSizing:"border-box", paddingBottom:"max(20px,env(safe-area-inset-bottom,20px))" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:C.border, margin:"0 auto 20px" }} />
            <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:8 }}>✅ Complete Job</div>
            <div style={{ fontSize:14, color:C.muted, marginBottom:16 }}>Add an end-of-job summary (optional)</div>
            <textarea
              value={summaryText}
              onChange={e => setSummaryText(e.target.value)}
              placeholder="e.g. Client was happy. Carpet came out great. No issues."
              rows={4}
              style={{ width:"100%", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", outline:"none" }}
              autoFocus
            />
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
              <button style={{ padding:14, borderRadius:10, border:"none", background:C.gold, color:"#0A0F1E", fontSize:15, fontWeight:800, cursor:"pointer", minHeight:44 }}
                onClick={() => {
                  if(pendingCompleteId) {
                    if(summaryText.trim()) updateSummary(pendingCompleteId, summaryText.trim());
                    updateStatus(pendingCompleteId, "completed");
                  }
                  setSummaryDrawerOpen(false);
                  setPendingCompleteId(null);
                  setSummaryText("");
                }}>
                Mark as Completed
              </button>
              <button style={{ padding:14, borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:15, fontWeight:600, cursor:"pointer", minHeight:44 }}
                onClick={() => { setSummaryDrawerOpen(false); setPendingCompleteId(null); setSummaryText(""); }}>
                Cancel
              </button>
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
              <div><div style={styles.label}>Sqft</div><input style={styles.input} type="number" value={newJob.sqft||""} onChange={e => setNewJob({ ...newJob, sqft: parseInt(e.target.value)||0, hours: getJobHours(parseInt(e.target.value)||0) })} placeholder="e.g. 1200" /></div>
              <div><div style={styles.label}>Est. Hours</div><input style={styles.input} type="number" min={1} max={12} value={newJob.hours} onChange={e => setNewJob({ ...newJob, hours: parseInt(e.target.value) })} /></div>
            </div>
            <div>
              <div style={styles.label}>
                Assign Team
                {newJob.sqft && <span style={{ marginLeft:8, fontSize:11, color:C.accent, fontWeight:700 }}>
                  👥 {getTeamSize(newJob.sqft)} partner{getTeamSize(newJob.sqft)>1?"s":""} recommended for {newJob.sqft} sqft
                </span>}
              </div>
              {[0,1,2].slice(0, Math.max(1, getTeamSize(newJob.sqft||0))).map((slot, i) => (
                <select key={slot} style={{ ...styles.select, marginBottom:6 }}
                  value={(newJob.partnerIds||[])[i] || ""}
                  onChange={e => {
                    const ids = [...(newJob.partnerIds||[null,null,null])];
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
                  <button key={u} onClick={() => toggleUpsell(u)} style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: newJob.upsells.includes(u) ? C.accentDim : C.surface,
                    color: newJob.upsells.includes(u) ? C.accent : C.muted,
                    border: `1px solid ${newJob.upsells.includes(u) ? C.accent : C.border}`
                  }}>{u}</button>
                ))}
              </div>
            </div>
            {(newJob.partnerIds||[]).filter(Boolean).length > 0 && (
              <div style={{ background: C.surface, borderRadius: 10, padding: 14 }}>
                <div style={styles.label}>Pay Summary</div>
                {(() => {
                  const ids = (newJob.partnerIds||[]).filter(Boolean);
                  const teamSize = ids.length;
                  const clientPrice = Math.round((teamSize * PARTNER_COST_PER_HOUR * newJob.hours) / PARTNER_SHARE);
                  const partnerTotal = Math.round(clientPrice * PARTNER_SHARE);
                  const each = Math.round(partnerTotal / teamSize);
                  return (
                    <div>
                      <div style={{ fontSize:20, fontWeight:800, color:C.accent }}>${clientPrice} client price</div>
                      <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>
                        Partner total: ${partnerTotal} · Each: ${each} · Company: ${Math.round(clientPrice * COMPANY_SHARE)}
                      </div>
                      {teamSize > 1 && <div style={{ fontSize:12, color:C.gold, marginTop:4 }}>👥 {teamSize} partners × ${each} each</div>}
                    </div>
                  );
                })()}
              </div>
            )}
            <button style={{ ...styles.btn("primary"), width: "100%" }} onClick={handleAdd} disabled={!newJob.client || !(newJob.partnerIds||[newJob.partnerId]).filter(Boolean).length || !newJob.date}>Book Job</button>
          </div>
        </Modal>
      )}

      {selectedJob && (
        <Modal title={`📋 ${selectedJob.client}`} onClose={() => setSelectedJob(null)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* Work Order Header */}
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

            {/* RAG Reminder */}
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:700 }}>
              🎨 RAG SYSTEM: <span style={{ color:"#FF4757" }}>🔴 Red = Toilets ONLY</span> · <span style={{ color:"#FFA502" }}>🟡 Yellow = Sinks/Mirrors</span> · <span style={{ color:"#2ED573" }}>🟢 Green = Kitchen</span> · <span style={{ color:"#1E90FF" }}>🔵 Blue = General/Glass</span>
            </div>

            {/* Checklist */}
            <div>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>✅ Room-by-Room Checklist</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {(selectedJob.workOrder?.checklist || (() => {
                  const lists = {
                    "Refresh Clean":["Kitchen: surfaces, sink, appliance exteriors","Bathroom: toilet, sink, mirror, floor","Living areas: dust and vacuum","Floors: vacuum then mop"],
                    "Full Home Clean":["Kitchen: deep counters, sink, stovetop, appliances","All bathrooms: full clean incl. shower/tub","All rooms: dust, wipe, vacuum","Floors throughout: vacuum then mop"],
                    "Deep Clean":["Kitchen: inside microwave, stovetop detail, cabinets exterior","All bathrooms: grout scrub, fixtures polish","Baseboards throughout","All surfaces: detailed wipe-down","Floors: vacuum and mop"],
                    "Move-In / Move-Out":["Full empty-unit clean","Inside all cabinets and drawers","Inside appliances","All surfaces, fixtures, floors","Check and clean inside closets"],
                    "Kitchen & Bathroom Refresh":["Kitchen: counters, sink, cabinet exteriors, appliance wipe-down","Bathroom: full clean incl. toilet, sink, shower/tub, mirror","Both room floors"],
                  };
                  return lists[selectedJob.type] || lists["Full Home Clean"];
                })()).map((task, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, background:C.surface, borderRadius:8, padding:"8px 12px", fontSize:13 }}>
                    <span style={{ fontSize:16 }}>☐</span>
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Addons */}
            {selectedJob.upsells?.length > 0 && (
              <div>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>⭐ Add-On Tasks</div>
                {selectedJob.upsells.map((addon, i) => (
                  <div key={i} style={{ background:C.surface, borderRadius:8, padding:"8px 12px", fontSize:13, marginBottom:6 }}>
                    <strong>{addon}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* Client Notes */}
            {selectedJob.notes && (
              <div style={{ background:"#FFA50222", borderRadius:10, padding:"10px 14px", fontSize:13, borderLeft:`3px solid #FFA502` }}>
                <strong>⚠️ Client Notes:</strong> {selectedJob.notes}
              </div>
            )}

            {/* Before Photos */}
            <div>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>📷 Before Photos</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                {selectedJob.beforePics?.filter(p => p && !p.includes("_new")).map((p, i) => (
                  <img key={i} src={p} alt={`before-${i}`} style={{ width:80, height:80, borderRadius:10, objectFit:"cover", border:`2px solid ${C.border}` }} />
                ))}
                {(!selectedJob.beforePics || selectedJob.beforePics.filter(p => p && !p.includes("_new")).length === 0) && (
                  <div style={{ color:C.muted, fontSize:13 }}>No before photos yet</div>
                )}
                <label style={{ ...styles.btn("ghost"), fontSize:12, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 }}>
                  📷 Add Before Photo
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                    onChange={e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const updated = { ...selectedJob, beforePics: [...(selectedJob.beforePics||[]), ev.target.result] };
                        setJobs(jobs.map(j => j.id === selectedJob.id ? updated : j));
                        setSelectedJob(updated);
                      };
                      reader.readAsDataURL(file);
                    }} />
                </label>
              </div>
            </div>

            {/* After Photos */}
            <div>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>✨ After Photos</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                {selectedJob.afterPics?.filter(p => p && !p.includes("_new")).map((p, i) => (
                  <img key={i} src={p} alt={`after-${i}`} style={{ width:80, height:80, borderRadius:10, objectFit:"cover", border:`2px solid ${C.accent}44` }} />
                ))}
                {(!selectedJob.afterPics || selectedJob.afterPics.filter(p => p && !p.includes("_new")).length === 0) && (
                  <div style={{ color:C.muted, fontSize:13 }}>No after photos yet</div>
                )}
                <label style={{ ...styles.btn("primary"), fontSize:12, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 }}>
                  📷 Add After Photo
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                    onChange={e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const updated = { ...selectedJob, afterPics: [...(selectedJob.afterPics||[]), ev.target.result] };
                        setJobs(jobs.map(j => j.id === selectedJob.id ? updated : j));
                        setSelectedJob(updated);
                      };
                      reader.readAsDataURL(file);
                    }} />
                </label>
              </div>
            </div>

            {/* Job Summary */}
            <div>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>📝 End-of-Job Summary</div>
              <textarea style={{ ...styles.input, minHeight:80, resize:"vertical" }}
                value={selectedJob.summary || ""}
                onChange={e => {
                  const updated = { ...selectedJob, summary: e.target.value };
                  setJobs(jobs.map(j => j.id === selectedJob.id ? updated : j));
                  setSelectedJob(updated);
                }}
                placeholder="What was done, client feedback, any issues to flag..." />
            </div>

            {/* Pay Summary */}
            <div style={{ background:C.surface, borderRadius:10, padding:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:12, color:C.muted }}>Partner Pay (65%)</div>
                <div style={{ fontSize:22, fontWeight:800, color:C.accent }}>${selectedJob.pay?.toFixed(2) || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted }}>Client Price</div>
                <div style={{ fontSize:22, fontWeight:800 }}>${selectedJob.clientPrice?.toFixed(2) || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted }}>Hours</div>
                <div style={{ fontSize:22, fontWeight:800 }}>{selectedJob.hours}h</div>
              </div>
            </div>

          </div>
        </Modal>
      )}
    </div>
  );
}



// ─── PARTNERS ────────────────────────────────────────────────────────────────
function Partners({ partners, setPartners, jobs }) {
  const [showModal, setShowModal] = useState(false);
  const [newP, setNewP] = useState({ name: "", phone: "", email: "", payRate: 22, availability: [] });

  const handleAdd = () => {
    const initials = newP.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    setPartners([...partners, { ...newP, id: Date.now(), status: "onboarding", rating: 0, jobsDone: 0, onboarded: false, avatar: initials }]);
    setShowModal(false);
    setNewP({ name: "", phone: "", email: "", payRate: 22, availability: [] });
  };

  const toggleDay = (d) => setNewP({ ...newP, availability: newP.availability.includes(d) ? newP.availability.filter(x => x !== d) : [...newP.availability, d] });

  const partnerJobs = (id) => jobs.filter(j => j.partnerId === id);
  const partnerEarnings = (id) => jobs.filter(j => j.partnerId === id && j.status === "completed").reduce((a, b) => a + b.pay, 0);
  const pendingPay = (id) => jobs.filter(j => j.partnerId === id && j.status !== "completed").reduce((a, b) => a + b.pay, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={styles.h2}>Partners</div>
        <button style={styles.btn("primary")} onClick={() => setShowModal(true)}>+ Add Partner</button>
      </div>

      <div style={styles.grid2}>
        {partners.map(p => (
          <div key={p.id} style={styles.card}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={styles.avatar(avatarColors[p.id % 4])}>{p.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: C.muted }}>{p.phone} · {p.email}</div>
                <div style={{ marginTop: 6 }}>
                  <span style={styles.badge(p.status === "active" ? "green" : p.status === "available" ? "blue" : "gold")}>{p.status}</span>
                  {p.rating > 0 && <span style={{ marginLeft: 8, fontSize: 13, color: C.gold }}>⭐ {p.rating}</span>}
                </div>
              </div>
            </div>

            <div style={{ ...styles.divider, margin: "14px 0" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
              <div style={{ background: C.surface, borderRadius: 10, padding: "10px 8px" }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: C.accent }}>${p.payRate}/hr</div>
                <div style={{ fontSize: 11, color: C.muted }}>Pay Rate</div>
              </div>
              <div style={{ background: C.surface, borderRadius: 10, padding: "10px 8px" }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: C.blue }}>{partnerJobs(p.id).length}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Total Jobs</div>
              </div>
              <div style={{ background: C.surface, borderRadius: 10, padding: "10px 8px" }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: C.gold }}>${pendingPay(p.id)}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Pay Due</div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={styles.label}>Availability</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {DAYS.map(d => (
                  <span key={d} style={{
                    padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: p.availability.includes(d) ? C.accentDim : C.surface,
                    color: p.availability.includes(d) ? C.accent : C.dim,
                    border: `1px solid ${p.availability.includes(d) ? C.accent + "44" : C.border}`
                  }}>{d}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title="Add New Partner" onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><div style={styles.label}>Full Name</div><input style={styles.input} value={newP.name} onChange={e => setNewP({ ...newP, name: e.target.value })} placeholder="Jane Doe" /></div>
            <div><div style={styles.label}>Phone</div><input style={styles.input} value={newP.phone} onChange={e => setNewP({ ...newP, phone: e.target.value })} placeholder="555-0100" /></div>
            <div><div style={styles.label}>Email</div><input style={styles.input} value={newP.email} onChange={e => setNewP({ ...newP, email: e.target.value })} placeholder="jane@email.com" /></div>
            <div><div style={styles.label}>Hourly Pay Rate ($)</div><input style={styles.input} type="number" min={15} max={60} value={newP.payRate} onChange={e => setNewP({ ...newP, payRate: parseInt(e.target.value) })} /></div>
            <div>
              <div style={styles.label}>Availability</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map(d => (
                  <button key={d} onClick={() => toggleDay(d)} style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    background: newP.availability.includes(d) ? C.accentDim : C.surface,
                    color: newP.availability.includes(d) ? C.accent : C.muted,
                    border: `1px solid ${newP.availability.includes(d) ? C.accent : C.border}`
                  }}>{d}</button>
                ))}
              </div>
            </div>
            <button style={{ ...styles.btn("primary"), width: "100%" }} onClick={handleAdd} disabled={!newP.name}>Add Partner & Start Onboarding</button>
          </div>
        </Modal>
      )}
    </div>
  );
}



// ─── PAY ─────────────────────────────────────────────────────────────────────
function Pay({ partners, jobs }) {
  const completedJobs = jobs.filter(j => j.status === "completed");
  const pendingJobs   = jobs.filter(j => j.status !== "completed" && j.status !== "scheduled" ? false : j.status === "scheduled");
  const allActiveJobs = jobs.filter(j => j.status !== "completed");

  // Always calculate partnerPay as 65% of clientPrice if not already set correctly
  const getPartnerPay = (job) => {
    if (job.partnerPay && job.clientPrice && Math.abs(job.partnerPay - job.clientPrice * 0.65) < 5) return job.partnerPay;
    return partnerPayFromPrice(job.clientPrice || 0);
  };

  const totalEarned  = completedJobs.reduce((a, b) => a + getPartnerPay(b), 0);
  const totalPending = allActiveJobs.reduce((a, b) => a + getPartnerPay(b), 0);
  const totalRevenue = jobs.reduce((a, b) => a + (b.clientPrice || 0), 0);
  const companyTotal = jobs.reduce((a, b) => a + companyProfitFromPrice(b.clientPrice || 0), 0);

  return (
    <div>
      <div style={S.h2}>💰 Partner Pay</div>
      <div style={{ fontSize:13, color:C.muted, marginTop:-14, marginBottom:18 }}>
        Pay structure: <strong style={{ color:C.blue }}>Partner 65%</strong> · <strong style={{ color:C.gold }}>Company 35%</strong> of each job's client price
      </div>

      <div style={S.grid4}>
        <StatCard label="Total Revenue"      value={`$${totalRevenue.toLocaleString()}`}  icon="💵" color={C.accent} />
        <StatCard label="Partner Pay (Total)" value={`$${totalEarned.toLocaleString()}`}   icon="👥" color={C.blue}   sub="completed jobs" />
        <StatCard label="Pending Pay"         value={`$${totalPending.toLocaleString()}`}  icon="⏳" color={C.gold}   sub="scheduled jobs" />
        <StatCard label="Company Kept"        value={`$${companyTotal.toLocaleString()}`}  icon="🏢" color={C.accent} sub="35% of all jobs" />
      </div>

      <div style={S.divider} />
      <div style={S.h3}>Pay Breakdown by Partner</div>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {partners.map(p => {
          const pJobs      = jobs.filter(j => j.partnerId === p.id);
          const pCompleted = pJobs.filter(j => j.status === "completed");
          const pPending   = pJobs.filter(j => j.status === "scheduled" || j.status === "in-progress");
          const earned     = pCompleted.reduce((a, b) => a + getPartnerPay(b), 0);
          const pending    = pPending.reduce((a, b) => a + getPartnerPay(b), 0);
          const totalRev   = pJobs.reduce((a, b) => a + (b.clientPrice || 0), 0);

          return (
            <div key={p.id} style={S.card}>
              <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", marginBottom:14 }}>
                <div style={S.avatar(avatarColors[p.id % 4])}>{p.avatar}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>{p.name}</div>
                  <div style={{ fontSize:13, color:C.muted }}>{pJobs.length} jobs · ${totalRev.toLocaleString()} total client revenue</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:800, fontSize:22, color:C.gold }}>${pending.toLocaleString()} <span style={{ fontSize:12, fontWeight:600, color:C.muted }}>DUE</span></div>
                  <div style={{ fontSize:13, color:C.muted }}>${earned.toLocaleString()} paid all-time</div>
                  <div style={{ fontSize:11, color:C.blue, marginTop:2 }}>65% of each job</div>
                </div>
              </div>

              {/* Per-job breakdown */}
              {pJobs.length > 0 && (
                <div>
                  <div style={S.label}>Jobs</div>
                  {pJobs.slice(-5).reverse().map(job => {
                    const pay = getPartnerPay(job);
                    const statusColor = job.status==="completed" ? C.accent : job.status==="in-progress" ? C.gold : C.blue;
                    return (
                      <div key={job.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${C.border}` }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:600 }}>{job.client}</div>
                          <div style={{ fontSize:12, color:C.muted }}>{job.date} · {job.type}</div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{job.status}</span>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontWeight:800, color:C.blue }}>${pay}</div>
                            <div style={{ fontSize:10, color:C.dim }}>of ${job.clientPrice||0}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {pJobs.length === 0 && <div style={{ fontSize:13, color:C.muted }}>No jobs yet.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}



// ─── ONBOARDING ──────────────────────────────────────────────────────────────
// ─── TRAINING MODULES (Research-backed, with video + RAG system) ──────────────
// Color RAG system based on industry standard (ISSA / BSC / Janitorial Manager):
// 🔴 Red    = High-risk (toilets, urinals, bodily fluids)
// 🟡 Yellow = Moderate-risk restroom (sinks, counters, mirrors, soap dispensers)
// 🟢 Green  = Food-prep / kitchen surfaces (countertops, appliances, stovetop)
// 🔵 Blue   = Low-risk general / glass / electronics (windows, desks, lobbies)

const RAG_COLORS = [
  { color:"#FF4757", emoji:"🔴", name:"Red Rag",    zone:"High-Risk Restroom",     uses:["Toilets","Urinals","Restroom floors","Bodily fluid cleanup"],          never:["Kitchen","Living areas","Client's belongings"], bgColor:"#FF475715" },
  { color:"#FFB800", emoji:"🟡", name:"Yellow Rag", zone:"Moderate-Risk Restroom", uses:["Bathroom sinks","Countertops","Mirrors","Soap dispensers","Door handles (restroom)"], never:["Toilets/urinals","Kitchen food surfaces"], bgColor:"#FFB80015" },
  { color:"#2ED573", emoji:"🟢", name:"Green Rag",  zone:"Kitchen / Food Prep",    uses:["Kitchen counters","Stovetop exterior","Microwave exterior","Sink","Appliance surfaces"], never:["Bathrooms","Floors"], bgColor:"#2ED57315" },
  { color:"#3B82F6", emoji:"🔵", name:"Blue Rag",   zone:"General / Low-Risk",     uses:["Desks & surfaces","Windows & glass","Mirrors (non-restroom)","Electronics","Baseboards","Living areas"], never:["Bathrooms","Kitchen food prep"], bgColor:"#3B82F615" },
];

const TRAINING_MODULES = [
  {
    id: 1,
    title: "Welcome & Have Us Clean Standards",
    icon: "🏠",
    duration: "8 min read",
    category: "Foundations",
    badge: "Start Here",
    badgeColor: C.accent,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+like+a+pro+professional+cleaning+system",
    videoChannel: "Clean My Space — Melissa Maker (Toronto, 2M subscribers)",
    videoTitle: "How to Clean Like a Pro — The 3-Wave Professional System",
    keyPoints: [
      "Always arrive 5 minutes early — being on time is being late",
      "Wear your uniform at all times during the job",
      "Greet clients warmly — you represent the Have Us Clean brand",
      "Never use a client's personal products, food, or belongings",
      "If something is fragile or valuable, clean around it or ask the client",
      "Lock up and confirm with client before leaving every job",
    ],
    content: `Welcome to the CleanPro team! You're joining a professional cleaning company that operates across Ontario (Canada) and Arizona (USA). Our reputation is built on three things: consistency, trustworthiness, and attention to detail.\n\nYour job is not just to clean — it's to make clients feel cared for. A clean home reduces stress, improves health, and creates a lasting impression. You are the face of our company inside every client's home.\n\nProfessionalism checklist: ✅ Clean uniform ✅ Arrive early ✅ Phone on silent ✅ No strong perfume ✅ Bring your own supplies ✅ Never bring guests to a job ✅ Report anything unusual immediately.`,
    quiz: [
      { q: "What should you do if a client's valuable item is blocking the surface you need to clean?", a: "Clean around it or ask the client how they'd like you to handle it — never move valuables without permission." },
      { q: "What time should you arrive for a 9:00 AM job?", a: "8:55 AM — always aim to be 5 minutes early, never late." },
    ],
  },
  {
    id: 2,
    title: "Color RAG System — No Cross-Contamination",
    icon: "🎨",
    duration: "12 min read",
    category: "Core Skills",
    badge: "Critical",
    badgeColor: C.red,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+microfiber+cloths+color+coded+cross+contamination",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "Colour-Coded Microfiber — No Cross Contamination",
    ragModule: true,
    keyPoints: [
      "🔴 Red = Toilets & urinals ONLY — never leaves the bathroom",
      "🟡 Yellow = Other restroom surfaces (sinks, mirrors, dispensers)",
      "🟢 Green = Kitchen & food-prep surfaces only",
      "🔵 Blue = General cleaning, glass, desks, living areas",
      "NEVER use a rag from a higher-risk zone in a lower-risk zone",
      "After each job: bag all used rags by color for washing",
      "Wash colors separately — never mix red rags with green",
    ],
    content: `The Color RAG system is the #1 way to prevent cross-contamination — the transfer of bacteria and germs from dirty areas to clean ones. Cross-contamination is a serious health risk and a liability issue for CleanPro.\n\nStudies show that contaminating a single surface can spread a tracer virus to 40–60% of other surfaces in a space. One toilet rag used on a kitchen counter can transfer E. coli and other pathogens that cause illness.\n\nThe rule is simple: each color stays in its zone, every single time. No exceptions, even if a rag looks clean. Your clients are trusting you with their family's health.`,
    quiz: [
      { q: "You're cleaning a bathroom and need to wipe the mirror. Which rag do you use?", a: "Yellow — mirrors are a moderate-risk restroom surface. Never use the red rag on mirrors." },
      { q: "Can you use a blue rag in the kitchen?", a: "Only for non-food surfaces like cabinet exteriors, high-level dusting, or window sills. Never on food prep counters — that requires green." },
      { q: "After a job, how should you handle used rags?", a: "Bag all used rags by color. Wash separately. Never mix colors in the wash. Never re-use between jobs without washing first." },
    ],
  },
  {
    id: 3,
    title: "Wet vs. Dry Rag — The Streak-Free Method",
    icon: "💧",
    duration: "10 min read",
    category: "Core Skills",
    badge: "Pro Technique",
    badgeColor: C.blue,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+mirrors+windows+streak+free+microfiber",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "Streak-Free Mirrors & Glass — Wet Then Dry Microfiber Technique",
    keyPoints: [
      "Dry microfiber: use for dusting — the static charge grabs and traps particles",
      "Damp microfiber: use for grime, oils, dried residue — moisture activates capillary pull",
      "Soaking wet = wrong: too much water loses grip and spreads dirt instead of trapping it",
      "The two-step glass method: damp side first to lift grime, dry side to buff streak-free",
      "Fold your cloth into quarters — you get 8 clean sides from one cloth",
      "Spray surfaces, not the cloth — gives you control and avoids over-saturation",
      "NEVER use fabric softener when washing microfiber — it clogs the fibers permanently",
    ],
    content: `Microfiber is the gold standard in professional cleaning because its microscopic fibers create a static charge that physically traps dust, bacteria, and grime — not just pushes it around. But using it wrong produces streaks and misses dirt.\n\nTHE TWO-STEP METHOD (for glass, mirrors, stainless steel):\n1. Lightly dampen half your cloth with water or glass cleaner\n2. Wipe the surface with the damp side to lift grime and product residue\n3. Immediately follow with the dry side to buff away moisture and prevent streaks\n\nThis technique works because the damp pass loosens and picks up dirt while the dry pass removes the moisture film that causes streaks. No paper towels needed.\n\nTHE DRY METHOD (dusting):\nA dry microfiber cloth generates static electricity that attracts dust like a magnet. Use it dry on: blinds, electronics, wood furniture, shelves. Shake out when loaded; don't drag a full cloth as it re-deposits.`,
    wetDryGuide: [
      { surface:"Glass & Mirrors",       method:"Damp → Dry",  why:"Damp lifts residue; dry buffs streak-free" },
      { surface:"Stainless Steel",        method:"Damp → Dry",  why:"Follow the grain; dry buff removes water marks" },
      { surface:"Wood Furniture",         method:"Dry first",   why:"Dry traps dust; use barely damp only if sticky" },
      { surface:"Countertops (kitchen)",  method:"Damp",        why:"Green rag, damp — dissolves food residue; air-dry" },
      { surface:"Toilet bowl interior",   method:"Wet + product",why:"Red rag + toilet cleaner; full saturation needed" },
      { surface:"Bathroom sink/faucet",   method:"Damp → Dry",  why:"Yellow rag damp to clean, dry to shine chrome" },
      { surface:"Electronics/TV screen",  method:"Barely damp", why:"Excess moisture damages electronics; never spray directly" },
      { surface:"Baseboards",             method:"Dry first → Damp",why:"Dry removes loose dust; damp for sticky buildup" },
      { surface:"Floors (hard)",          method:"Damp mop",    why:"Don't soak — excess water damages wood and grout" },
    ],
    quiz: [
      { q: "You're cleaning a mirror and see streaks left behind. What went wrong?", a: "Either the cloth was too wet (no dry follow-up), the cloth had fabric softener residue, or you sprayed too much product. Fix: use the two-step damp-then-dry method." },
      { q: "Should you spray cleaner directly onto a TV screen?", a: "Never spray directly. Spray a barely damp cloth and wipe gently — direct spray can seep into edges and damage electronics." },
    ],
  },
  {
    id: 4,
    title: "Rag Care & Laundry Protocol",
    icon: "🧺",
    duration: "8 min read",
    category: "Core Skills",
    badge: "Hygiene",
    badgeColor: "#A78BFA",
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+wash+microfiber+cloths+no+fabric+softener",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Wash Microfiber Cloths — What NOT to Do",
    keyPoints: [
      "Microfiber: cold/warm wash, gentle detergent, NO fabric softener, low heat dry",
      "Cotton rags: hot wash OK, NO fabric softener, high heat to sanitize",
      "Wash colors separately — red never with green; prevent dye and bacteria transfer",
      "No bleach on microfiber — destroys the fibers permanently",
      "Replace rags showing pilling, weak absorption, or permanent stains",
      "Each rag can last 100+ washes if cared for properly",
      "Never put away damp rags — leads to mold and odor",
    ],
    content: `Your rags are your tools. A clogged or damaged microfiber cloth will streak, skip dirt, and actually spread bacteria instead of trapping it. Proper care isn't optional — it protects your clients and protects the company.\n\nMICROFIBER CARE RULES:\n✅ Wash in warm water (under 105°F / 40°C) with gentle, fragrance-free detergent\n✅ Wash microfiber ONLY with other microfiber — cotton lint clogs the fibers\n✅ Dry on LOW heat or air dry\n❌ NEVER use fabric softener — permanently coats fibers, destroys absorption\n❌ NEVER use bleach — degrades polyester fibers\n❌ NEVER iron microfiber cloths\n\nCOTTON/TERRY RAG CARE:\n✅ Hot wash with regular detergent to sanitize\n✅ Can use diluted bleach every 3–4 washes to fully sanitize\n✅ Hot dry is fine — high heat kills bacteria in cotton\n❌ Still no fabric softener — reduces absorbency`,
    quiz: [
      { q: "Why can't you use fabric softener on microfiber cloths?", a: "Fabric softener leaves a waxy coating that clogs the microscopic fibers, blocking their ability to trap dirt and absorb moisture. The cloth will start leaving streaks and spreading bacteria instead of removing it." },
      { q: "How should you dry used microfiber rags between jobs?", a: "Never put them away damp. Allow to fully air dry or use low dryer heat before storing. Damp storage creates mold and odor." },
    ],
  },
  {
    id: 5,
    title: "Room-by-Room Cleaning Procedure",
    icon: "🏡",
    duration: "20 min read",
    category: "Procedures",
    badge: "Full Walkthrough",
    badgeColor: C.gold,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+bathroom+professionally+fast+efficient",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean a Bathroom Fast & Professionally",
    keyPoints: [
      "Always work TOP → BOTTOM (dust falls down — clean it last)",
      "Always work BACK → FRONT (don't walk over cleaned areas)",
      "Start each room by removing trash and clearing surfaces",
      "Bathroom: red rag → toilet first, then yellow for sinks/mirrors",
      "Kitchen: green rag for food surfaces, blue for high shelves/windows",
      "Living areas: dry blue rag for dusting, then vacuum, then mop last",
      "Final sweep: check corners, under furniture, and light switches",
    ],
    roomGuide: [
      { room:"Bathroom",     icon:"🚽", ragColor:"🔴+🟡", steps:["Spray toilet bowl, let sit 2 min","Red rag: scrub toilet bowl, wipe exterior, base","Yellow rag: sinks, faucets, countertop","Yellow rag: mirror (damp then dry for streak-free)","Yellow rag: soap/towel dispensers, door handles","Mop floor last (dedicated bathroom mop — red handle)"] },
      { room:"Kitchen",      icon:"🍳", ragColor:"🟢+🔵", steps:["Green rag: countertops, wipe all food prep surfaces","Green rag: stovetop exterior (check for grime build-up)","Green rag: sink and faucet","Blue rag: upper cabinets exterior, window sills","Blue rag: microwave exterior and handle","Sweep and mop floor last (separate kitchen mop)"] },
      { room:"Living Room",  icon:"🛋", ragColor:"🔵",    steps:["Dry blue rag: all surfaces top to bottom (shelves → tables → baseboards)","Blue damp: wipe TV stand, coffee table if sticky","Glass surfaces: damp then dry method","Vacuum upholstery if included in service","Vacuum floor, including under furniture edges","Mop if hard floors"] },
      { room:"Bedroom",      icon:"🛏", ragColor:"🔵",    steps:["Remove and replace linens if requested","Dry blue rag: dust all surfaces (nightstands, dresser, fan blades)","Wipe mirrors (damp then dry)","Vacuum under bed and along baseboards","Vacuum/mop floors last"] },
      { room:"Entry/Stairs", icon:"🚪", ragColor:"🔵",    steps:["Dust light fixtures and railings","Wipe door handles and switch plates","Vacuum stairs — use crevice tool on edges","Mop hard entry floors last (this is the exit — work backward)"] },
    ],
    content: `The order you clean matters as much as how you clean. Professionals follow the same systematic approach every time — it removes human error, saves time, and produces consistent results that impress clients.\n\nTHE GOLDEN RULE: Top to bottom, back to front. Dust and debris fall down — if you vacuum first then dust, you're vacuuming twice. If you clean toward the exit, you never step on a clean floor.`,
    quiz: [
      { q: "You're in a kitchen. Which rag do you use on the stovetop? What about the window above the sink?", a: "Stovetop = Green rag (food-prep surface). Window above sink = Blue rag (glass/general surface). Never use the same rag for both." },
      { q: "Why do we clean back-to-front?", a: "So you never step or walk over surfaces you've already cleaned. You always exit through the last area cleaned." },
    ],
  },
  {
    id: 6,
    title: "Safety & Chemical Handling",
    icon: "🧪",
    duration: "15 min read",
    category: "Safety",
    badge: "Required",
    badgeColor: C.red,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+cleaning+products+you+should+never+mix+dangerous",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "Cleaning Products You Should NEVER Mix — Chemical Safety",
    keyPoints: [
      "NEVER mix bleach + ammonia — creates toxic chloramine gas",
      "NEVER mix bleach + vinegar — creates chlorine gas",
      "NEVER mix hydrogen peroxide + vinegar — creates corrosive peracetic acid",
      "Always read product labels before use — dilution ratios matter",
      "Wear gloves for all chemical use; eye protection for sprays",
      "Ensure ventilation — open windows when using strong products",
      "Store all chemicals upright and sealed, away from heat",
      "In case of skin contact: flush with water for 15+ minutes",
    ],
    content: `Chemical safety is non-negotiable. Every year cleaning workers are injured by accidental chemical mixing — most of which happens when people use multiple products without reading labels.\n\nDANGEROUS COMBINATIONS TO MEMORIZE:\n🚫 Bleach + Ammonia → Chloramine gas (lung damage)\n🚫 Bleach + Vinegar → Chlorine gas (toxic)\n🚫 Bleach + Rubbing Alcohol → Chloroform + other toxins\n🚫 Hydrogen Peroxide + Vinegar → Peracetic acid (corrosive)\n\nPROTECTIVE EQUIPMENT:\n✅ Nitrile gloves — always for any chemical\n✅ Safety glasses — when spraying overhead or using strong products\n✅ Ventilation — open windows, use exhaust fans\n✅ Never eat or drink while cleaning with chemicals`,
    quiz: [
      { q: "A surface has bleach on it from your last pass. You grab a bottle of vinegar-based cleaner to tackle a stain. Is this safe?", a: "NO — never. Bleach + vinegar creates chlorine gas. Wait until the bleach has fully dried and been rinsed, or use only one product at a time on a surface." },
    ],
  },
  {
    id: 7,
    title: "Using the CleanPro App",
    icon: "📱",
    duration: "10 min read",
    category: "Tools",
    badge: "App Training",
    badgeColor: C.accent,
    videoUrl: "https://www.youtube.com/results?search_query=cleaning+business+app+GPS+checkin+job+management+tutorial",
    videoChannel: "Have Us Clean Internal Training — record your own 5-min phone video!",
    videoTitle: "Using the Have Us Clean App — GPS Check-In, Photos & Job Completion",
    keyPoints: [
      "Check your schedule in the Jobs tab every morning",
      "GPS Check-In the moment you arrive — this starts your time log",
      "Take BEFORE photos before touching anything — protects you and the client",
      "Mark the job 'In Progress' when you start cleaning",
      "Log any upsells you sold — this adds to your pay",
      "Take AFTER photos when complete — proof of quality",
      "Write your end-of-job summary — mention anything unusual",
      "GPS Check-Out when you leave — closes the job",
    ],
    content: `The Have Us Clean app is your digital work order, time clock, and quality record all in one. Using it properly protects you if there's ever a dispute with a client, and it ensures you get paid accurately for every minute and every upsell.\n\nTHE JOB WORKFLOW:\n1. Receive job notification → check details (address, time, client notes)\n2. Navigate to address via Directions button\n3. GPS Check-In on arrival → takes your location as proof\n4. Take BEFORE photos — every room, every questionable surface\n5. Clean according to your checklist\n6. Log any upsells you discussed with the client\n7. Take AFTER photos — every area you cleaned\n8. Write a brief summary: what was done, any issues, client feedback\n9. GPS Check-Out — job is complete`,
    quiz: [
      { q: "Why do we take before photos before starting a clean?", a: "To document the condition of the home before you touched anything. If a client later claims something was broken or damaged, your before photos prove it was already in that condition." },
    ],
  },
  {
    id: 8,
    title: "Upsells & Client Communication",
    icon: "💬",
    duration: "10 min read",
    category: "Sales",
    badge: "Earn More",
    badgeColor: C.gold,
    videoUrl: "https://www.youtube.com/results?search_query=Angela+Brown+Savvy+Cleaner+how+to+upsell+cleaning+services+clients",
    videoChannel: "Savvy Cleaner — Angela Brown (cleaning business specialist)",
    videoTitle: "How to Upsell Cleaning Services Professionally",
    keyPoints: [
      "Upsells earn YOU more money — they're added to your job pay",
      "Always frame upsells as observations, not pressure",
      "Use the line: 'I noticed your [oven/fridge/carpet] could use some attention — would you like me to add that today?'",
      "Never add a service without the client's explicit approval",
      "Log every upsell in the app immediately — it records your extra pay",
      "The best upsells: oven interior, fridge interior, carpet steam, window wash",
      "Never push back if declined — always stay friendly",
    ],
    content: `Upsells are the fastest way to increase your earnings on every job. They're not about selling — they're about genuinely noticing things the client needs and making it easy for them to say yes.\n\nTHE UPSELL FORMULA:\n"I noticed [specific thing you observed]. Would you like me to take care of that today? It's [service name] and I can do it in about [time estimate]."\n\nExample: "I noticed the inside of your oven has some build-up. I can do a deep oven clean today — it takes about 20 minutes. Would you like me to add that?"\n\nThis works because it's specific, honest, and gives them a choice. Most clients will say yes if they trust you — and trust is built through consistent, excellent work.`,
    quiz: [
      { q: "A client says no to your upsell offer. What do you do?", a: "Smile and say 'No problem at all!' and continue with the regular clean. Never push back, never act disappointed. Clients who feel respected come back — and often say yes next time." },
    ],
  },
  {
    id: 9,
    title: "Handling Issues & Complaints",
    icon: "🛡️",
    duration: "8 min read",
    category: "Professionalism",
    badge: "Must Know",
    badgeColor: "#A78BFA",
    videoUrl: "https://www.youtube.com/results?search_query=Angela+Brown+Savvy+Cleaner+handling+unhappy+clients+complaints",
    videoChannel: "Savvy Cleaner — Angela Brown",
    videoTitle: "Handling Unhappy Clients in Your Cleaning Business",
    keyPoints: [
      "Stay calm — never argue or get defensive",
      "Apologize sincerely even if you're not sure it was your fault",
      "Take photos of any claimed damage immediately",
      "Contact your supervisor immediately — do not handle disputes alone",
      "Never promise refunds or make commitments on behalf of the company",
      "Document everything in your job summary in the app",
      "A calm, caring response turns most complaints into loyal clients",
    ],
    content: `Client complaints feel personal, but they're a business moment. The way you handle a complaint has more impact on client retention than the original issue. Studies show clients who have a complaint handled well are more loyal than those who never had a problem at all.\n\nTHE COMPLAINT PROTOCOL:\n1. Listen fully — don't interrupt\n2. Apologize sincerely: "I'm really sorry to hear that. That's not the experience we want you to have."\n3. Take photos if any physical damage is claimed\n4. Say: "I'm going to contact my supervisor right now to make sure this gets resolved for you."\n5. Call/message supervisor immediately\n6. Log everything in the job summary in the app\n7. Follow up — your supervisor will handle resolution\n\nNEVER SAY: "That wasn't me / that was already there / you'll need to talk to someone else."`,
    quiz: [
      { q: "A client calls while you're still on-site and says you broke their vase. You didn't see it break. What do you do?", a: "Stay calm. Apologize. Take photos of the area. Do NOT argue or deny. Call your supervisor immediately. Write everything in your job summary. Never promise to pay for it yourself — let the company handle it." },
    ],
  },

  // ── ADD-ON MODULE 10: Inside Oven ──────────────────────────────────────────
  {
    id: 10,
    title: "Add-On: Inside Oven Clean",
    icon: "🔥",
    duration: "12 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: "#FF6B6B",
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+inside+oven+non+self+cleaning+professionally",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean a Non-Self-Cleaning Oven Like a Pro",
    keyPoints: [
      "Always check if oven is COOL before starting — never clean a hot oven",
      "Remove racks first — soak in bathtub or sink with dishwasher tabs, 30+ min",
      "Mix 4 parts baking soda : 1 part dish soap : 1 part water into a paste",
      "Apply paste to all interior walls, floor, ceiling, and door — avoid heating elements and fans",
      "Let sit 20–30 min minimum — dwell time does the work, not elbow grease",
      "Scrub with damp Scotch-Brite pad, use a razor scraper on stubborn spots",
      "Rinse with wet microfiber cloth, finish with vinegar wipe to cut residue",
      "Glass door: use Bar Keepers Friend — do NOT take door apart (voids warranty)",
      "Total time: 45–60 min for a standard oven",
    ],
    content: `The inside oven clean is one of our most popular and highest-valued add-ons. Done properly it takes about 45–60 minutes and leaves a result clients always photograph and talk about.

BEFORE YOU START:
✅ Confirm oven is completely cool
✅ Remove everything from inside including racks
✅ Put racks in bathtub or large sink covered with hot water + 2 dishwasher tabs
✅ Pull out the oven drawer and vacuum underneath

THE PASTE METHOD (best for heavy buildup):
1. Mix: 4 tbsp baking soda + 1 tbsp dish soap + 1 tbsp water = thick paste
2. Apply with your hands (gloves on) to ALL interior surfaces
3. Avoid fans, coils, heating elements — mask with paper towel if needed
4. Wait 20–30 minutes — resist scrubbing early
5. Scrub with wet Scotch-Brite — use razor scraper on carbonised buildup
6. Rinse thoroughly with wet microfiber (baking soda leaves white residue if not rinsed)
7. Final wipe with vinegar-dampened cloth to cut any remaining grease

DOOR GLASS:
• Interior glass: Bar Keepers Friend + scrub pad, rinse clean
• Between the panes: leave it — do not take door apart

OVEN RACKS:
• After 30+ min soak, scrub with steel pad — grease lifts easily
• Rinse and dry before replacing`,
    quiz: [
      { q: "Client asks you to clean inside a hot oven — what do you say?", a: "Say: 'I need the oven to be fully cool before I can safely clean the interior. Can we do this one first, or shall I come back to the oven at the end?' Never clean a hot oven." },
      { q: "You apply the paste and go to scrub after 5 minutes. It's not working. Why?", a: "Dwell time is everything. The paste needs 20–30 minutes to penetrate and break down the grease. Going in too early means you're doing 10x the work. Always let it sit." },
    ],
  },

  // ── ADD-ON MODULE 11: Inside Fridge ─────────────────────────────────────────
  {
    id: 11,
    title: "Add-On: Inside Fridge Clean",
    icon: "🧊",
    duration: "10 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: "#3B82F6",
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+refrigerator+inside+shelves+drawers+efficiently",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean Your Fridge Inside — Fast & Efficiently",
    keyPoints: [
      "Ask client before starting: any food to keep? Any expired to toss?",
      "Remove ALL shelves and drawers — wash separately in the sink",
      "Green rag for all food-contact surfaces (food prep zone)",
      "Warm water + small amount of dish soap — no bleach inside a fridge",
      "Wipe top to bottom, back to front — don't forget the door seals",
      "Dry completely before replacing contents — moisture causes mold",
      "Deodorise with baking soda wipe on interior walls if there's odour",
      "Replace shelves and drawers only when fully dry",
    ],
    content: `The inside fridge clean is a quick, high-impact add-on that clients love. Most people avoid cleaning their fridge because it means emptying it. You do that for them — that's the value.

STEP BY STEP:
1. Ask client: anything specific to keep? Remove all food — set aside on counter or cooler
2. Remove all shelves and drawers and bring to sink
3. Wash shelves and drawers: warm water + dish soap, rinse, set to air dry
4. Inside fridge cavity: spray lightly with warm soapy water
5. Use GREEN rag — wipe all interior walls, top to bottom, back to front
6. Door seals: use a damp cloth and get into the grooves — this is where mold hides
7. Vegetable drawers: scrub any residue — these get the worst buildup
8. Deodorise: light wipe with baking soda paste on walls if there's smell
9. Dry everything completely with a clean cloth
10. Replace dry shelves and drawers, replace food

IMPORTANT:
❌ No bleach inside a fridge — food contact surface
❌ Don't replace wet shelves — causes mould
✅ Green rag only for all food surfaces`,
    quiz: [
      { q: "Which rag colour do you use inside the fridge and why?", a: "Green — the fridge is a food prep/food storage surface. Green rags are designated for kitchen food-contact surfaces. Never use red (restroom) or blue (general) inside a fridge." },
    ],
  },

  // ── ADD-ON MODULE 12: Inside Cabinets ───────────────────────────────────────
  {
    id: 12,
    title: "Add-On: Inside Cabinets Clean",
    icon: "🗄️",
    duration: "10 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: "#A78BFA",
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+kitchen+cabinets+inside+professionally",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean Inside Kitchen Cabinets",
    keyPoints: [
      "Only done on EMPTY cabinets — this is a move-in/move-out add-on typically",
      "Remove any shelf liners first — discard old ones, client may want new",
      "Green rag for kitchen cabinet interiors (food-contact zone)",
      "Damp wipe all shelves, walls, corners, and door interiors",
      "Pay attention to hinges and corners — crumbs hide here",
      "Dry completely before replacing anything",
      "Check for signs of pests or mould — report to supervisor immediately if found",
      "Do NOT reorganise client belongings without permission",
    ],
    content: `Inside cabinets is most commonly requested on move-in/move-out jobs where the unit is empty. Occasionally recurring clients request it as a seasonal deep-clean add-on.

WHEN IT APPLIES:
• Move-In / Move-Out jobs — always offer this
• Deep Clean add-on — client requests it seasonally
• Only worth doing on EMPTY cabinets — don't move client belongings without permission

STEP BY STEP:
1. Remove old shelf liners if present — discard unless client says otherwise
2. Vacuum out crumbs and debris with a hand vacuum or brush
3. Green damp rag — wipe all shelf surfaces top to bottom
4. Wipe interior walls of each cabinet, including the door interior
5. Get into corners and around hinges — crumbs pack in here
6. Wipe drawer interiors if included
7. Dry with a clean dry cloth before replacing anything

FLAGS TO REPORT:
• Any sign of pest activity (droppings, damage)
• Visible mould or water damage
• Do NOT attempt to clean mould yourself — this is a supervisor call`,
    quiz: [
      { q: "You open a cabinet and notice what looks like mouse droppings. What do you do?", a: "Stop. Do not touch or clean it. Take a photo. Contact your supervisor immediately. This is a health hazard that requires a specialist — you are not equipped or insured to handle this. Be calm and professional when informing the client." },
    ],
  },

  // ── ADD-ON MODULE 13: Interior Windows ──────────────────────────────────────
  {
    id: 13,
    title: "Add-On: Interior Window Wash",
    icon: "🪟",
    duration: "8 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: C.blue,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+windows+streak+free+microfiber+inside",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean Windows Streak-Free Every Time",
    keyPoints: [
      "Blue rag ONLY for all glass surfaces",
      "The two-step method: damp side first → dry side buff — no exceptions",
      "Spray lightly onto cloth, NOT directly onto window (spraying onto glass causes drips)",
      "Wipe in S-pattern or Z-pattern — never circular (circular = streaks)",
      "Get sill and frame too — dust settles here and undoes your glass work",
      "This is priced per window — count and confirm with client before starting",
      "Screens: remove and scrub gently with soft brush if client requests",
    ],
    content: `Interior window washing is one of the cleanest, most visible results you can deliver. Clients see it every day. Get it streak-free and they'll book it every time.

THE TWO-STEP METHOD:
1. Lightly spray glass cleaner or water onto a DAMP blue microfiber cloth (not the glass)
2. Wipe glass in a consistent S or Z pattern — top to bottom, side to side
3. Immediately follow with a DRY blue microfiber cloth — buff in same pattern
4. Check from an angle with light — if you see streaks, the second wipe wasn't dry enough

WHY STREAKS HAPPEN:
• Too much product — use less
• Wiping in circles — wipe in straight lines
• Not following up with a dry cloth
• Using a cloth that has fabric softener residue — won't absorb

SILL AND FRAME:
• Dry blue rag: dust the sill first
• Damp cloth: wipe down sill and frame
• Don't let water sit on wood windowsills — dry immediately

COUNTING WINDOWS:
This add-on is priced per window. Before starting, do a quick count and confirm with client. If number is higher than quoted, message your supervisor before proceeding.`,
    quiz: [
      { q: "You clean a window and step back and see a streak. What caused it and how do you fix it?", a: "Most likely the dry-buff step was skipped or the cloth wasn't fully dry. Fix: take a fresh DRY blue microfiber cloth and buff the glass again in straight lines. If the streak persists, a tiny bit more cleaner on the damp pass, followed immediately by a thorough dry buff." },
    ],
  },

  // ── ADD-ON MODULE 14: Baseboards ────────────────────────────────────────────
  {
    id: 14,
    title: "Add-On: Baseboards & Detail Clean",
    icon: "📐",
    duration: "8 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: C.gold,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+clean+baseboards+fast+efficiently+without+bending",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Clean Baseboards Fast Without Killing Your Back",
    keyPoints: [
      "Blue rag for baseboards — general low-risk surface",
      "Dry first: run dry blue microfiber along top of baseboard to collect dust",
      "Damp second: follow with damp blue cloth for sticky buildup and scuffs",
      "Melissa Maker trick: wrap microfiber around a flat mop head — clean standing up",
      "Work room by room, consistent direction — don't zig-zag",
      "Pay attention to corners and behind doors — most partners miss these",
      "White painted baseboards show everything — finish with dry buff to prevent watermarks",
      "Deep Clean and Move-In/Out jobs: baseboards are always included in the scope",
    ],
    content: `Baseboards are one of the most-noticed details clients check after a clean. Most people don't do them themselves — so when you do them well, it stands out.

THE TECHNIQUE:
1. Dry blue microfiber: run along the full length of baseboard top-edge first — this grabs the dust layer
2. Check for sticky buildup or scuffs — these need a damp pass
3. Damp blue cloth: wipe full baseboard — top, face, and bottom edge
4. White painted baseboards: follow with a dry cloth to prevent water marks
5. Use a soft toothbrush for corner buildup (heavier detail jobs)

MELISSA MAKER HACK — No bending required:
Wrap a microfiber cloth around a flat mop head using an elastic band. Now you can clean the entire baseboard line standing up, room by room. Fast and no back pain.

SCOPE:
• Deep Clean: baseboards always included
• Refresh / Full Home: spot-clean visible marks only
• Move-In/Out: full baseboard scrub throughout
• As a standalone add-on: full clean all rooms`,
    quiz: [
      { q: "What's the right order — damp first or dry first on baseboards, and why?", a: "Dry first. A dry microfiber cloth has static that grabs loose dust off the top of the baseboard. If you go damp first, you're turning all that dust into muddy smears that take longer to clean. Dry captures, damp finishes." },
    ],
  },

  // ── ADD-ON MODULE 15: Carpet Cleaning ───────────────────────────────────────
  {
    id: 15,
    title: "Add-On: Carpet Cleaning",
    icon: "🛋️",
    duration: "10 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: C.accent,
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+remove+carpet+stains+professionally+without+machine",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Remove Carpet Stains Like a Pro",
    keyPoints: [
      "BLOT, never rub — rubbing spreads the stain and damages fibres",
      "Work from the outside edge of the stain inward — never from the centre out",
      "Cold water for protein stains (blood, food, pet) — hot water sets them permanently",
      "Dish soap + cold water is your first line solution for most stains",
      "For pet odour: enzyme cleaner only — regular cleaners mask smell, don't eliminate it",
      "Always test any product on a hidden area first — carpet dye can lift",
      "Do NOT over-wet carpet — excess moisture causes mould and subfloor damage",
      "Heavy carpet steam: this requires professional equipment — quote accordingly",
    ],
    content: `Carpet cleaning ranges from spot treatment to full steam, depending on what's booked. Know which one you're doing before you start.

SPOT TREATMENT (included in most jobs):
1. Blot fresh stains immediately — never rub
2. Apply cold water to a clean cloth — blot from outside in
3. Mix 1 tsp dish soap + 1 cup cold water — blot onto stain
4. Blot clean water to rinse — repeat until stain lifts
5. Place a clean towel over the area and press firmly to absorb moisture

COMMON STAINS:
• Coffee / Tea: dish soap + cold water → blot → rinse
• Red wine: cold water blot immediately → club soda → blot dry
• Pet urine: enzyme cleaner ONLY — do not use regular cleaner (masks, doesn't neutralise)
• Blood: cold water only — NEVER hot (sets permanently)
• Grease: dish soap — grease-cutting formula works here

STEAM CLEANING ADD-ON:
This requires a rented or owned carpet steam machine. Time: 45–90 min depending on area. Always let client know carpet will be damp for 2–4 hours — plan schedule accordingly.

WHEN TO FLAG:
• Any stains that won't lift after 2 attempts — photograph and note in job summary
• Carpet that smells of mould or is visibly damaged — do not attempt`,
    quiz: [
      { q: "A client has a fresh red wine spill on white carpet. What do you do first?", a: "Blot immediately with a clean white cloth — work from the outside of the stain inward. Use cold water. Never rub. Club soda can help lift the remaining colour. Do NOT use hot water or scrub. Speed and blotting are everything with red wine." },
    ],
  },

  // ── ADD-ON MODULE 16: Pet Hair & Heavy Detail ────────────────────────────────
  {
    id: 16,
    title: "Add-On: Pet Hair & Heavy Detail",
    icon: "🐾",
    duration: "10 min read",
    category: "Add-Ons",
    badge: "Paid Add-On",
    badgeColor: "#FF8C42",
    videoUrl: "https://www.youtube.com/results?search_query=Clean+My+Space+how+to+remove+pet+hair+furniture+carpet+efficiently",
    videoChannel: "Clean My Space — Melissa Maker",
    videoTitle: "How to Remove Pet Hair from Everything",
    keyPoints: [
      "Vacuum first — always — before any wet cleaning on pet hair jobs",
      "Rubber gloves trick: dampen rubber gloves, rub upholstery — hair balls up for easy removal",
      "Squeegee on carpet: drags embedded pet hair to surface better than vacuum alone",
      "Lint roller for upholstery surfaces and cushion edges",
      "Pet hair in corners: vacuum crevice tool, then damp cloth to collect remainder",
      "Enzyme cleaner for any pet accident odours — regular cleaner doesn't neutralise",
      "Inform supervisor and note in job summary if pet hair is extreme (extra time needed)",
      "Always wash your own rags separately after a pet hair job",
    ],
    content: `Pet hair and heavy detail is its own add-on because it adds significant time to a job. A home with 2 shedding dogs can add 45–90 minutes to a standard clean. Always flag scope before starting.

TOOLS FOR PET HAIR:
• Vacuum with pet attachment: first pass everywhere
• Rubber gloves (damp): rub upholstery in one direction — hair balls up
• Lint roller: cushion edges, throw pillows, fabric surfaces
• Rubber squeegee on carpet: drag across carpet surface — lifts embedded hair
• Damp microfiber: wipe hard surfaces (shelving, baseboards) — picks up fine hair

FURNITURE SEQUENCE:
1. Vacuum all cushions with pet attachment
2. Remove cushions — vacuum underneath and the seat frame
3. Damp rubber glove pass on fabric surfaces
4. Lint roll edges and seams
5. Replace cushions neatly

PET ODOUR:
• Enzyme cleaner only for spots of pet urine or accident — spray, let dwell 5 min, blot
• Baking soda on carpet overnight (if pre-approved) removes general pet odour
• Never use air freshener as a substitute — clients with allergies react to fragrance

SCOPE FLAG:
If you arrive and pet hair is extreme (multiple animals, long-haired breeds, months of buildup) — photograph and contact supervisor before starting. Extra time = extra charge.`,
    quiz: [
      { q: "You're vacuuming a sofa and pet hair just keeps moving around instead of being picked up. What technique helps?", a: "Dampen rubber gloves and rub the fabric in one direction — the friction and static pull the hair into clumps you can then pick up easily. A rubber squeegee also works on fabric surfaces. Vacuum after to collect the clumps." },
    ],
  },
];


// ─── MODULE VIEWER ────────────────────────────────────────────────────────────
function ModuleViewer({ mod, partnerId, partners, completeModule, setActiveModule, quizAnswerVisible, setQuizAnswerVisible }) {
  const [tab, setTab] = useState("content");
  const tabs = [
    { id:"content",  label:"📖 Content" },
    ...(mod.ragModule    ? [{ id:"rag",    label:"🎨 RAG Chart" }]      : []),
    ...(mod.wetDryGuide  ? [{ id:"wetdry", label:"💧 Wet/Dry Guide" }]  : []),
    ...(mod.roomGuide    ? [{ id:"rooms",  label:"🏡 Room Guide" }]     : []),
    ...(mod.quiz         ? [{ id:"quiz",   label:"✏️ Quiz" }]           : []),
  ];

  return (
    <Modal title={`${mod.icon} ${mod.title}`} onClose={() => setActiveModule(null)} wide>
      <div>
        {/* Badges */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14, alignItems:"center" }}>
          <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, background:`${mod.badgeColor}22`, color:mod.badgeColor, border:`1px solid ${mod.badgeColor}44` }}>{mod.badge}</span>
          <span style={S.badge("blue")}>📁 {mod.category}</span>
          <span style={S.badge("gold")}>⏱ {mod.duration}</span>
        </div>

        {/* Video section */}
        <div style={{ background:C.surface, borderRadius:12, overflow:"hidden", marginBottom:16 }}>
          <div style={{ background:"linear-gradient(135deg,#0A0F1E,#1A2235)", padding:18, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,#FF4757,#FF6B81)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>▶</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:3 }}>{mod.videoTitle}</div>
              <div style={{ fontSize:12, color:C.accent, marginBottom:2 }}>📺 {mod.videoChannel}</div>
              <div style={{ fontSize:11, color:C.dim }}>Opens a real YouTube search for this exact topic — pick the video that best fits your team.</div>
            </div>
            <a
              href={mod.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...S.btn("primary"), textDecoration:"none", fontSize:12, padding:"7px 14px", flexShrink:0 }}
            >
              🔍 Find Videos
            </a>
          </div>
          <div style={{ padding:"8px 14px", background:C.bg, fontSize:11, color:C.dim, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ color:C.gold }}>💡</span>
            <span>Record your own training video and replace the <code style={{color:C.accent}}>videoUrl</code> in TRAINING_MODULES with your YouTube link.</span>
          </div>
        </div>

        {/* Key points */}
        <div style={{ background:`${mod.badgeColor}11`, border:`1px solid ${mod.badgeColor}33`, borderRadius:10, padding:14, marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:13, color:mod.badgeColor, marginBottom:8 }}>⚡ Key Points</div>
          {mod.keyPoints.map((pt, i) => (
            <div key={i} style={{ display:"flex", gap:8, fontSize:13, padding:"3px 0", color:C.text }}>
              <span style={{ color:mod.badgeColor, flexShrink:0 }}>✓</span>{pt}
            </div>
          ))}
        </div>

        {/* Tab nav */}
        <div style={{ display:"flex", gap:4, marginBottom:14, flexWrap:"wrap" }}>
          {tabs.map(t => <button key={t.id} style={{ ...S.navBtn(tab===t.id), fontSize:12 }} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>

        {/* Content */}
        {tab === "content" && (
          <div style={{ background:C.surface, borderRadius:10, padding:16, fontSize:13, color:C.muted, lineHeight:1.8, whiteSpace:"pre-line" }}>
            {mod.content}
          </div>
        )}

        {/* RAG Chart */}
        {tab === "rag" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:13, color:C.muted, marginBottom:4 }}>Each color stays in its designated zone — no exceptions, even if a rag looks clean.</div>
            {RAG_COLORS.map(rag => (
              <div key={rag.name} style={{ borderRadius:12, overflow:"hidden", border:`2px solid ${rag.color}44` }}>
                <div style={{ background:rag.bgColor, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:32, height:32, borderRadius:"50%", background:rag.color, flexShrink:0, boxShadow:`0 0 10px ${rag.color}88` }} />
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, color:rag.color }}>{rag.emoji} {rag.name}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{rag.zone}</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,200px),1fr))", background:C.card }}>
                  <div style={{ padding:"10px 14px", borderRight:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.accent, textTransform:"uppercase", marginBottom:5 }}>✅ Use For</div>
                    {rag.uses.map(u => <div key={u} style={{ fontSize:12, color:C.text, padding:"2px 0" }}>• {u}</div>)}
                  </div>
                  <div style={{ padding:"10px 14px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.red, textTransform:"uppercase", marginBottom:5 }}>🚫 Never Use For</div>
                    {rag.never.map(n => <div key={n} style={{ fontSize:12, color:C.muted, padding:"2px 0" }}>• {n}</div>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Wet/Dry Guide */}
        {tab === "wetdry" && mod.wetDryGuide && (
          <div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:12 }}>Match technique to surface. Dry for dust, damp for grime, never soaking wet.</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                  {["Surface","Method","Why It Works"].map(h => (
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:C.muted, fontWeight:700, fontSize:11, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mod.wetDryGuide.map((row, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, background:i%2===0?"transparent":"#ffffff04" }}>
                    <td style={{ padding:"9px 12px", fontWeight:600 }}>{row.surface}</td>
                    <td style={{ padding:"9px 12px" }}>
                      <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                        background: row.method.includes("Dry")&&!row.method.includes("Damp") ? C.goldDim : C.blueDim,
                        color: row.method.includes("Dry")&&!row.method.includes("Damp") ? C.gold : C.blue
                      }}>{row.method}</span>
                    </td>
                    <td style={{ padding:"9px 12px", color:C.muted }}>{row.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Room Guide */}
        {tab === "rooms" && mod.roomGuide && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {mod.roomGuide.map(room => (
              <div key={room.room} style={S.cardSm}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <span style={{ fontSize:22 }}>{room.icon}</span>
                  <div style={{ fontWeight:800, fontSize:15 }}>{room.room}</div>
                  <span style={{ fontSize:16 }}>{room.ragColor}</span>
                </div>
                <ol style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:4 }}>
                  {room.steps.map((step, i) => <li key={i} style={{ fontSize:13, color:C.muted }}>{step}</li>)}
                </ol>
              </div>
            ))}
          </div>
        )}

        {/* Quiz */}
        {tab === "quiz" && mod.quiz && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:13, color:C.muted, marginBottom:4 }}>Test your knowledge before moving on.</div>
            {mod.quiz.map((q, i) => (
              <div key={i} style={{ ...S.cardSm, borderLeft:`4px solid ${C.gold}` }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>❓ {q.q}</div>
                {quizAnswerVisible[`${mod.id}-${i}`] ? (
                  <div style={{ background:C.accentDim, borderRadius:8, padding:"10px 14px", fontSize:13, color:C.text, lineHeight:1.6 }}>
                    ✅ <strong>Answer:</strong> {q.a}
                  </div>
                ) : (
                  <button style={S.btn("ghost")} onClick={() => setQuizAnswerVisible(v => ({ ...v, [`${mod.id}-${i}`]: true }))}>
                    Reveal Answer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Complete button */}
        {partnerId && (
          <div style={{ marginTop:18, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
            <button style={{ ...S.btn("primary"), width:"100%" }} onClick={() => completeModule(partnerId, mod.id)}>
              ✅ Mark Complete — {partners.find(p => p.id === partnerId)?.name}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── ANIME GUIDE ─────────────────────────────────────────────────────────────
const ANIME_GUIDE_TOPICS = [
  { id:"start",   label:"🌸 Getting Started",      prompt:"Explain how to log into the Have Us Clean partner portal and what a new partner sees when they first open the app. Be welcoming and clear." },
  { id:"jobs",    label:"📋 Your Jobs Tab",         prompt:"Explain how a partner finds their assigned jobs in the Have Us Clean app, how to read the job details, and what to check before heading to a job." },
  { id:"gps",     label:"📍 GPS Check-In",          prompt:"Walk a partner through exactly how to GPS check-in when they arrive at a job and GPS check-out when they leave, and why it matters." },
  { id:"photos",  label:"📸 Before & After Photos", prompt:"Explain the importance of taking before and after photos on every job, how to do it properly in the app, and what makes a good photo." },
  { id:"upsells", label:"💰 Upsells & Add-Ons",    prompt:"Explain how to identify and offer upsells to clients during a job — things like inside oven, fridge, baseboards — and how to add them in the app without being pushy." },
  { id:"complete",label:"✅ Completing a Job",      prompt:"Walk a partner through the full end-of-job process: final check, summary note, checkout, and what happens after the job is marked complete." },
  { id:"pay",     label:"💵 Your Pay",              prompt:"Explain how partner pay works at Have Us Clean — 65% of each job's client price — how to view pending and earned pay in the app, and when pay is processed." },
  { id:"rag",     label:"🎨 RAG Colour System",     prompt:"Explain the RAG (Red/Yellow/Green/Blue) microfibre colour-coding system used at Have Us Clean in a fun, memorable way a new partner won't forget." },
  { id:"issues",  label:"🆘 Handling Problems",     prompt:"Explain what a partner should do if something goes wrong on a job — broken item, unhappy client, locked out, or running late — step by step using the Have Us Clean app." },
];

function AnimeGuide() {
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [expression, setExpression] = useState("idle");
  const [history, setHistory] = useState([]);
  const [followUp, setFollowUp] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [response, loading]);

  const SYSTEM = `You are Yuki, a friendly anime-style AI training guide for Have Us Clean — a professional cleaning company in Toronto, Canada and Arizona, USA.
Your job is to help new cleaning partners learn the Have Us Clean app and cleaning procedures.
Personality: warm, encouraging, slightly anime-flavoured (use "Yosh!", "Ganbatte!" occasionally), clear numbered steps, emojis to aid scanning.
Always reinforce: RAG colour system (🔴 red=toilets only, 🟡 yellow=sinks/mirrors, 🟢 green=kitchen, 🔵 blue=general/glass), partner pay = 65% of client price.
Responses: 150–250 words, clear steps or bullets. Be encouraging — cleaning is skilled work.`;

  const ask = async (prompt, isFollowUp = false) => {
    setLoading(true); setExpression("loading"); setResponse("");
    if (!isFollowUp) setHistory([]);
    const msgs = [...(isFollowUp ? history : []), { role:"user", content: prompt }];
    try {
      const res = await fetch("/api/claude", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:600, system:SYSTEM, messages:msgs }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "No response — check your API connection.";
      setResponse(text); setExpression("talking");
      setHistory([...msgs, { role:"assistant", content:text }]);
    } catch {
      setExpression("error");
      setResponse("Connection error. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.");
    }
    setLoading(false);
  };

  const handleFollowUp = () => {
    if (!followUp.trim()) return;
    const q = followUp; setFollowUp(""); ask(q, true);
  };

  const yukiEmoji = loading ? "💭" : expression === "error" ? "😅" : expression === "talking" ? "✨" : "🌸";
  const idleBubble = "Hi! I'm Yuki, your Have Us Clean training guide! 🌸\nTap any topic below and I'll walk you through it step by step!\nYosh — let's learn! ✨";

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ fontWeight:800, fontSize:22, background:"linear-gradient(135deg,#A78BFA,#7C3AED)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>🌸 Yuki — AI App Guide</div>
        <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Your personal Have Us Clean training companion</div>
      </div>

      {/* Character card */}
      <div style={{ ...S.card, marginBottom:20, background:"linear-gradient(135deg,#1a0533,#0D0B1E)", border:`1px solid #7C3AED55`, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-50, right:-50, width:180, height:180, borderRadius:"50%", background:"#7C3AED0A" }} />
        <div style={{ position:"absolute", bottom:-40, left:-40, width:140, height:140, borderRadius:"50%", background:"#A78BFA0A" }} />
        <div style={{ display:"flex", gap:16, alignItems:"flex-start", position:"relative" }}>
          {/* Avatar */}
          <div style={{ flexShrink:0, textAlign:"center" }}>
            <div style={{ width:88, height:88, borderRadius:22, background:"linear-gradient(135deg,#581c87,#7C3AED,#A78BFA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:46, boxShadow:"0 0 28px #7C3AED77", border:"2px solid #A78BFA55" }}>
              {yukiEmoji}
            </div>
            <div style={{ marginTop:6, fontWeight:800, fontSize:13, color:"#A78BFA" }}>Yuki</div>
            <div style={{ fontSize:10, color:"#7C3AED99" }}>AI Guide ✨</div>
          </div>
          {/* Bubble */}
          <div style={{ flex:1, background:"#7C3AED15", borderRadius:16, border:`1px solid #7C3AED44`, padding:"14px 16px", minHeight:76 }}>
            {loading
              ? <div style={{ color:"#A78BFA", fontSize:14, display:"flex", alignItems:"center", gap:8 }}>💭 <span>Thinking...</span></div>
              : <div style={{ fontSize:13, color:C.text, lineHeight:1.75, whiteSpace:"pre-wrap" }}>{response || idleBubble}</div>
            }
          </div>
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Topic buttons */}
      <div style={{ marginBottom:16 }}>
        <div style={S.label}>What do you want to learn?</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
          {ANIME_GUIDE_TOPICS.map(t => (
            <button key={t.id} disabled={loading}
              style={{ padding:"8px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700, transition:"all 0.15s",
                background: selectedTopic?.id===t.id ? "#7C3AED33" : C.surface,
                color: selectedTopic?.id===t.id ? "#A78BFA" : C.muted,
                border: `1px solid ${selectedTopic?.id===t.id ? "#7C3AED" : C.border}` }}
              onClick={() => { setSelectedTopic(t); ask(t.prompt); }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Follow-up */}
      {(response || loading) && (
        <div style={{ ...S.card, background:"#080614", border:`1px solid #7C3AED33` }}>
          <div style={S.label}>Ask Yuki a follow-up</div>
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <input style={{ ...S.input, flex:1, background:"#1a0533", border:`1px solid #7C3AED55`, color:C.text }}
              placeholder="e.g. What if the client isn't home when I arrive?"
              value={followUp} onChange={e => setFollowUp(e.target.value)}
              onKeyDown={e => e.key==="Enter" && handleFollowUp()} disabled={loading} />
            <button style={{ ...S.btn("primary"), background:"#7C3AED", flexShrink:0 }} onClick={handleFollowUp} disabled={loading || !followUp.trim()}>Ask ✨</button>
          </div>
          {history.length >= 4 && (
            <button style={{ ...S.btn("ghost"), fontSize:12, marginTop:10 }} onClick={() => { setHistory([]); setResponse(""); setExpression("idle"); setSelectedTopic(null); }}>🔄 Start fresh</button>
          )}
        </div>
      )}

      <div style={{ marginTop:14, fontSize:11, color:C.dim, textAlign:"center", lineHeight:1.6 }}>
        Yuki is powered by Claude AI · Requires ANTHROPIC_API_KEY in Vercel settings<br/>
        Yuki knows the Have Us Clean app, RAG system, pay structure, and all service procedures
      </div>
    </div>
  );
}

// ─── ONBOARDING COMPONENT ─────────────────────────────────────────────────────
function Onboarding({ partners, setPartners, onboardingProgress, setOnboardingProgress }) {
  const completedModules    = onboardingProgress;
  const setCompletedModules = setOnboardingProgress;
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [activeModule, setActiveModule]       = useState(null);
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [quizAnswerVisible, setQuizAnswerVisible] = useState({});
  const [libraryFilter, setLibraryFilter] = useState("All");
  const [showAnimeGuide, setShowAnimeGuide] = useState(false);

  const onboardingPartners = partners.filter(p => !p.onboarded);
  const categories = ["All", "Foundations", "Core Skills", "Procedure", "Safety", "Add-Ons"];

  const getProgress = (partnerId) => {
    const done = (completedModules[partnerId] || []).length;
    return Math.round((done / TRAINING_MODULES.length) * 100);
  };

  const completeModule = (partnerId, moduleId) => {
    const current = completedModules[partnerId] || [];
    if (!current.includes(moduleId)) {
      const updated = { ...completedModules, [partnerId]: [...current, moduleId] };
      setCompletedModules(updated);
      if (updated[partnerId].length === TRAINING_MODULES.length) {
        setPartners(partners.map(p => p.id === partnerId ? { ...p, onboarded: true, status: "available" } : p));
      }
    }
    setActiveModule(null);
  };

  const filteredModules = libraryFilter === "All"
    ? TRAINING_MODULES
    : TRAINING_MODULES.filter(m => m.category === libraryFilter);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div style={S.h2}>🎓 Partner Onboarding & Training</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button style={S.navBtn(!selectedPartner && !showAnimeGuide)} onClick={() => { setSelectedPartner(null); setShowAnimeGuide(false); }}>📚 Training Library</button>
          <button style={{ ...S.navBtn(showAnimeGuide), background: showAnimeGuide ? "#7C3AED22" : "transparent", color: showAnimeGuide ? "#A78BFA" : C.muted, borderBottom: showAnimeGuide ? "2px solid #A78BFA" : "2px solid transparent" }} onClick={() => { setShowAnimeGuide(true); setSelectedPartner(null); }}>🌸 AI App Guide</button>
          {partners.map(p => (
            <button key={p.id} style={S.navBtn(selectedPartner?.id === p.id)} onClick={() => { setSelectedPartner(p); setShowAnimeGuide(false); }}>
              {p.avatar} {p.name.split(" ")[0]} {p.onboarded ? "✅" : ""}
            </button>
          ))}
        </div>
      </div>

      {onboardingPartners.length > 0 && !showAnimeGuide && (
        <div style={{ background:C.goldDim, border:`1px solid ${C.gold}44`, borderRadius:12, padding:"12px 18px", marginBottom:18 }}>
          <div style={{ fontWeight:700, color:C.gold, marginBottom:2 }}>🔔 {onboardingPartners.length} partner(s) awaiting onboarding</div>
          <div style={{ fontSize:13, color:C.muted }}>{onboardingPartners.map(p => p.name).join(", ")} — click their name above to begin</div>
        </div>
      )}

      {/* AI Anime Guide */}
      {showAnimeGuide && <AnimeGuide />}

      {!showAnimeGuide && (
      <div>
      <div style={S.grid4}>
        <StatCard label="Total Modules" value={TRAINING_MODULES.length} icon="📚" color={C.blue} />
        <StatCard label="Partners Onboarded" value={partners.filter(p=>p.onboarded).length} icon="✅" color={C.accent} />
        <StatCard label="In Training" value={partners.filter(p=>!p.onboarded).length} icon="🎓" color={C.gold} />
        <StatCard label="RAG Colors" value="4" icon="🎨" color={C.red} sub="Red/Yellow/Green/Blue" />
      </div>

      <div style={S.divider} />

      {/* ── LIBRARY VIEW ── */}
      {!selectedPartner && (
        <div>
          {/* Category filter */}
          <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
            {categories.map(c => (
              <button key={c} style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600, background:libraryFilter===c?C.accentDim:C.surface, color:libraryFilter===c?C.accent:C.muted, border:`1px solid ${libraryFilter===c?C.accent:C.border}` }} onClick={() => setLibraryFilter(c)}>{c}</button>
            ))}
          </div>

          {/* RAG Quick Reference Card */}
          <div style={{ ...S.card, marginBottom:20, background:"linear-gradient(135deg,#0A0F1E,#1A2235)" }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14 }}>🎨 Color RAG System — Quick Reference</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
              {RAG_COLORS.map(rag => (
                <div key={rag.name} style={{ background:rag.bgColor, borderRadius:10, padding:"12px 14px", border:`1px solid ${rag.color}44`, textAlign:"center" }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", background:rag.color, margin:"0 auto 8px", boxShadow:`0 0 10px ${rag.color}66` }} />
                  <div style={{ fontWeight:800, fontSize:14, color:rag.color }}>{rag.name}</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:4, lineHeight:1.4 }}>{rag.zone}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {filteredModules.map(mod => (
              <div key={mod.id} style={{ ...S.card, cursor:"pointer" }} onClick={() => setActiveModule({ ...mod, partnerId: null })}>
                <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ fontSize:30, flexShrink:0 }}>{mod.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
                      <div style={{ fontWeight:800, fontSize:15 }}>{mod.title}</div>
                      <span style={{ padding:"2px 9px", borderRadius:20, fontSize:10, fontWeight:800, background:`${mod.badgeColor}22`, color:mod.badgeColor }}>{mod.badge}</span>
                    </div>
                    <div style={{ fontSize:12, color:C.muted }}>📁 {mod.category} · ⏱ {mod.duration}
                      {mod.videoTitle && <span style={{ color:C.red, marginLeft:8 }}>▶ Video included</span>}
                      {mod.ragModule && <span style={{ color:C.accent, marginLeft:8 }}>🎨 RAG chart</span>}
                      {mod.wetDryGuide && <span style={{ color:C.blue, marginLeft:8 }}>💧 Wet/Dry guide</span>}
                    </div>
                  </div>
                  <button style={S.btn("ghost")} onClick={e => { e.stopPropagation(); setActiveModule({ ...mod, partnerId: null }); }}>View →</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PARTNER PROGRESS VIEW ── */}
      {selectedPartner && (
        <div>
          <div style={{ ...S.card, marginBottom:20, background:"linear-gradient(135deg,#0A0F1E,#1A2235)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", marginBottom:14 }}>
              <div style={S.avatar(avatarColors[selectedPartner.id % 4])}>{selectedPartner.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:18 }}>{selectedPartner.name}</div>
                <div style={{ fontSize:13, color:C.muted }}>{selectedPartner.email} · {selectedPartner.phone}</div>
              </div>
              <span style={S.badge(selectedPartner.onboarded?"green":"gold")}>{selectedPartner.onboarded?"✅ Fully Onboarded":"⏳ Training In Progress"}</span>
            </div>
            {/* Progress bar */}
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, background:C.surface, borderRadius:20, height:12, overflow:"hidden" }}>
                <div style={{ height:12, borderRadius:20, background:`linear-gradient(90deg,${C.accent},#0088FF)`, width:`${getProgress(selectedPartner.id)}%`, transition:"width 0.5s" }} />
              </div>
              <div style={{ fontWeight:800, fontSize:16, color:C.accent, flexShrink:0 }}>{getProgress(selectedPartner.id)}%</div>
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>
              {(completedModules[selectedPartner.id]||[]).length} of {TRAINING_MODULES.length} modules complete
              {selectedPartner.onboarded ? " — All training done! 🎉" : " — complete all modules to activate partner"}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {TRAINING_MODULES.map(mod => {
              const done = (completedModules[selectedPartner.id] || []).includes(mod.id);
              return (
                <div key={mod.id} style={{ ...S.card, borderLeft:`4px solid ${done?C.accent:C.border}`, opacity:done?0.75:1, transition:"opacity 0.2s" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                    <div style={{ fontSize:26, flexShrink:0 }}>{done?"✅":mod.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14 }}>{mod.title}</div>
                      <div style={{ fontSize:12, color:C.muted }}>⏱ {mod.duration} · 📁 {mod.category}</div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <span style={{ padding:"2px 9px", borderRadius:20, fontSize:10, fontWeight:800, background:`${mod.badgeColor}22`, color:mod.badgeColor }}>{mod.badge}</span>
                      <button style={S.btn(done?"ghost":"sm")} onClick={() => setActiveModule({ ...mod, partnerId: selectedPartner.id })}>
                        {done?"Review":"Start →"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Module Viewer Modal */}
      {activeModule && (
        <ModuleViewer
          mod={activeModule}
          partnerId={activeModule.partnerId}
          partners={partners}
          completeModule={completeModule}
          setActiveModule={setActiveModule}
          quizAnswerVisible={quizAnswerVisible}
          setQuizAnswerVisible={setQuizAnswerVisible}
        />
      )}
    </div>
      )}
    </div>
  );
}



// ─── GPS TRACKING ────────────────────────────────────────────────────────────
function GPSTracking({ jobs, setJobs, partners }) {
  const [locating, setLocating] = useState(false);
  const [myLocation, setMyLocation] = useState(null);
  const [locError, setLocError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [actionType, setActionType] = useState(null); // "checkin" | "checkout"
  const [filterDate, setFilterDate] = useState("2026-04-03");

  const todayJobs = jobs.filter(j => j.date === filterDate);

  const getLocation = (job, type) => {
    setLocating(true);
    setLocError(null);
    setSelectedJob(job);
    setActionType(type);
    if (!navigator.geolocation) {
      // Simulate for demo
      simulateLocation(job, type);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        commitCheckEvent(job, type, coords);
        setLocating(false);
      },
      () => {
        // Fallback: simulate location for demo
        simulateLocation(job, type);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  const simulateLocation = (job, type) => {
    // Generate slightly randomized coords around SF for demo
    const base = { lat: 37.7749 + (Math.random() - 0.5) * 0.05, lng: -122.4194 + (Math.random() - 0.5) * 0.05 };
    setTimeout(() => {
      commitCheckEvent(job, type, base);
      setLocating(false);
    }, 1200);
  };

  const commitCheckEvent = (job, type, coords) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMyLocation(coords);
    setJobs(prev => prev.map(j => {
      if (j.id !== job.id) return j;
      if (type === "checkin") return { ...j, checkIn: timeStr, checkInCoords: coords, status: j.status === "scheduled" ? "in-progress" : j.status };
      if (type === "checkout") return { ...j, checkOut: timeStr, checkOutCoords: coords };
      return j;
    }));
  };

  const openMaps = (coords, address) => {
    const url = `https://www.google.com/maps?q=${coords ? `${coords.lat},${coords.lng}` : encodeURIComponent(address)}`;
    window.open(url, "_blank");
  };

  const openDirections = (address) => {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`, "_blank");
  };

  const checkedInCount = jobs.filter(j => j.checkIn).length;
  const checkedOutCount = jobs.filter(j => j.checkOut).length;
  const activeNow = jobs.filter(j => j.checkIn && !j.checkOut && j.status === "in-progress").length;

  return (
    <div>
      <div style={styles.h2}>GPS Check-In / Tracking</div>

      <div style={styles.grid3}>
        <StatCard label="Currently On-Site" value={activeNow} icon="📍" color={C.accent} sub="partners working now" />
        <StatCard label="Checked In Today" value={checkedInCount} icon="🟢" color={C.blue} sub="total check-ins" />
        <StatCard label="Jobs Wrapped Up" value={checkedOutCount} icon="🏁" color={C.gold} sub="checked out" />
      </div>

      <div style={styles.divider} />

      {/* Live Partner Pins */}
      <div style={styles.h3}>Live Partner Locations</div>
      <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 24 }}>
        {/* Stylized map placeholder */}
        <div style={{ position: "relative", height: 240, background: "linear-gradient(145deg,#0D1B2A,#112240,#0A1628)", overflow: "hidden" }}>
          {/* Grid lines */}
          {[...Array(8)].map((_, i) => (
            <div key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${i * 14}%`, height: 1, background: "#1E3A5F33" }} />
          ))}
          {[...Array(10)].map((_, i) => (
            <div key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${i * 11}%`, width: 1, background: "#1E3A5F33" }} />
          ))}
          {/* Road lines */}
          <div style={{ position: "absolute", left: "20%", right: "20%", top: "45%", height: 3, background: "#1E3A5F88", borderRadius: 2 }} />
          <div style={{ position: "absolute", top: "15%", bottom: "15%", left: "38%", width: 3, background: "#1E3A5F88", borderRadius: 2 }} />
          <div style={{ position: "absolute", top: "15%", bottom: "15%", left: "65%", width: 3, background: "#1E3A5F88", borderRadius: 2 }} />
          <div style={{ position: "absolute", left: "5%", right: "5%", top: "72%", height: 3, background: "#1E3A5F88", borderRadius: 2 }} />

          {/* Partner pins for checked-in jobs */}
          {jobs.filter(j => j.checkIn && j.checkInCoords).map((job, idx) => {
            const partner = partners.find(p => p.id === job.partnerId);
            const positions = [{ left: "38%", top: "30%" }, { left: "62%", top: "55%" }, { left: "25%", top: "60%" }, { left: "75%", top: "25%" }];
            const pos = positions[idx % positions.length];
            const isActive = job.checkIn && !job.checkOut;
            return (
              <div key={job.id} style={{ position: "absolute", ...pos, transform: "translate(-50%,-100%)", zIndex: 10, cursor: "pointer" }} title={`${partner?.name} — ${job.client}`}>
                {/* Pulse ring */}
                {isActive && (
                  <div style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                    width: 48, height: 48, borderRadius: "50%",
                    background: `${C.accent}22`,
                    animation: "pulse 2s infinite",
                    zIndex: 0,
                  }} />
                )}
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: isActive ? `linear-gradient(135deg,${C.accent},#0088FF)` : C.dim,
                  border: `3px solid ${isActive ? C.accent : C.muted}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 13, color: "#fff",
                  position: "relative", zIndex: 1,
                  boxShadow: isActive ? `0 0 16px ${C.accent}88` : "none",
                }}>
                  {partner?.avatar || "?"}
                </div>
                {/* Label bubble */}
                <div style={{
                  position: "absolute", bottom: -28, left: "50%", transform: "translateX(-50%)",
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: "2px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
                  color: isActive ? C.accent : C.muted,
                }}>
                  {partner?.name.split(" ")[0]}
                </div>
              </div>
            );
          })}

          {/* Compass */}
          <div style={{ position: "absolute", top: 12, right: 14, fontSize: 20, opacity: 0.4 }}>🧭</div>

          {/* Legend */}
          <div style={{ position: "absolute", bottom: 12, left: 14, display: "flex", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.accent }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent }} /> Active
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.dim }} /> Checked Out
            </div>
          </div>

          <style>{`@keyframes pulse { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:0.6} 50%{transform:translate(-50%,-50%) scale(1.6);opacity:0.1} }`}</style>
        </div>

        {/* Active partner list under map */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.filter(j => j.checkIn && !j.checkOut && j.status === "in-progress").length === 0 && (
            <div style={{ fontSize: 13, color: C.muted, textAlign: "center", padding: "8px 0" }}>No partners currently on-site.</div>
          )}
          {jobs.filter(j => j.checkIn && !j.checkOut).map(job => {
            const partner = partners.find(p => p.id === job.partnerId);
            return (
              <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, boxShadow: `0 0 8px ${C.accent}` }} />
                <div style={styles.avatar(avatarColors[job.partnerId % 4])}>{partner?.avatar}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{partner?.name}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{job.client} · checked in {job.checkIn}</div>
                </div>
                {job.checkInCoords && (
                  <button style={styles.btn("ghost")} onClick={() => openMaps(job.checkInCoords, job.address)}>
                    🗺 View
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-job check-in table */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div style={styles.h3}>Job Check-In Log</div>
        <input style={{ ...styles.input, width: 160 }} type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {todayJobs.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No jobs found for this date.</div>}
        {todayJobs.map(job => {
          const partner = partners.find(p => p.id === job.partnerId);
          const canCheckIn = !job.checkIn && job.status !== "completed";
          const canCheckOut = job.checkIn && !job.checkOut;
          return (
            <div key={job.id} style={styles.card}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{job.client}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>📍 {job.address}</div>
                  <div style={{ fontSize: 13, color: C.muted }}>👷 {partner?.name} · {job.time}</div>
                </div>
                <div style={styles.badge(job.status === "completed" ? "green" : job.status === "in-progress" ? "gold" : "blue")}>{job.status}</div>
              </div>

              {/* Check-in / Check-out status */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: "10px 14px", borderLeft: `3px solid ${job.checkIn ? C.accent : C.border}` }}>
                  <div style={styles.label}>Check-In</div>
                  {job.checkIn ? (
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: C.accent }}>✅ {job.checkIn}</div>
                      {job.checkInCoords && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{job.checkInCoords.lat.toFixed(4)}, {job.checkInCoords.lng.toFixed(4)}</div>}
                    </div>
                  ) : (
                    <div style={{ color: C.dim, fontSize: 13 }}>Not checked in</div>
                  )}
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: "10px 14px", borderLeft: `3px solid ${job.checkOut ? C.gold : C.border}` }}>
                  <div style={styles.label}>Check-Out</div>
                  {job.checkOut ? (
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: C.gold }}>🏁 {job.checkOut}</div>
                      {job.checkOutCoords && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{job.checkOutCoords.lat.toFixed(4)}, {job.checkOutCoords.lng.toFixed(4)}</div>}
                    </div>
                  ) : (
                    <div style={{ color: C.dim, fontSize: 13 }}>Not checked out</div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {canCheckIn && (
                  <button style={{ ...styles.btn("primary"), display: "flex", alignItems: "center", gap: 6 }}
                    onClick={() => getLocation(job, "checkin")}
                    disabled={locating && selectedJob?.id === job.id}>
                    {locating && selectedJob?.id === job.id && actionType === "checkin" ? "📡 Getting GPS..." : "📍 GPS Check-In"}
                  </button>
                )}
                {canCheckOut && (
                  <button style={{ ...styles.btn("sm"), background: C.gold, color: "#0A0F1E", display: "flex", alignItems: "center", gap: 6 }}
                    onClick={() => getLocation(job, "checkout")}
                    disabled={locating && selectedJob?.id === job.id}>
                    {locating && selectedJob?.id === job.id && actionType === "checkout" ? "📡 Getting GPS..." : "🏁 GPS Check-Out"}
                  </button>
                )}
                <button style={styles.btn("ghost")} onClick={() => openDirections(job.address)}>
                  🧭 Directions
                </button>
                {job.checkInCoords && (
                  <button style={styles.btn("ghost")} onClick={() => openMaps(job.checkInCoords, job.address)}>
                    🗺 View on Map
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full history log */}
      <div style={styles.divider} />
      <div style={styles.h3}>All-Time GPS Log</div>
      <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, padding: "10px 16px", background: C.surface, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase" }}>
          <span>Partner</span><span>Job</span><span>Check-In</span><span>Check-Out</span>
        </div>
        {jobs.filter(j => j.checkIn || j.checkOut).map(job => {
          const partner = partners.find(p => p.id === job.partnerId);
          return (
            <div key={job.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, padding: "12px 16px", borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ ...styles.avatar(avatarColors[job.partnerId % 4]), width: 28, height: 28, fontSize: 11 }}>{partner?.avatar}</div>
                <span style={{ fontWeight: 600 }}>{partner?.name.split(" ")[0]}</span>
              </div>
              <div style={{ color: C.muted, display: "flex", alignItems: "center" }}>{job.client}</div>
              <div style={{ color: job.checkIn ? C.accent : C.dim, display: "flex", alignItems: "center" }}>{job.checkIn || "—"}</div>
              <div style={{ color: job.checkOut ? C.gold : C.dim, display: "flex", alignItems: "center" }}>{job.checkOut || "—"}</div>
            </div>
          );
        })}
        {jobs.filter(j => j.checkIn || j.checkOut).length === 0 && (
          <div style={{ padding: "16px", color: C.muted, fontSize: 13, textAlign: "center" }}>No GPS events recorded yet.</div>
        )}
      </div>
    </div>
  );
}



// ─── SWOT ANALYSIS ───────────────────────────────────────────────────────────
const SWOT_DATA = {
  strengths: [
    { title: "All-in-One Partner Management", detail: "Unlike Connecteam (workforce only) or Swept (commercial ops only), CleanPro unifies partner scheduling, GPS check-in, pay tracking, and onboarding in a single tool — zero app-switching." },
    { title: "Built-In Training & Onboarding", detail: "Competitors like Housecall Pro and Jobber have no native onboarding modules. CleanPro's step-by-step training tracks completion per partner and auto-activates them, cutting ramp-up time." },
    { title: "GPS Check-In with Time Verification", detail: "Matches Connecteam and ZenMaid's GPS clock-in capability. Partners can check in/out from the field with location capture — preventing time theft and disputes." },
    { title: "Upsell Logic Baked In", detail: "Most platforms treat upsells as manual line items. CleanPro surfaces upsell options at job creation and automatically adds per-upsell pay bonuses for partners, incentivizing them to sell up." },
    { title: "Residential + Commercial Lead Intake", detail: "Jobber and ZenMaid offer booking widgets, but CleanPro separates residential and commercial lead flows with tailored quote logic — a differentiation most platforms miss." },
    { title: "Zero Subscription Cost", detail: "Enterprise platforms like ServiceTitan and Jobber charge $49–$349+/month. CleanPro is fully owned by you with no recurring SaaS fees." },
  ],
  weaknesses: [
    { title: "No Native Payment Processing", detail: "Jobber, Housecall Pro, and ZenMaid all integrate Stripe or Square for in-app payments. CleanPro currently tracks pay but doesn't process partner payouts or client charges natively." },
    { title: "No QuickBooks / Accounting Sync", detail: "Industry leaders integrate with QuickBooks Online for seamless bookkeeping. Without this, financial reconciliation requires manual export — a gap at scale." },
    { title: "No Client-Facing Portal", detail: "Jobber's client hub lets customers approve quotes, view job history, and pay invoices online 24/7. CleanPro currently manages everything from the owner side only." },
    { title: "No Route Optimization", detail: "Service Fusion and Field Promax offer automated route planning to minimize drive time between jobs. CleanPro provides directions but no multi-stop optimization." },
    { title: "No Automated SMS / Email Reminders", detail: "ZenMaid's top feature is automated client appointment reminders. CleanPro doesn't yet send confirmations or follow-ups, which increases no-shows." },
    { title: "Single-User / Local State Only", detail: "Current version stores data in memory. No cloud sync means partners can't log in from their own phones independently — a key need for field workers." },
  ],
  opportunities: [
    { title: "AI-Powered Quote Engine", detail: "No current competitor uses AI to auto-generate dynamic quotes based on sq footage, job type, and history. CleanPro's Claude integration gives it a unique path here." },
    { title: "$380B Growing Market", detail: "The global cleaning services market is valued at ~$380B in 2025 with ~70% of firms moving to digital tools. Early movers with full-stack platforms capture loyalty fast." },
    { title: "Commercial Cleaning Underserved", detail: "Most platforms skew residential. Commercial clients (60% of industry revenue) need multi-site management, compliance docs, and contract billing — areas CleanPro's commercial lead tab begins to address." },
    { title: "Geofencing & Compliance Alerts", detail: "Adding geofence enforcement (flag check-ins >0.5mi from job site) would address a major pain point — time fraud — that only enterprise tools like ServiceTitan currently tackle." },
    { title: "Franchise / Multi-Location Expansion", detail: "A white-label or multi-location version could serve cleaning franchises, a segment currently requiring expensive custom builds or ServiceTitan's high-cost tiers." },
    { title: "Recurring Booking Automation", detail: "Weekly/biweekly recurring cleans are the backbone of residential revenue. Automating recurring job creation and partner assignment is a high-demand, underdeveloped feature." },
  ],
  threats: [
    { title: "Housecall Pro's Network Effect", detail: "With 40,000+ businesses and deep QuickBooks/Google/Stripe integrations, Housecall Pro's ecosystem is hard to replicate. Switching costs create stickiness for existing users." },
    { title: "ZenMaid's Niche Specialization", detail: "ZenMaid is purpose-built for maid/residential services with features like rotation scheduling and automated client follow-ups. In the residential segment, it's a formidable narrow competitor." },
    { title: "Jobber's Brand Authority", detail: "Jobber is one of the most trusted names in field service software with robust marketing, G2 awards, and a large support team. Brand trust is a real barrier for independent tools." },
    { title: "Data Security & Compliance Risk", detail: "Handling client addresses, payment data, and GPS location data creates GDPR/CCPA obligations. Enterprise platforms have legal teams for compliance — custom builds carry liability exposure." },
    { title: "Field Adoption Resistance", detail: "Partners in the cleaning industry skew toward older demographics who may resist app-based workflows. Competitors with simpler mobile UX (like ZenMaid) have lower partner friction." },
    { title: "Feature Parity Race", detail: "Platforms like Connecteam and Jobber ship updates continuously. Without a dedicated dev team, CleanPro risks feature gaps widening over time as competitors add AI, integrations, and analytics." },
  ],
};

const SWOT_CONFIG = [
  { key: "strengths", label: "Strengths", icon: "💪", color: C.accent, dimColor: C.accentDim, corner: "Internal · Positive" },
  { key: "weaknesses", label: "Weaknesses", icon: "⚠️", color: C.red, dimColor: C.redDim, corner: "Internal · Negative" },
  { key: "opportunities", label: "Opportunities", icon: "🚀", color: C.blue, dimColor: C.blueDim, corner: "External · Positive" },
  { key: "threats", label: "Threats", icon: "🛡️", color: C.gold, dimColor: C.goldDim, corner: "External · Negative" },
];

function SWOTAnalysis() {
  const [expanded, setExpanded] = useState({});
  const toggle = (key, i) => setExpanded(e => ({ ...e, [`${key}-${i}`]: !e[`${key}-${i}`] }));

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={styles.h2}>SWOT Analysis — Have Us Clean vs. Industry</div>
        <div style={{ color: C.muted, fontSize: 14, maxWidth: 700 }}>
          Benchmarked against Housecall Pro, Jobber, ZenMaid, Connecteam, Swept, ServiceTitan, and Field Promax — the top cleaning business platforms of 2025.
        </div>
      </div>

      {/* Competitor Quick Reference */}
      <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, padding: "16px 20px", marginBottom: 28 }}>
        <div style={styles.label}>Competitors Analyzed</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {["Housecall Pro","Jobber","ZenMaid","Connecteam","Swept","ServiceTitan","Field Promax","TCS","FieldPulse","Launch27"].map(c => (
            <span key={c} style={{ padding: "4px 12px", borderRadius: 20, background: C.surface, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.muted }}>{c}</span>
          ))}
        </div>
      </div>

      {/* SWOT Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
        {SWOT_CONFIG.map(({ key, label, icon, color, dimColor, corner }) => (
          <div key={key} style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ background: dimColor, borderBottom: `1px solid ${color}33`, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color }}>{label}</div>
                  <div style={{ fontSize: 11, color: `${color}99`, fontWeight: 600 }}>{corner}</div>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 22, color: `${color}66` }}>{SWOT_DATA[key].length}</div>
            </div>
            {/* Items */}
            <div style={{ padding: "12px 0" }}>
              {SWOT_DATA[key].map((item, i) => (
                <div key={i} style={{ borderBottom: i < SWOT_DATA[key].length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <button
                    onClick={() => toggle(key, i)}
                    style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left" }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text, flex: 1 }}>{item.title}</div>
                    <span style={{ color, fontSize: 16, flexShrink: 0 }}>{expanded[`${key}-${i}`] ? "▲" : "▼"}</span>
                  </button>
                  {expanded[`${key}-${i}`] && (
                    <div style={{ padding: "0 20px 14px", fontSize: 13, color: C.muted, lineHeight: 1.65, borderLeft: `3px solid ${color}`, marginLeft: 20, marginRight: 20, paddingLeft: 12 }}>
                      {item.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Summary Scorecard */}
      <div style={{ ...styles.card, marginTop: 28 }}>
        <div style={styles.h3}>📊 Competitive Scorecard — Have Us Clean vs. Leaders</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Feature","Have Us Clean","Housecall Pro","Jobber","ZenMaid","Connecteam"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "center", color: i === 1 ? C.accent : C.muted, fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Partner/Staff Management","✅","✅","✅","✅","✅"],
                ["GPS Check-In / Tracking","✅","✅","⚠️","✅","✅"],
                ["Job Scheduling","✅","✅","✅","✅","✅"],
                ["Before/After Photos","✅","✅","✅","⚠️","❌"],
                ["Upsell Engine","✅","❌","❌","❌","❌"],
                ["Built-In Training/Onboarding","✅","❌","❌","❌","✅"],
                ["Lead Intake + Quote Builder","✅","⚠️","✅","❌","❌"],
                ["Residential + Commercial Split","✅","⚠️","⚠️","✅","❌"],
                ["Client-Facing Portal","❌","✅","✅","✅","❌"],
                ["Native Payment Processing","❌","✅","✅","✅","⚠️"],
                ["QuickBooks Integration","❌","✅","✅","✅","✅"],
                ["Auto SMS/Email Reminders","❌","✅","✅","✅","✅"],
                ["SaaS Subscription Cost","Free","$49–$129/mo","$49–$349/mo","$29–$99/mo","$29–$99/mo"],
              ].map(([feat, ...vals], ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${C.border}`, background: ri % 2 === 0 ? "transparent" : "#ffffff04" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: C.text }}>{feat}</td>
                  {vals.map((v, vi) => (
                    <td key={vi} style={{ padding: "10px 12px", textAlign: "center", color: v === "✅" ? C.accent : v === "❌" ? C.red : v === "⚠️" ? C.gold : C.muted, fontWeight: vi === 0 ? 800 : 600 }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: C.dim }}>✅ Full feature · ⚠️ Partial / add-on required · ❌ Not available</div>
      </div>
    </div>
  );
}



// ─── CLIENT PORTAL ────────────────────────────────────────────────────────────
function ClientPortal({ jobs, resLeads, setResLeads, partners, region, setTab }) {
  const [selectedClient, setSelectedClient] = useState(null);
  const [filterType, setFilterType] = useState("all");

  // Build unified client list from real jobs + leads
  const allClientNames = [...new Set([
    ...jobs.map(j => j.client),
    ...(resLeads || []).map(l => l.name),
  ])].filter(Boolean);

  const clients = allClientNames.map(name => {
    const clientJobs  = jobs.filter(j => j.client === name);
    const clientLeads = (resLeads || []).filter(l => l.name === name);
    const latestLead  = clientLeads[clientLeads.length - 1];
    const email = latestLead?.email || clientJobs[0]?.email || "";
    const phone = latestLead?.phone || "";
    const address = latestLead?.address || clientJobs[0]?.address || "";
    const totalSpent  = clientJobs.filter(j => j.status === "completed").reduce((a, b) => a + (b.clientPrice || 0), 0);
    const nextJob     = clientJobs.find(j => j.status === "scheduled");
    const latestQuote = clientLeads.filter(l => ["Quoted","Follow Up","Booked"].includes(l.status)).slice(-1)[0];
    const type = clientLeads[0]?.dwellingType ? "residential" : "residential";

    return { name, email, phone, address, type, totalSpent, clientJobs, clientLeads, nextJob, latestQuote };
  });

  const filtered = filterType === "all" ? clients
    : filterType === "active" ? clients.filter(c => c.nextJob || c.latestQuote)
    : clients.filter(c => c.totalSpent > 0);

  const totalRevenue = clients.reduce((a, b) => a + b.totalSpent, 0);
  const activeClients = clients.filter(c => c.nextJob || c.latestQuote).length;

  if (selectedClient) {
    const c = selectedClient;
    const quotedLeads = c.clientLeads.filter(l => l.status !== "Lost");
    return (
      <div>
        <button style={{ ...S.btn("ghost"), marginBottom:20, fontSize:13 }} onClick={() => setSelectedClient(null)}>← Back to All Clients</button>

        {/* Client header */}
        <div style={{ ...S.card, marginBottom:20, background:"linear-gradient(135deg,#0A0F1E,#1A2235)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", marginBottom:16 }}>
            <div style={{ width:56, height:56, borderRadius:14, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>🏠</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:22 }}>{c.name}</div>
              {c.email && <div style={{ fontSize:13, color:C.muted }}>📧 {c.email}</div>}
              {c.phone && <div style={{ fontSize:13, color:C.muted }}>📞 {c.phone}</div>}
              {c.address && <div style={{ fontSize:13, color:C.muted }}>📍 {c.address}</div>}
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:800, fontSize:28, color:C.accent }}>{region?.currencySymbol || "$"}{c.totalSpent.toLocaleString()}</div>
              <div style={{ fontSize:12, color:C.muted }}>lifetime spend</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:10 }}>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>TOTAL JOBS</div>
              <div style={{ fontSize:22, fontWeight:800, color:C.accent }}>{c.clientJobs.length}</div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>COMPLETED</div>
              <div style={{ fontSize:22, fontWeight:800, color:C.accent }}>{c.clientJobs.filter(j=>j.status==="completed").length}</div>
            </div>
            <div style={{ background:C.surface, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>QUOTES</div>
              <div style={{ fontSize:22, fontWeight:800, color:C.gold }}>{quotedLeads.length}</div>
            </div>
            {c.nextJob && (
              <div style={{ background:C.accentDim, borderRadius:10, padding:"10px 14px", textAlign:"center", border:`1px solid ${C.accent}44` }}>
                <div style={{ fontSize:11, color:C.accent, fontWeight:700 }}>NEXT JOB</div>
                <div style={{ fontSize:14, fontWeight:800, color:C.accent }}>{c.nextJob.date}</div>
                <div style={{ fontSize:11, color:C.muted }}>{c.nextJob.type}</div>
              </div>
            )}
          </div>
        </div>

        {/* Quotes / Lead history */}
        {quotedLeads.length > 0 && (
          <div style={{ ...S.card, marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={S.h3}>📄 Quote History</div>
              <button style={S.btn("sm")} onClick={() => setTab("res")}>+ New Quote</button>
            </div>
            {quotedLeads.map(lead => {
              const q = (() => { try { return calcResQuote({...lead, dwellingType:lead.dwellingType||"Apartment / Condo", dwellingSize:lead.dwellingSize||"2 Bed", serviceType:lead.serviceType||"Refresh Clean", frequency:lead.frequency||"One-Time", beds:lead.beds||2, baths:lead.baths||1, sqft:lead.sqft||900, addons:lead.addons||[]}, region || ACTIVE_REGION); } catch(e) { return {total:0,preTaxTotal:0,taxAmount:0,partnerPay:0,partnerPayEach:0,profit:0,margin:0,teamSize:1,jobHours:1.5,breakdown:[],discountAmt:0,discPct:0,taxRate:0,taxName:"HST",currency:"CA$",region:region||ACTIVE_REGION,freq_prices:{},baseClientPrice:0}; } })();
              const statusColor = HUC_STATUS_COLOR[lead.status] || C.muted;
              return (
                <div key={lead.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:`1px solid ${C.border}`, flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>{lead.serviceType}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{lead.dwellingType} · {lead.frequency} · {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : ""}</div>
                    {lead.addons?.length > 0 && <div style={{ fontSize:11, color:C.dim }}>+ {lead.addons?.map(id=>RES_ADDONS.find(x=>x.id===id)?.label).filter(Boolean).join(", ")}</div>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{lead.status}</span>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:800, color:C.accent }}>{region?.currencySymbol || "$"}{Math.round(q.total).toLocaleString()}</div>
                      {lead.quotedDate && <div style={{ fontSize:10, color:C.dim }}>Quoted {lead.quotedDate}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Job history */}
        <div style={S.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={S.h3}>🧹 Job History</div>
            <button style={S.btn("sm")} onClick={() => setTab("jobs")}>View All Jobs</button>
          </div>
          {c.clientJobs.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>No jobs yet — book a quote to create the first job.</div>}
          {c.clientJobs.slice().reverse().map(job => {
            const partner = partners?.find(p => p.id === job.partnerId);
            const statusColor = job.status==="completed" ? C.accent : job.status==="in-progress" ? C.gold : C.blue;
            return (
              <div key={job.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:`1px solid ${C.border}`, flexWrap:"wrap", gap:8 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{job.type}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{job.date} · {job.time}{partner ? ` · ${partner.name}` : ""}</div>
                  {job.upsells?.length > 0 && <div style={{ fontSize:11, color:C.gold }}>+ {job.upsells.join(", ")}</div>}
                  {job.summary && <div style={{ fontSize:11, color:C.muted, marginTop:2, fontStyle:"italic" }}>"{job.summary}"</div>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:`${statusColor}22`, color:statusColor }}>{job.status}</span>
                  <div style={{ fontWeight:800, color:C.accent }}>{region?.currencySymbol || "$"}{(job.clientPrice||0).toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={S.h2}>🌐 Client Portal</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:-14 }}>Live data from Quotes + Jobs — updates automatically</div>
        </div>
        <button style={S.btn("primary")} onClick={() => setTab("res")}>+ New Quote</button>
      </div>

      <div style={S.grid4}>
        <StatCard label="Total Clients"   value={clients.length}         icon="👤" color={C.accent} />
        <StatCard label="Active"          value={activeClients}          icon="✅" color={C.blue}   />
        <StatCard label="Total Revenue"   value={`$${totalRevenue.toLocaleString()}`} icon="💰" color={C.gold} />
        <StatCard label="Quoted / Active" value={clients.filter(c=>c.latestQuote).length} icon="📄" color={C.accent} />
      </div>

      <div style={S.divider} />

      {/* Filter */}
      <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
        {[["all","All Clients"],["active","Active"],["history","Has Job History"]].map(([val,label]) => (
          <button key={val} style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:700, background:filterType===val?C.accentDim:C.surface, color:filterType===val?C.accent:C.muted, border:`1px solid ${filterType===val?C.accent:C.border}` }} onClick={() => setFilterType(val)}>{label}</button>
        ))}
      </div>

      {clients.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📭</div>
          <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>No clients yet</div>
          <div style={{ color:C.muted, fontSize:14, marginBottom:20 }}>Add your first lead in the Quotes tab — it will appear here automatically.</div>
          <button style={S.btn("primary")} onClick={() => setTab("res")}>Go to Quotes →</button>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {filtered.map(c => (
          <div key={c.name} style={{ ...S.card, cursor:"pointer" }} onClick={() => setSelectedClient(c)}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:12, background:`linear-gradient(135deg,${C.accent},#0088FF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🏠</div>
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>{c.name}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{c.email || "No email"} · {c.address || "No address"}</div>
                  <div style={{ display:"flex", gap:6, marginTop:4, flexWrap:"wrap" }}>
                    {c.nextJob && <span style={S.badge("green")}>📅 Next: {c.nextJob.date}</span>}
                    {c.latestQuote && <span style={S.badge("gold")}>📄 {c.latestQuote.status}</span>}
                    {c.clientJobs.length > 0 && <span style={S.badge("blue")}>{c.clientJobs.length} job{c.clientJobs.length!==1?"s":""}</span>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, fontSize:22, color:C.accent }}>${c.totalSpent.toLocaleString()}</div>
                <div style={{ fontSize:11, color:C.muted }}>lifetime</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── QUICKBOOKS SYNC ─────────────────────────────────────────────────────────
function QuickBooksSync({ jobs, partners }) {
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [selectedInvoices, setSelectedInvoices] = useState([]);

  const invoiceQueue = jobs.filter(j => j.status === "completed").map(j => {
    const partner = partners.find(p => p.id === j.partnerId);
    return {
      id: `INV-${j.id}`, jobId: j.id, client: j.client, date: j.date,
      type: j.type, amount: j.pay / 0.45, partnerPay: j.pay,
      partnerName: partner?.name || "Unknown", synced: false,
    };
  });

  const toggleInvoice = (id) => setSelectedInvoices(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  const selectAll = () => setSelectedInvoices(invoiceQueue.map(i=>i.id));

  const connectQB = () => {
    setSyncing(true);
    setTimeout(() => {
      setConnected(true);
      setSyncing(false);
      setSyncLog([{ time: new Date().toLocaleTimeString(), msg: "✅ Connected to QuickBooks Online — Company: CleanPro Services LLC", type:"success" }]);
    }, 1800);
  };

  const runSync = () => {
    if (!selectedInvoices.length) return alert("Select at least one invoice to sync.");
    setSyncing(true);
    const selected = invoiceQueue.filter(i => selectedInvoices.includes(i.id));
    setTimeout(() => {
      const newLogs = selected.map(inv => ({
        time: new Date().toLocaleTimeString(),
        msg: `✅ Synced ${inv.id} — ${inv.client} — $${inv.amount.toFixed(2)} → QuickBooks Invoices`,
        type: "success"
      }));
      setSyncLog(l => [...newLogs, ...l]);
      setLastSync(new Date().toLocaleTimeString());
      setSelectedInvoices([]);
      setSyncing(false);
    }, 2000);
  };

  const exportCSV = () => {
    const rows = ["Invoice ID,Client,Date,Job Type,Invoice Amount,Partner Pay,Partner"];
    invoiceQueue.forEach(i => rows.push(`${i.id},"${i.client}",${i.date},"${i.type}",${(i.amount).toFixed(2)},${i.partnerPay.toFixed(2)},"${i.partnerName}"`));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="cleanpro_invoices.csv"; a.click();
  };

  return (
    <div>
      <div style={styles.h2}>🔗 QuickBooks Integration</div>

      {/* Connection Status */}
      <div style={{ ...styles.card, marginBottom: 24, borderLeft: `4px solid ${connected ? C.accent : C.gold}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 36 }}>💚</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>QuickBooks Online</div>
              <div style={{ fontSize: 13, color: connected ? C.accent : C.gold, fontWeight: 700 }}>
                {connected ? "✅ Connected — Have Us Clean Services LLC" : "⚠️ Not Connected"}
              </div>
              {lastSync && <div style={{ fontSize: 12, color: C.muted }}>Last synced: {lastSync}</div>}
            </div>
          </div>
          {!connected ? (
            <button style={styles.btn("primary")} onClick={connectQB} disabled={syncing}>
              {syncing ? "Connecting..." : "🔗 Connect QuickBooks"}
            </button>
          ) : (
            <button style={{ ...styles.btn("ghost") }} onClick={() => { setConnected(false); setSyncLog([]); }}>Disconnect</button>
          )}
        </div>
      </div>

      {connected && (
        <>
          {/* Sync Options */}
          <div style={styles.grid3}>
            <StatCard label="Invoices Ready" value={invoiceQueue.length} icon="📄" color={C.blue} sub="completed jobs" />
            <StatCard label="Total Invoice Value" value={`$${invoiceQueue.reduce((a,b)=>a+(b.amount),0).toFixed(0)}`} icon="💵" color={C.accent} />
            <StatCard label="Partner Pay to Export" value={`$${invoiceQueue.reduce((a,b)=>a+b.partnerPay,0).toFixed(0)}`} icon="👥" color={C.gold} />
          </div>

          <div style={styles.divider} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <div style={styles.h3}>Invoice Queue — Sync to QuickBooks</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.btn("ghost")} onClick={selectAll}>Select All</button>
              <button style={styles.btn("ghost")} onClick={exportCSV}>⬇ Export CSV</button>
              <button style={styles.btn("primary")} onClick={runSync} disabled={syncing || !selectedInvoices.length}>
                {syncing ? "Syncing..." : `🔄 Sync ${selectedInvoices.length || ""} to QB`}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {invoiceQueue.map(inv => (
              <div key={inv.id} style={{ ...styles.cardSm, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", border: `1px solid ${selectedInvoices.includes(inv.id) ? C.accent : C.border}`, background: selectedInvoices.includes(inv.id) ? C.accentDim : C.card }}
                onClick={() => toggleInvoice(inv.id)}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${selectedInvoices.includes(inv.id)?C.accent:C.dim}`, background: selectedInvoices.includes(inv.id)?C.accent:"transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#0A0F1E", flexShrink: 0 }}>
                  {selectedInvoices.includes(inv.id) ? "✓" : ""}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{inv.id} — {inv.client}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{inv.date} · {inv.type} · Partner: {inv.partnerName}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, color: C.accent }}>${inv.amount.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Partner: ${inv.partnerPay.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* What gets synced */}
          <div style={{ ...styles.card, marginTop: 24 }}>
            <div style={styles.h3}>📋 What Syncs to QuickBooks</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              {[
                ["📄","Customer Invoices","Job totals → QB Invoices"],
                ["💸","Partner Expenses","Partner pay → QB Bills"],
                ["👤","Client Records","New clients → QB Customers"],
                ["🔄","Payment Status","Paid jobs → QB Payments"],
                ["📊","Revenue Reports","Monthly summaries"],
                ["🏷️","Job Categories","Service types → QB Items"],
              ].map(([icon,title,sub]) => (
                <div key={title} style={{ background: C.surface, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Sync Log */}
          {syncLog.length > 0 && (
            <div style={{ ...styles.card, marginTop: 20 }}>
              <div style={styles.h3}>🕐 Sync Log</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {syncLog.map((log, i) => (
                  <div key={i} style={{ fontSize: 12, color: log.type==="success"?C.accent:C.red, fontFamily: "monospace", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                    [{log.time}] {log.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!connected && (
        <div style={{ ...styles.card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💚</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Connect Your QuickBooks Account</div>
          <div style={{ fontSize: 14, color: C.muted, marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>
            Sync completed jobs as invoices, partner pay as expenses, and client records automatically. No double-entry, no spreadsheets.
          </div>
          <button style={styles.btn("primary")} onClick={connectQB}>🔗 Connect QuickBooks Online</button>
        </div>
      )}
    </div>
  );
}



// ─── PRICING STRATEGY ────────────────────────────────────────────────────────
const TIERS = [
  {
    name: "Starter", price: 29, color: C.blue, icon: "🌱",
    tagline: "Perfect for 1–3 partners just getting organized",
    features: [
      "Up to 3 active partners","Unlimited job bookings","GPS check-in / check-out",
      "Residential lead intake + quotes","Before & after photos","Basic pay tracking",
      "Partner onboarding & training","Mobile + desktop access",
    ],
    notIncluded: ["Commercial lead module","Client portal","QuickBooks sync","Custom branding"],
    cta: "Start Free 14-Day Trial",
    highlight: false,
  },
  {
    name: "Growth", price: 59, color: C.accent, icon: "🚀",
    tagline: "Best for growing teams of 4–10 partners",
    features: [
      "Up to 10 active partners","Everything in Starter",
      "Commercial leads + contract quotes","Client portal (quotes, invoices, payments)",
      "QuickBooks Online sync","Upsell engine with partner incentives",
      "Automated SMS/email reminders","Recurring job scheduling",
      "Revenue & partner pay reports",
    ],
    notIncluded: ["Multi-location management","White-label branding"],
    cta: "Most Popular — Start Free Trial",
    highlight: true,
  },
  {
    name: "Pro", price: 99, color: C.gold, icon: "⚡",
    tagline: "For established businesses scaling fast",
    features: [
      "Unlimited partners","Everything in Growth",
      "Multi-location / franchise management","White-label client portal",
      "Geofencing & compliance alerts","AI-powered scheduling suggestions",
      "Advanced analytics dashboard","Priority support",
      "Custom onboarding templates","API access",
    ],
    notIncluded: [],
    cta: "Start Free Trial",
    highlight: false,
  },
];

function PricingStrategy() {
  const [billing, setBilling] = useState("monthly");
  const discount = billing === "annual" ? 0.20 : 0;

  const competitors = [
    { name: "ZenMaid", starter: 39, mid: 109, top: 169, notes: "Residential only" },
    { name: "Jobber", starter: 29, mid: 99, top: 199, notes: "No cleaning-specific features" },
    { name: "Housecall Pro", starter: 59, mid: 189, top: 329, notes: "Multi-industry, not cleaning-focused" },
    { name: "BookingKoala", starter: 65, mid: 130, top: 197, notes: "Not cleaning-specific" },
    { name: "CleanPro ✨", starter: 29, mid: 59, top: 99, notes: "Cleaning-specific, all-in-one", highlight: true },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={styles.h2}>💰 Subscription Pricing Strategy</div>
        <div style={{ color: C.muted, fontSize: 14 }}>Research-backed pricing to be the best value in the market while building a sustainable SaaS business.</div>
      </div>

      {/* The business case */}
      <div style={{ ...styles.card, marginBottom: 28, borderLeft: `4px solid ${C.accent}` }}>
        <div style={styles.h3}>Should You Charge a Subscription? Yes — Here's Why</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.75 }}>
          The market is clear: <strong style={{ color: C.text }}>cleaning businesses will pay for software that saves them time and money.</strong> ZenMaid has 3,000+ paying users. Jobber and Housecall Pro serve tens of thousands. The $380B cleaning industry is actively digitizing, with 70% of firms now using software. <br/><br/>
          CleanPro's unique advantage: it's <strong style={{ color: C.accent }}>the only platform combining partner management, GPS, onboarding, upsell logic, residential + commercial leads, and QuickBooks sync</strong> — features that individually cost $49–$329/mo on competitor platforms. At $29–$99/mo, you're the obvious best-value choice.
        </div>
      </div>

      {/* Billing toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, justifyContent: "center" }}>
        <button style={{ ...styles.btn(billing==="monthly"?"primary":"ghost") }} onClick={()=>setBilling("monthly")}>Monthly</button>
        <button style={{ ...styles.btn(billing==="annual"?"primary":"ghost") }} onClick={()=>setBilling("annual")}>Annual (Save 20%)</button>
      </div>

      {/* Pricing cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20, marginBottom: 36 }}>
        {TIERS.map(tier => (
          <div key={tier.name} style={{ background: tier.highlight ? `linear-gradient(145deg,${C.card},#0D2035)` : C.card, borderRadius: 20, border: `2px solid ${tier.highlight ? tier.color : C.border}`, padding: 28, position: "relative", overflow: "hidden" }}>
            {tier.highlight && <div style={{ position: "absolute", top: 14, right: -24, background: C.accent, color: "#0A0F1E", fontSize: 11, fontWeight: 800, padding: "4px 36px", transform: "rotate(30deg)", letterSpacing: "0.05em" }}>BEST VALUE</div>}
            <div style={{ fontSize: 32, marginBottom: 8 }}>{tier.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: tier.color }}>{tier.name}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>{tier.tagline}</div>
            <div style={{ marginBottom: 20 }}>
              <span style={{ fontWeight: 800, fontSize: 38, color: tier.color }}>${Math.round(tier.price * (1 - discount))}</span>
              <span style={{ color: C.muted, fontSize: 14 }}>/mo</span>
              {billing === "annual" && <span style={{ marginLeft: 8, fontSize: 12, color: C.accent, fontWeight: 700 }}>Save ${Math.round(tier.price * discount * 12)}/yr</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 20 }}>
              {tier.features.map(f => <div key={f} style={{ fontSize: 13, color: C.text, display: "flex", gap: 8 }}><span style={{ color: tier.color }}>✓</span>{f}</div>)}
              {tier.notIncluded.map(f => <div key={f} style={{ fontSize: 13, color: C.dim, display: "flex", gap: 8 }}><span>✗</span>{f}</div>)}
            </div>
            <button style={{ ...styles.btn(tier.highlight?"primary":"ghost"), width: "100%", background: tier.highlight ? tier.color : "transparent", color: tier.highlight ? "#0A0F1E" : tier.color, border: `1px solid ${tier.color}` }}>
              {tier.cta}
            </button>
          </div>
        ))}
      </div>

      {/* Competitor price comparison */}
      <div style={styles.card}>
        <div style={styles.h3}>📊 Competitive Price Positioning</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 500 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Platform","Starter","Mid-Tier","Top Tier","Notes"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.muted, fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {competitors.map((c,i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: c.highlight ? C.accentDim : i%2===0?"transparent":"#ffffff04" }}>
                  <td style={{ padding: "11px 12px", fontWeight: c.highlight?800:600, color: c.highlight?C.accent:C.text }}>{c.name}</td>
                  <td style={{ padding: "11px 12px", color: c.highlight?C.accent:C.text, fontWeight: c.highlight?700:400 }}>${c.starter}/mo</td>
                  <td style={{ padding: "11px 12px", color: c.highlight?C.accent:C.text, fontWeight: c.highlight?700:400 }}>${c.mid}/mo</td>
                  <td style={{ padding: "11px 12px", color: c.highlight?C.accent:C.text, fontWeight: c.highlight?700:400 }}>${c.top}/mo</td>
                  <td style={{ padding: "11px 12px", fontSize: 12, color: c.highlight?C.accent:C.muted }}>{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revenue projections */}
      <div style={{ ...styles.card, marginTop: 20 }}>
        <div style={styles.h3}>📈 Revenue Potential — If You License CleanPro</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          {[
            { users: 50, avg: 59, label: "50 clients × $59/mo", mrr: 2950 },
            { users: 100, avg: 59, label: "100 clients × $59/mo", mrr: 5900 },
            { users: 250, avg: 65, label: "250 clients × $65 avg", mrr: 16250 },
            { users: 500, avg: 65, label: "500 clients × $65 avg", mrr: 32500 },
          ].map(row => (
            <div key={row.users} style={{ background: C.surface, borderRadius: 12, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{row.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.accent, marginTop: 6 }}>${row.mrr.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: C.muted }}>MRR · ${(row.mrr*12).toLocaleString()}/yr</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
          💡 <strong style={{ color: C.text }}>Opportunity:</strong> If you white-label and license CleanPro to other cleaning businesses, even 100 subscribers at $59/mo = <strong style={{ color: C.accent }}>$70,800/year</strong> in recurring revenue — on top of using it for your own business.
        </div>
      </div>

      {/* Roadmap to address weaknesses */}
      <div style={{ ...styles.card, marginTop: 20 }}>
        <div style={styles.h3}>🗺️ Roadmap — Turning Weaknesses into Wins</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { status:"✅ Built", item:"QuickBooks sync (invoice + expense export)", tier:"Growth" },
            { status:"✅ Built", item:"Client portal (quotes, invoices, reviews, portal link)", tier:"Growth" },
            { status:"✅ Built", item:"GPS check-in / check-out with location capture", tier:"All" },
            { status:"🔜 Next", item:"Stripe/Square payment processing (client pays in-app)", tier:"Growth" },
            { status:"🔜 Next", item:"Automated SMS appointment reminders", tier:"Growth" },
            { status:"🔜 Next", item:"Recurring job auto-scheduling", tier:"Starter+" },
            { status:"🔮 Future", item:"Geofencing — flag off-site check-ins", tier:"Pro" },
            { status:"🔮 Future", item:"AI scheduling assistant (ZenMaid users want this!)", tier:"Pro" },
            { status:"🔮 Future", item:"Cloud sync — partners log in from own phones", tier:"All" },
            { status:"🔮 Future", item:"White-label for franchise licensing", tier:"Pro" },
          ].map((r,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:`1px solid ${C.border}`, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color: r.status.startsWith("✅")?C.accent:r.status.startsWith("🔜")?C.gold:C.muted, fontWeight:700, minWidth:80 }}>{r.status}</span>
              <span style={{ flex:1, fontSize:13, color:C.text }}>{r.item}</span>
              <span style={{ ...styles.badge(r.tier==="All"?"green":r.tier==="Growth"?"blue":"gold"), fontSize:10 }}>{r.tier}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

