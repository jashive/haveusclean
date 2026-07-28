export function closeLeadEditModal(setShowEditForm, setEditLead) {
  setShowEditForm(false);
  setEditLead(null);
}

export function updateEditLeadStatus(setEditLead, nextStatus, normalizeStatus = (value) => value) {
  setEditLead((prev) => ({ ...prev, status: normalizeStatus(nextStatus) }));
}

export function updateEditLeadFollowUpDate(setEditLead, nextDate) {
  setEditLead((prev) => ({ ...prev, followUpDate: nextDate }));
}