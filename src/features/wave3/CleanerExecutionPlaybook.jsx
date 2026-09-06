import React, { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { allocateZoneBudgets, dwellTimeAlerts, scheduledDurationMinutes } from "../../lib/cleanerExecutionPlaybook.js";

function DwellTimeAlert({ alert }) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => { if (remaining === null || remaining <= 0) return undefined; const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [remaining]);
  const seconds = remaining ?? alert.minutes * 60;
  return <article className="dwell-alert"><div><strong>{alert.title}</strong><p>{alert.prompt}</p></div><div className="dwell-alert__timer"><time aria-live="polite">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</time><button type="button" onClick={() => setRemaining(alert.minutes * 60)}>{remaining === null ? "Start timer" : "Restart"}</button></div></article>;
}

export default function CleanerExecutionPlaybook({ context, addons }) {
  const totalMinutes = scheduledDurationMinutes(context);
  const zones = useMemo(() => allocateZoneBudgets(totalMinutes), [totalMinutes]);
  const alerts = useMemo(() => dwellTimeAlerts(addons), [addons]);
  return <section className="execution-playbook" aria-labelledby="execution-playbook-title">
    <header><div><p className="admin-eyebrow">Active execution mode</p><h3 id="execution-playbook-title">Room-by-room playbook</h3><p>Work top-to-bottom and clockwise in every zone.</p></div><StatusBadge tone="success">Job in progress</StatusBadge></header>
    {alerts.length ? <div className="dwell-alerts" aria-label="Chemical dwell-time alerts">{alerts.map((alert) => <DwellTimeAlert key={alert.id} alert={alert} />)}</div> : null}
    <ol className="execution-sequence">{zones.map((zone, index) => <li key={zone.id}><span className="execution-sequence__number">{index + 1}</span><div><div className="execution-sequence__title"><strong>{zone.title}</strong><StatusBadge tone="info">{zone.minutes === null ? "Time not scheduled" : `${zone.minutes} min target`}</StatusBadge></div><ul>{zone.protocols.map((protocol) => <li key={protocol}>{protocol}</li>)}</ul></div></li>)}</ol>
  </section>;
}
