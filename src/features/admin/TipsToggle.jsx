import React from "react";

export default function TipsToggle({ enabled, onToggle }) {
  return <button type="button" className={`admin-tips-toggle${enabled ? " is-active" : ""}`} aria-pressed={enabled} aria-label={`${enabled ? "Turn off" : "Turn on"} hover tips`} title={`${enabled ? "Turn off" : "Turn on"} hover tips`} onClick={onToggle}><span aria-hidden="true">💡</span><span>Tips</span></button>;
}
