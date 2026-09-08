import React from "react";
import { StatusBadge } from "../../components/ui.jsx";

function dayKey(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }
function startOfWeek(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - date.getDay()); return date; }
function addDays(value, days) { const date = new Date(value); date.setDate(date.getDate() + days); return date; }
function time(value) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }

export default function DispatchCalendar({ jobs, weekStart, onWeekChange }) {
  const start = startOfWeek(weekStart);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return <section className="dispatch-panel dispatch-calendar" aria-labelledby="dispatch-calendar-title">
    <header><div><p className="admin-eyebrow">Governed schedule</p><h3 id="dispatch-calendar-title">Dispatch calendar</h3></div><div className="dispatch-calendar__controls"><button onClick={() => onWeekChange(addDays(start, -7))} aria-label="Previous week">Previous</button><button onClick={() => onWeekChange(new Date())}>Today</button><button onClick={() => onWeekChange(addDays(start, 7))} aria-label="Next week">Next</button></div></header>
    <div className="dispatch-calendar__week">{days.map((day) => { const scheduled = jobs.filter((job) => dayKey(job.scheduledStart) === dayKey(day)); return <article key={dayKey(day)}><header><span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{day.getDate()}</strong></header><div>{scheduled.length ? scheduled.map((job) => <div className="dispatch-calendar__job" key={job.id}><time>{time(job.scheduledStart)}</time><strong>{job.customerName}</strong><small>{job.workerNames.join(", ") || "Assignment pending"}</small><StatusBadge tone={job.operationalStatus === "in_progress" ? "warning" : "info"}>{job.operationalStatus.replaceAll("_", " ")}</StatusBadge></div>) : <p>No jobs</p>}</div></article>; })}</div>
  </section>;
}
