import React from "react";
import { StatusBadge } from "../../components/ui.jsx";
import TipsToggle from "./TipsToggle.jsx";

export default function AdminTopBar({ marketControl, tipsEnabled, onToggleTips, onOpenHelp }) {
  return <header className="admin-commercial-topbar"><div><p className="admin-eyebrow">Have Us Clean · ServiceOS</p><h2>Operations command center</h2></div><div className="admin-topbar-actions">{marketControl}<StatusBadge tone="success">Live</StatusBadge><TipsToggle enabled={tipsEnabled} onToggle={onToggleTips} /><button className="admin-help-button" onClick={onOpenHelp} aria-haspopup="dialog">Help</button></div></header>;
}
