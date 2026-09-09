import React from "react";

function LightbulbIcon() {
  return <svg className="admin-tips-toggle__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M8.7 14.2A6 6 0 1 1 15.3 14.2c-.8.6-1.3 1.5-1.3 2.5h-4c0-1-.5-1.9-1.3-2.5Z" /></svg>;
}

export default function TipsToggle({ enabled, onToggle }) {
  return <button type="button" className={`admin-tips-toggle${enabled ? " is-active" : ""}`} aria-pressed={enabled} aria-label="Toggle Tips" title={`${enabled ? "Turn off" : "Turn on"} hover tips`} onClick={onToggle}><LightbulbIcon /><span>Tips</span></button>;
}
