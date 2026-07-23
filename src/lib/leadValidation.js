export function validateLead(lead) {
  const normalized = {
    ...lead,
    lead_id: String(lead?.lead_id || lead?.id || '').trim(),
    company: String(lead?.company || '').trim(),
    city: String(lead?.city || '').trim(),
    email: String(lead?.email || lead?.cold_email || '').trim(),
    phone: String(lead?.phone || lead?.phone_number || '').trim(),
    notes: String(lead?.notes || '').trim(),
  };

  const placeholderPatterns = /\[your name\]|\[name\]|\[company\]|\[city\]|\[location\]|test lead|demo/i;
  if (placeholderPatterns.test(normalized.company) || placeholderPatterns.test(normalized.notes)) {
    return { valid: false, reason: 'placeholder or test record' };
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
    return { valid: false, reason: 'empty row' };
  }

  return { valid: true, reason: '' };
}
