export const RESIDENTIAL_STATUS_TRANSITIONS = {
  New: new Set(["New", "Quoted", "Follow Up", "Booked", "Lost"]),
  Quoted: new Set(["Quoted", "Follow Up", "Booked", "Lost"]),
  "Follow Up": new Set(["Follow Up", "Quoted", "Booked", "Lost"]),
  Booked: new Set(["Booked", "Completed", "Lost"]),
  Completed: new Set(["Completed"]),
  Lost: new Set(["Lost", "New"]),
};

export const COMMERCIAL_STATUS_TRANSITIONS = {
  new: new Set(["new", "quoted", "booked", "paid"]),
  quoted: new Set(["quoted", "booked", "paid"]),
  booked: new Set(["booked", "paid"]),
  paid: new Set(["paid"]),
};

export const JOB_STATUS_TRANSITIONS = {
  scheduled: new Set(["scheduled", "in-progress", "cancelled", "completed"]),
  "in-progress": new Set(["in-progress", "completed", "cancelled"]),
  completed: new Set(["completed"]),
  cancelled: new Set(["cancelled"]),
};

export function canTransitionStatus(fromStatus, toStatus, transitions) {
  const from = String(fromStatus || "").trim();
  const to = String(toStatus || "").trim();
  if (!to) return false;
  if (!from) return true;
  const allowed = transitions[from];
  if (!allowed) return from === to;
  return allowed.has(to);
}
