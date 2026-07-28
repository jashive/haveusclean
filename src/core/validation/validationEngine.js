const PLACEHOLDER_PATTERNS = /\[your name\]|\[name\]|\[company\]|\[city\]|\[location\]|test lead|demo/i;

function asString(value) {
  return String(value ?? "").trim();
}

function issue(type, message, field = null) {
  return { type, message, field };
}

export function createValidationResult({ errors = [], warnings = [], blockingIssues = [] } = {}) {
  const normalizedErrors = errors.map((entry) => typeof entry === "string" ? issue("error", entry) : entry);
  const normalizedWarnings = warnings.map((entry) => typeof entry === "string" ? issue("warning", entry) : entry);
  const normalizedBlockingIssues = blockingIssues.map((entry) => typeof entry === "string" ? issue("blocking", entry) : entry);
  const allBlocking = [...normalizedErrors, ...normalizedBlockingIssues];
  const reason = allBlocking[0]?.message || normalizedWarnings[0]?.message || "";

  return {
    valid: allBlocking.length === 0,
    reason,
    errors: normalizedErrors,
    warnings: normalizedWarnings,
    blockingIssues: normalizedBlockingIssues,
  };
}

export function validateLead(lead = {}) {
  const normalized = {
    ...lead,
    lead_id: asString(lead?.lead_id || lead?.id),
    company: asString(lead?.company),
    city: asString(lead?.city),
    email: asString(lead?.email || lead?.cold_email),
    phone: asString(lead?.phone || lead?.phone_number),
    notes: asString(lead?.notes),
  };

  const errors = [];
  const warnings = [];

  if (PLACEHOLDER_PATTERNS.test(normalized.company) || PLACEHOLDER_PATTERNS.test(normalized.notes)) {
    errors.push(issue("error", "placeholder or test record", "company"));
  }

  const looksLikeFallbackId = /^lead[-_]/i.test(normalized.lead_id);
  const hasMeaningfulContent = Boolean(
    normalized.company ||
    normalized.city ||
    normalized.email ||
    normalized.phone ||
    normalized.notes ||
    normalized.segment ||
    normalized.buyer_title ||
    normalized.market ||
    (normalized.lead_id && !looksLikeFallbackId)
  );

  if (!hasMeaningfulContent) {
    errors.push(issue("blocking", "empty row", "lead_id"));
  }

  if (!normalized.company && normalized.email) {
    warnings.push(issue("warning", "missing company name", "company"));
  }

  return createValidationResult({ errors, warnings });
}

export function validateQuote(quote = {}) {
  const errors = [];
  const warnings = [];

  if (!asString(quote?.serviceType)) errors.push(issue("blocking", "missing service type", "serviceType"));
  if (!(Number(quote?.total) > 0)) errors.push(issue("blocking", "invalid quote total", "total"));
  if (!asString(quote?.region?.id || quote?.region)) warnings.push(issue("warning", "missing region", "region"));

  return createValidationResult({ errors, warnings });
}

export function validateBooking(booking = {}) {
  const errors = [];
  if (!asString(booking?.client || booking?.clientName)) errors.push(issue("blocking", "missing client", "client"));
  if (!asString(booking?.address)) errors.push(issue("blocking", "missing address", "address"));
  if (!asString(booking?.date)) errors.push(issue("blocking", "missing date", "date"));
  return createValidationResult({ errors });
}

export function validateInvoice(invoice = {}) {
  const errors = [];
  if (!asString(invoice?.id)) errors.push(issue("blocking", "missing invoice id", "id"));
  if (!(Number(invoice?.amount) >= 0)) errors.push(issue("blocking", "invalid invoice amount", "amount"));
  return createValidationResult({ errors });
}

export function validateCustomer(customer = {}) {
  const errors = [];
  const warnings = [];
  if (!asString(customer?.name || customer?.company)) errors.push(issue("blocking", "missing customer name", "name"));
  if (!asString(customer?.email) && !asString(customer?.phone)) warnings.push(issue("warning", "customer has no contact details", "email"));
  return createValidationResult({ errors, warnings });
}

export function validateWorkOrder(workOrder = {}) {
  const errors = [];
  if (!asString(workOrder?.client || workOrder?.customer)) errors.push(issue("blocking", "missing work order client", "client"));
  if (!asString(workOrder?.address)) errors.push(issue("blocking", "missing work order address", "address"));
  if (!asString(workOrder?.date)) errors.push(issue("blocking", "missing work order date", "date"));
  return createValidationResult({ errors });
}
