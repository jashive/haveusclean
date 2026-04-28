import React from "react";
import { C } from "../../lib/constants";
import LeadCard from "./LeadCard";
import { filterLeads } from "./leadUtils";

/**
 * LeadList
 *
 * Renders a filtered, searchable list of residential lead cards.
 * No local state — all state and handlers come from ResidentialLeads via props.
 *
 * Props:
 *  leads              — full leads array
 *  filterStatus       — "All" or a status string
 *  searchQuery        — free-text search string
 *  region             — active region object
 *  S                  — shared style object from App.jsx
 *  calcResQuote       — quote engine function (passed from App.jsx — not moved yet)
 *  confirmDeleteRes   — currently pending delete ID (or null)
 *  onView             — (lead) => void
 *  onEdit             — (lead) => void
 *  onDelete           — (id) => void
 *  onConfirmDelete    — (id) => void
 *  onCancelDelete     — () => void
 *  onStatusChange     — (id, field, value) => void
 *  onQuote            — (lead) => void
 *  onBook             — (lead) => void
 *  onPay              — (lead) => void
 */
export default function LeadList({
  leads,
  filterStatus,
  searchQuery,
  region,
  S,
  calcResQuote,
  confirmDeleteRes,
  onView,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onStatusChange,
  onQuote,
  onBook,
  onPay,
}) {
  const filteredLeads = filterLeads(leads, filterStatus, searchQuery);

  if (filteredLeads.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          No leads yet
        </div>
        <div style={{ fontSize: 13 }}>
          {searchQuery || filterStatus !== "All"
            ? "No leads match your current filter."
            : "Add your first residential lead to get started."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {filteredLeads.map(lead => {
        // Compute quote per-card so LeadCard stays purely presentational
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
        } catch {
          q = { total: 0, profit: 0, margin: 0, teamSize: 1, currency: region?.currencySymbol || "CA$" };
        }

        return (
          <LeadCard
            key={lead.id ? String(lead.id) : `${lead.email || ""}${lead.name || ""}`}
            lead={lead}
            q={q}
            region={region}
            S={S}
            confirmDeleteRes={confirmDeleteRes}
            onView={() => onView(lead)}
            onEdit={() => onEdit(lead)}
            onDelete={onDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
            onStatusChange={onStatusChange}
            onQuote={onQuote}
            onBook={onBook}
            onPay={onPay}
          />
        );
      })}
    </div>
  );
}
