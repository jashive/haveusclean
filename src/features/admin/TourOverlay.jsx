import React, { useEffect, useRef, useState } from "react";

function targetRect(selector) {
  const target = document.querySelector(selector);
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return { top: Math.max(8, rect.top - 6), left: Math.max(8, rect.left - 6), width: Math.min(window.innerWidth - 16, rect.width + 12), height: Math.min(window.innerHeight - 16, rect.height + 12) };
}

export default function TourOverlay({ steps, stepIndex, onStep, onExit, onWorkspaceChange }) {
  const step = steps[stepIndex]; const [rect, setRect] = useState(null); const dialogRef = useRef(null);
  useEffect(() => { onWorkspaceChange(step.workspace); }, [step.workspace, onWorkspaceChange]);
  useEffect(() => {
    const update = () => setRect(targetRect(step.selector)); update();
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    const timer = window.setTimeout(() => { update(); document.querySelector(step.selector)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 120);
    return () => { observer.disconnect(); window.clearTimeout(timer); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [step.selector]);
  useEffect(() => { dialogRef.current?.focus(); const key = (event) => { if (event.key === "Escape") onExit(); if (event.key === "ArrowRight") onStep(Math.min(steps.length - 1, stepIndex + 1)); if (event.key === "ArrowLeft") onStep(Math.max(0, stepIndex - 1)); if (event.key !== "Tab") return; const nodes = dialogRef.current?.querySelectorAll("button"); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onExit, onStep, stepIndex, steps.length]);
  return <div className="serviceos-tour" aria-live="polite"><div className="serviceos-tour__spotlight" style={rect || undefined} /><section ref={dialogRef} className="serviceos-tour__card" role="dialog" aria-modal="true" aria-labelledby="serviceos-tour-title" tabIndex={-1}><span>Step {stepIndex + 1} of {steps.length}</span><h2 id="serviceos-tour-title">{step.title}</h2><p>{step.body}</p><footer><button className="huc-button huc-button--secondary" onClick={onExit}>Skip tour</button><div>{stepIndex ? <button className="huc-button huc-button--secondary" onClick={() => onStep(stepIndex - 1)}>Back</button> : null}<button className="huc-button" onClick={() => stepIndex === steps.length - 1 ? onExit() : onStep(stepIndex + 1)}>{stepIndex === steps.length - 1 ? "Finish" : "Next"}</button></div></footer><small>Use ← and → to move · Esc to close</small></section></div>;
}
