export function cleanResidentialLeads(leads = []) {
  const seen = new Set();

  return leads.filter((lead) => {
    if (!lead) return false;

    // ❌ Remove outreach junk
    const text = `${lead.name} ${lead.notes} ${lead.email}`.toLowerCase();

    if (
      text.includes("common area cleaning") ||
      text.includes("tenants experience") ||
      text.includes("danae from have us clean")
    ) {
      return false;
    }

    // ❌ Remove empty garbage leads
    if (!lead.name && !lead.email && !lead.phone) {
      return false;
    }

    // ❌ Deduplicate
    const key = (lead.email || lead.phone || lead.name || "").toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}
