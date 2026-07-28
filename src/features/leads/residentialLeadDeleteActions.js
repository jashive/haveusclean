const DELETED_RES_LEADS_KEY = "cp:leads_res_deleted";

export function rememberDeletedResidentialLeadId(leadId) {
  const deleteId = String(leadId || "").trim();
  if (!deleteId) return;

  try {
    const existing = JSON.parse(localStorage.getItem(DELETED_RES_LEADS_KEY) || "[]");
    if (!existing.includes(deleteId)) {
      localStorage.setItem(DELETED_RES_LEADS_KEY, JSON.stringify([...existing, deleteId]));
    }
  } catch {}
}

export async function deleteResidentialLeadWorkflow({
  leadId,
  setResLeads,
  deleteRemote,
}) {
  const deleteId = String(leadId || "").trim();
  if (!deleteId) return;

  setResLeads((leads) => leads.filter((lead) => String(lead.id) !== deleteId));
  rememberDeletedResidentialLeadId(deleteId);

  try {
    await deleteRemote(deleteId);
  } catch {}
}