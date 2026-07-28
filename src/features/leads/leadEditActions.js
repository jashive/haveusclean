export function saveEditedLead({ editLead, setResLeads, dbSet, dbKey }) {
  if (!editLead) return;

  setResLeads((leads) => {
    const next = leads.map((lead) => (lead.id === editLead.id ? editLead : lead));
    dbSet(dbKey, next);
    return next;
  });
}

export async function deleteEditedLead({
  editLead,
  setResLeads,
  dbSet,
  dbKey,
  deleteRemote,
}) {
  const leadId = String(editLead?.id || "");

  setResLeads((leads) => {
    const next = leads.filter((lead) => lead.id !== editLead?.id);
    dbSet(dbKey, next);
    return next;
  });

  try {
    await deleteRemote(leadId);
  } catch {}
}