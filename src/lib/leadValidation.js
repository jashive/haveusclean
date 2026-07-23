export function validateLead(lead, seenIds = new Set()) {
  const normalized = {
    ...lead,
    lead_id: String(lead?.lead_id || lead?.id || '').trim(),
    company: String(lead?.company || '').trim(),
    city: String(lead?.city || '').trim(),
    email: String(lead?.email || lead?.cold_email || '').trim(),
    phone: String(lead?.phone || lead?.phone_number || '').trim(),
    notes: String(lead?.notes || '').trim(),
  };

  if (!normalized.lead_id) {
    return { valid: false, reason: 'missing lead_id' };
  }

  if (seenIds.has(normalized.lead_id)) {
    return { valid: false, reason: 'duplicate lead_id' };
  }

  const placeholderPatterns = /\[your name\]|\[name\]|\[company\]|\[city\]|\[location\]|test lead|demo/i;
  if (placeholderPatterns.test(normalized.company) || placeholderPatterns.test(normalized.notes)) {
    return { valid: false, reason: 'placeholder or test record' };
  }

  if (!normalized.company) {
    return { valid: false, reason: 'missing company' };
  }

  const hasContact = Boolean(normalized.email || normalized.phone);
  if (!hasContact) {
    return { valid: false, reason: 'missing contact details' };
  }

  return { valid: true, reason: '' };
}
