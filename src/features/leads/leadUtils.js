/**
 * leadUtils.js
 * Pure utility functions for residential lead filtering and key generation.
 * No React, no side effects, no database calls.
 */

/**
 * Generate a stable React key for a lead.
 * Prefers lead.id, falls back to email+name+createdAt.
 */
export function getLeadKey(lead) {
  return lead.id
    ? String(lead.id)
    : `${lead.email || ""}${lead.name || ""}${lead.createdAt || Math.random()}`;
}

/**
 * Filter and search leads.
 * @param {Array}  leads        - Full leads array
 * @param {string} filterStatus - "All" or a specific status string
 * @param {string} searchQuery  - Free-text search string
 * @returns {Array} filtered leads
 */
export function filterLeads(leads, filterStatus, searchQuery) {
  try {
    const base =
      filterStatus === "All"
        ? leads
        : leads.filter(l => l?.status === filterStatus);

    const sq = (searchQuery || "").trim().toLowerCase();

    return base.filter(l => {
      if (!l) return false;
      if (!l.name && !l.email && !l.id) return false;
      if (!sq) return true;
      return (
        (l.name    || "").toLowerCase().includes(sq) ||
        (l.email   || "").toLowerCase().includes(sq) ||
        (l.address || "").toLowerCase().includes(sq)
      );
    });
  } catch {
    return leads || [];
  }
}
