export const SERVICEOS_TOUR_STORAGE_KEY = "serviceos:admin-tour:v1";
export const SERVICEOS_TIPS_STORAGE_KEY = "serviceos_tips_enabled";

export const SERVICEOS_TOUR_STEPS = Object.freeze([
  { id: "flight-control", workspace: "flight-control", selector: '[data-tour="flight-control-cards"]', title: "Run today from Flight Control", body: "Track accepted work through dispatch, field execution, QA, and cleaner settlement from one board." },
  { id: "dispatch", workspace: "pipeline-dispatch", selector: '[data-tour="dispatch-schedule"]', title: "Schedule and dispatch", body: "Place unscheduled work, review the territory calendar, and search every governed work order." },
  { id: "team", workspace: "team-hiring", selector: '[data-tour="team-activation"]', title: "Activate a dispatch-ready team", body: "Review applicant progress, verify readiness, and control which contractors can receive work." },
  { id: "financials", workspace: "financial-ledgers", selector: '[data-tour="payout-settlement"]', title: "Approve earned payouts", body: "Review accrued labor, approve governed liabilities, and monitor realized job profitability." },
]);

export const WORKSPACE_HELP = Object.freeze({
  "flight-control": { title: "Flight Control", steps: ["Assign every inbound job before its service window.", "Monitor clocked-in work and completion evidence.", "Pass or waive QA, then approve the staged payout."] },
  "pipeline-dispatch": { title: "Pipeline & Dispatch", steps: ["Review the unscheduled queue for the active territory.", "Assign a qualified cleaner and confirm the calendar slot.", "Use work-order history to resolve customer or schedule questions."] },
  "team-hiring": { title: "Team & Hiring", steps: ["Open an applicant card and complete the compliance review.", "Advance only qualified applicants to operable status.", "Use dispatch readiness to control assignment eligibility."] },
  "financial-ledgers": { title: "Financial Ledgers", steps: ["Confirm labor accrual and margin in the KPI ribbon.", "Approve pending contractor liabilities.", "Record external disbursement evidence in payment history after funds are sent."] },
});

export function hasCompletedServiceOSTour(storage = globalThis?.localStorage) {
  try { return storage?.getItem(SERVICEOS_TOUR_STORAGE_KEY) === "completed"; } catch { return false; }
}

export function completeServiceOSTour(storage = globalThis?.localStorage) {
  try { storage?.setItem(SERVICEOS_TOUR_STORAGE_KEY, "completed"); } catch { /* Browser storage may be unavailable. */ }
}

export function serviceOSTipsEnabled(storage = globalThis?.localStorage) {
  try { return storage?.getItem(SERVICEOS_TIPS_STORAGE_KEY) !== "false"; } catch { return true; }
}

export function persistServiceOSTips(enabled, storage = globalThis?.localStorage) {
  try { storage?.setItem(SERVICEOS_TIPS_STORAGE_KEY, String(Boolean(enabled))); } catch { /* Browser storage may be unavailable. */ }
}

export function positionServiceOSTip(rect, size, viewport, gap = 10) {
  const width = Math.min(size.width, viewport.width - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, viewport.width - width - 12));
  const below = rect.bottom + gap + size.height <= viewport.height - 12;
  const top = below ? rect.bottom + gap : Math.max(12, rect.top - gap - size.height);
  return { left, top, width };
}
