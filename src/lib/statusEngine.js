export const CANONICAL_STATUS = {
  NEW_LEAD: "New Lead",
  NEEDS_INFORMATION: "Needs Information",
  READY_TO_QUOTE: "Ready to Quote",
  QUOTE_SENT: "Quote Sent",
  CUSTOMER_ACCEPTED: "Customer Accepted",
  DEPOSIT_PENDING: "Deposit Pending",
  BOOKED: "Booked",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  INVOICE_SENT: "Invoice Sent",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const DOMAIN_OPTIONS = {
  residential: ["New", "Quoted", "Follow Up", "Booked", "Completed", "Lost"],
  coldOutreach: ["New", "Contacted", "Follow Up", "Meeting Booked", "Won", "Lost"],
  job: ["scheduled", "in-progress", "completed", "cancelled"],
};

const normalizeToken = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ");

const GLOBAL_CANONICAL_MAP = {
  "new": CANONICAL_STATUS.NEW_LEAD,
  "new lead": CANONICAL_STATUS.NEW_LEAD,
  "needs information": CANONICAL_STATUS.NEEDS_INFORMATION,
  "ready to quote": CANONICAL_STATUS.READY_TO_QUOTE,
  "quote sent": CANONICAL_STATUS.QUOTE_SENT,
  "quoted": CANONICAL_STATUS.QUOTE_SENT,
  "follow up": CANONICAL_STATUS.NEEDS_INFORMATION,
  "customer accepted": CANONICAL_STATUS.CUSTOMER_ACCEPTED,
  "deposit pending": CANONICAL_STATUS.DEPOSIT_PENDING,
  "booked": CANONICAL_STATUS.BOOKED,
  "meeting booked": CANONICAL_STATUS.BOOKED,
  "scheduled": CANONICAL_STATUS.SCHEDULED,
  "in progress": CANONICAL_STATUS.IN_PROGRESS,
  "in-progress": CANONICAL_STATUS.IN_PROGRESS,
  "contacted": CANONICAL_STATUS.READY_TO_QUOTE,
  "completed": CANONICAL_STATUS.COMPLETED,
  "invoice sent": CANONICAL_STATUS.INVOICE_SENT,
  "paid": CANONICAL_STATUS.PAID,
  "won": CANONICAL_STATUS.PAID,
  "lost": CANONICAL_STATUS.CANCELLED,
  "cancelled": CANONICAL_STATUS.CANCELLED,
};

const DOMAIN_TO_CANONICAL = {
  residential: {
    "new": CANONICAL_STATUS.NEW_LEAD,
    "quoted": CANONICAL_STATUS.QUOTE_SENT,
    "follow up": CANONICAL_STATUS.NEEDS_INFORMATION,
    "booked": CANONICAL_STATUS.BOOKED,
    "completed": CANONICAL_STATUS.COMPLETED,
    "lost": CANONICAL_STATUS.CANCELLED,
  },
  coldOutreach: {
    "new": CANONICAL_STATUS.NEW_LEAD,
    "contacted": CANONICAL_STATUS.READY_TO_QUOTE,
    "follow up": CANONICAL_STATUS.NEEDS_INFORMATION,
    "meeting booked": CANONICAL_STATUS.BOOKED,
    "won": CANONICAL_STATUS.PAID,
    "lost": CANONICAL_STATUS.CANCELLED,
  },
  job: {
    "scheduled": CANONICAL_STATUS.SCHEDULED,
    "in progress": CANONICAL_STATUS.IN_PROGRESS,
    "in-progress": CANONICAL_STATUS.IN_PROGRESS,
    "completed": CANONICAL_STATUS.COMPLETED,
    "cancelled": CANONICAL_STATUS.CANCELLED,
  },
};

const CANONICAL_TO_DOMAIN = {
  residential: {
    [CANONICAL_STATUS.NEW_LEAD]: "New",
    [CANONICAL_STATUS.NEEDS_INFORMATION]: "Follow Up",
    [CANONICAL_STATUS.READY_TO_QUOTE]: "New",
    [CANONICAL_STATUS.QUOTE_SENT]: "Quoted",
    [CANONICAL_STATUS.CUSTOMER_ACCEPTED]: "Booked",
    [CANONICAL_STATUS.DEPOSIT_PENDING]: "Booked",
    [CANONICAL_STATUS.BOOKED]: "Booked",
    [CANONICAL_STATUS.SCHEDULED]: "Booked",
    [CANONICAL_STATUS.IN_PROGRESS]: "Booked",
    [CANONICAL_STATUS.COMPLETED]: "Completed",
    [CANONICAL_STATUS.INVOICE_SENT]: "Completed",
    [CANONICAL_STATUS.PAID]: "Completed",
    [CANONICAL_STATUS.CANCELLED]: "Lost",
  },
  coldOutreach: {
    [CANONICAL_STATUS.NEW_LEAD]: "New",
    [CANONICAL_STATUS.NEEDS_INFORMATION]: "Follow Up",
    [CANONICAL_STATUS.READY_TO_QUOTE]: "Contacted",
    [CANONICAL_STATUS.QUOTE_SENT]: "Contacted",
    [CANONICAL_STATUS.CUSTOMER_ACCEPTED]: "Meeting Booked",
    [CANONICAL_STATUS.DEPOSIT_PENDING]: "Meeting Booked",
    [CANONICAL_STATUS.BOOKED]: "Meeting Booked",
    [CANONICAL_STATUS.SCHEDULED]: "Meeting Booked",
    [CANONICAL_STATUS.IN_PROGRESS]: "Meeting Booked",
    [CANONICAL_STATUS.COMPLETED]: "Won",
    [CANONICAL_STATUS.INVOICE_SENT]: "Won",
    [CANONICAL_STATUS.PAID]: "Won",
    [CANONICAL_STATUS.CANCELLED]: "Lost",
  },
  job: {
    [CANONICAL_STATUS.NEW_LEAD]: "scheduled",
    [CANONICAL_STATUS.NEEDS_INFORMATION]: "scheduled",
    [CANONICAL_STATUS.READY_TO_QUOTE]: "scheduled",
    [CANONICAL_STATUS.QUOTE_SENT]: "scheduled",
    [CANONICAL_STATUS.CUSTOMER_ACCEPTED]: "scheduled",
    [CANONICAL_STATUS.DEPOSIT_PENDING]: "scheduled",
    [CANONICAL_STATUS.BOOKED]: "scheduled",
    [CANONICAL_STATUS.SCHEDULED]: "scheduled",
    [CANONICAL_STATUS.IN_PROGRESS]: "in-progress",
    [CANONICAL_STATUS.COMPLETED]: "completed",
    [CANONICAL_STATUS.INVOICE_SENT]: "completed",
    [CANONICAL_STATUS.PAID]: "completed",
    [CANONICAL_STATUS.CANCELLED]: "cancelled",
  },
};

export function getDomainStatusOptions(domain = "residential") {
  return DOMAIN_OPTIONS[domain] || DOMAIN_OPTIONS.residential;
}

export function normalizeStatus(value, domain = "residential") {
  const token = normalizeToken(value);
  if (!token) return DOMAIN_TO_CANONICAL[domain]?.[normalizeToken(getDomainStatusOptions(domain)[0])] || CANONICAL_STATUS.NEW_LEAD;
  return DOMAIN_TO_CANONICAL[domain]?.[token] || GLOBAL_CANONICAL_MAP[token] || CANONICAL_STATUS.NEW_LEAD;
}

export function toDomainStatus(value, domain = "residential") {
  const token = normalizeToken(value);
  const options = getDomainStatusOptions(domain);
  const exact = options.find((option) => normalizeToken(option) === token);
  if (exact) return exact;

  const canonical = normalizeStatus(value, domain);
  return CANONICAL_TO_DOMAIN[domain]?.[canonical] || options[0];
}

export function statusMatches(value, target, domain = "residential") {
  return normalizeStatus(value, domain) === normalizeStatus(target, domain);
}
