export const ROOM_SEQUENCE = Object.freeze([
  { id: "bathrooms", title: "Bathrooms first", share: 0.25, protocols: ["Apply shower descaler first when included.", "Clean top-to-bottom and clockwise; finish fixtures and mirrors."] },
  { id: "kitchen", title: "Kitchen", share: 0.25, protocols: ["Apply oven product first when included.", "Work top-to-bottom and clockwise; use kitchen-designated cloths."] },
  { id: "bedrooms", title: "Bedrooms", share: 0.20, protocols: ["Start high with dusting, then work clockwise around the room.", "Reset surfaces before moving to the next zone."] },
  { id: "living", title: "Living areas", share: 0.15, protocols: ["Dust high-to-low and follow a clockwise path.", "Check touchpoints, edges, and visible presentation details."] },
  { id: "floors", title: "Floors last — out the door", share: 0.15, protocols: ["Vacuum before damp floor work.", "Work toward the exit and complete the final quality walkthrough."] },
]);

export function scheduledDurationMinutes(context) {
  const start = Date.parse(context?.scheduled_start || "");
  const end = Date.parse(context?.scheduled_end || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

export function allocateZoneBudgets(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return ROOM_SEQUENCE.map((zone) => ({ ...zone, minutes: null }));
  let allocated = 0;
  return ROOM_SEQUENCE.map((zone, index) => {
    const minutes = index === ROOM_SEQUENCE.length - 1 ? totalMinutes - allocated : Math.round(totalMinutes * zone.share);
    allocated += minutes;
    return { ...zone, minutes };
  });
}

export function dwellTimeAlerts(addons = []) {
  const normalized = addons.map((item) => String(item).toLowerCase());
  const alerts = [];
  if (normalized.some((item) => item.includes("oven"))) alerts.push({ id: "oven", title: "Oven dwell time", minutes: 15, prompt: "Apply the approved oven product first and follow its label and SDS." });
  if (normalized.some((item) => item.includes("descaler") || item.includes("shower"))) alerts.push({ id: "shower-descaler", title: "Shower descaler dwell time", minutes: 10, prompt: "Apply the approved descaler first; never exceed label dwell time." });
  return alerts;
}
