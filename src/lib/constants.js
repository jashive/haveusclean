export const BRAND = {
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

export const C = {
  bg: "#0A0F1E",
  surface: "#111827",
  card: "#1A2235",
  border: "#1E2D45",
  accent: "#00D4AA",
  accentDim: "#00D4AA22",
  gold: "#FFB800",
  goldDim: "#FFB80022",
  red: "#FF4757",
  redDim: "#FF475722",
  blue: "#3B82F6",
  blueDim: "#3B82F622",
  purple: "#A78BFA",
  purpleDim: "#A78BFA22",
  text: "#F0F6FF",
  muted: "#8899AA",
  dim: "#445566",
};

export const HUC_STATUSES = [
  "New",
  "Quoted",
  "Follow Up",
  "Booked",
  "Completed",
  "Lost",
];

export const HUC_STATUS_COLOR = {
  New: C.blue,
  Quoted: C.gold,
  "Follow Up": "#FF6B6B",
  Booked: C.accent,
  Completed: C.accent,
  Lost: C.dim,
};

export const REGIONS = {
  ON: {
    id: "ON",
    country: "CA",
    flag: "\u{1F1E8}\u{1F1E6}",
    label: "Ontario, Canada",
    currency: "CAD",
    currencySymbol: "CA$",
    locale: "en-CA",
    tax: { name: "HST", rate: 0.13 },
    partnerCostPerHour: 30,
  },
  AZ: {
    id: "AZ",
    country: "US",
    flag: "\u{1F1FA}\u{1F1F8}",
    label: "Arizona, USA",
    currency: "USD",
    currencySymbol: "$",
    locale: "en-US",
    tax: { name: "TPT", rate: 0.086, serviceTaxable: false },
    partnerCostPerHour: 25,
  },
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const JOB_TYPES = [
  "Refresh Clean",
  "Full Home Clean",
  "Deep Clean",
  "Move-In / Move-Out",
  "Kitchen & Bathroom Refresh",
  "Post-Construction",
];

export const UPSELL_OPTIONS = [
  "Inside Fridge",
  "Inside Oven",
  "Inside Cabinets",
  "Interior Windows",
  "Baseboards / Detail",
  "Carpet Cleaning",
  "Pet Hair / Heavy Detail",
];

export const avatarColors = [
  "linear-gradient(135deg,#00D4AA,#0088FF)",
  "linear-gradient(135deg,#FF6B6B,#FF8E53)",
  "linear-gradient(135deg,#A78BFA,#EC4899)",
  "linear-gradient(135deg,#FFB800,#FF6B6B)",
];
