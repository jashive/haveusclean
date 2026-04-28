import React, { useState } from "react";
import { C } from "../lib/constants";

/**
 * MobileBottomNav
 *
 * Mobile-first bottom navigation bar.
 * Only visible on screens ≤ 768px (controlled via inline style + CSS media query trick).
 * Does NOT replace the existing desktop top navigation.
 *
 * Props:
 *  activeTab   — current active tab string from App.jsx
 *  onTabChange — (tabId: string) => void — same setter as the existing setTab
 */
export default function MobileBottomNav({ activeTab, onTabChange }) {
  const [showMore, setShowMore] = useState(false);

  // ── Primary nav items — map to existing tab IDs ──
  const PRIMARY_TABS = [
    { id: "schedule",  label: "Schedule", icon: "📅" },
    { id: "res",       label: "Leads",    icon: "🏠" },
    { id: "jobs",      label: "Jobs",     icon: "📋" },
    { id: "agent_quote", label: "Quotes", icon: "💬" },
    { id: "more",      label: "More",     icon: "☰"  },
  ];

  // ── "More" sheet items — the rest of the app sections ──
  const MORE_SECTIONS = [
    {
      heading: "Operations",
      items: [
        { id: "dashboard",   label: "Dashboard",      icon: "📊" },
        { id: "gps",         label: "GPS Check-In",   icon: "📍" },
        { id: "recurring",   label: "Recurring",      icon: "🔄" },
        { id: "cold",        label: "Cold Outreach",  icon: "🎯" },
        { id: "intake",      label: "Form Intake",    icon: "📬" },
        { id: "com",         label: "Commercial",     icon: "🏢" },
      ],
    },
    {
      heading: "Partners",
      items: [
        { id: "partners",    label: "Partners",       icon: "👥" },
        { id: "partnerview", label: "Partner View",   icon: "📲" },
        { id: "onboarding",  label: "Onboarding",     icon: "🎓" },
        { id: "pay",         label: "Partner Pay",    icon: "💰" },
      ],
    },
    {
      heading: "AI Tools",
      items: [
        { id: "agent_bidspec",    label: "Bid Spec",      icon: "📄" },
        { id: "agent_workorder",  label: "Work Order",    icon: "🔧" },
        { id: "agent_social",     label: "Social",        icon: "📱" },
        { id: "agent_ops",        label: "Ops Manager",   icon: "🧠" },
      ],
    },
    {
      heading: "Finance",
      items: [
        { id: "stripe",    label: "Payments",     icon: "💳" },
        { id: "qb",        label: "QuickBooks",   icon: "💚" },
        { id: "tax",       label: "Tax",          icon: "🧾" },
      ],
    },
    {
      heading: "Settings",
      items: [
        { id: "portal",      label: "Client Portal", icon: "🌐" },
        { id: "sms",         label: "SMS",           icon: "📱" },
        { id: "whitelabel",  label: "App Store",     icon: "🏷️" },
        { id: "diagnostic",  label: "Diagnostic",    icon: "🔬" },
      ],
    },
  ];

  // ── Styles ──
  const NAV_HEIGHT = 64;

  const st = {
    // Outer wrapper — only shown on mobile via display logic
    // The parent App.jsx should add paddingBottom: NAV_HEIGHT when this is mounted
    wrapper: {
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 500,
      // Mobile only — hide on screens wider than 768px
      // Using a CSS class approach via style tag injection
    },
    nav: {
      height: NAV_HEIGHT,
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      display: "flex",
      alignItems: "stretch",
      paddingBottom: "env(safe-area-inset-bottom, 0px)", // iPhone notch support
      backdropFilter: "blur(12px)",
    },
    tab: (active) => ({
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      border: "none",
      background: "transparent",
      cursor: "pointer",
      padding: "6px 4px",
      WebkitTapHighlightColor: "transparent",
      position: "relative",
    }),
    tabIcon: (active) => ({
      fontSize: 20,
      lineHeight: 1,
      filter: active ? "none" : "grayscale(0.4) opacity(0.6)",
    }),
    tabLabel: (active) => ({
      fontSize: 10,
      fontWeight: active ? 700 : 500,
      color: active ? C.accent : C.muted,
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    }),
    activeDot: {
      position: "absolute",
      top: 6,
      width: 4,
      height: 4,
      borderRadius: "50%",
      background: C.accent,
    },
    // More sheet overlay
    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      zIndex: 499,
    },
    sheet: {
      position: "fixed",
      bottom: NAV_HEIGHT,
      left: 0,
      right: 0,
      zIndex: 500,
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      borderRadius: "16px 16px 0 0",
      maxHeight: "70vh",
      overflowY: "auto",
      padding: "16px 16px 8px",
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      background: C.border,
      margin: "0 auto 16px",
    },
    sectionHeading: {
      fontSize: 11,
      fontWeight: 700,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      marginBottom: 8,
      marginTop: 4,
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 8,
      marginBottom: 16,
    },
    gridItem: (active) => ({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      padding: "10px 4px",
      borderRadius: 10,
      border: "none",
      cursor: "pointer",
      background: active ? C.accentDim : C.card,
      WebkitTapHighlightColor: "transparent",
    }),
    gridIcon: {
      fontSize: 22,
    },
    gridLabel: (active) => ({
      fontSize: 10,
      fontWeight: active ? 700 : 500,
      color: active ? C.accent : C.muted,
      textAlign: "center",
      lineHeight: 1.2,
    }),
  };

  const handleTabPress = (id) => {
    if (id === "more") {
      setShowMore(prev => !prev);
      return;
    }
    setShowMore(false);
    onTabChange(id);
  };

  const handleMoreItemPress = (id) => {
    setShowMore(false);
    onTabChange(id);
  };

  // Determine if any more-item is active
  const primaryIds = new Set(PRIMARY_TABS.filter(t => t.id !== "more").map(t => t.id));
  const moreIsActive = !primaryIds.has(activeTab) && activeTab !== "more";

  return (
    <>
      {/* ── More sheet overlay ── */}
      {showMore && (
        <div style={st.overlay} onClick={() => setShowMore(false)} />
      )}

      {/* ── More sheet ── */}
      {showMore && (
        <div style={st.sheet}>
          <div style={st.sheetHandle} />
          {MORE_SECTIONS.map(section => (
            <div key={section.heading}>
              <div style={st.sectionHeading}>{section.heading}</div>
              <div style={st.grid}>
                {section.items.map(item => (
                  <button
                    key={item.id}
                    style={st.gridItem(activeTab === item.id)}
                    onClick={() => handleMoreItemPress(item.id)}
                  >
                    <span style={st.gridIcon}>{item.icon}</span>
                    <span style={st.gridLabel(activeTab === item.id)}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Bottom navigation bar ── */}
      <div style={st.wrapper}>
        <nav style={st.nav} role="navigation" aria-label="Mobile navigation">
          {PRIMARY_TABS.map(tab => {
            const isMore = tab.id === "more";
            const active = isMore ? (showMore || moreIsActive) : activeTab === tab.id;
            return (
              <button
                key={tab.id}
                style={st.tab(active)}
                onClick={() => handleTabPress(tab.id)}
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
              >
                {active && !isMore && <div style={st.activeDot} />}
                <span style={st.tabIcon(active)}>{tab.icon}</span>
                <span style={st.tabLabel(active)}>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/**
 * useMobileNav
 *
 * Optional hook — returns true when the screen is mobile-sized.
 * Use this in App.jsx to conditionally render MobileBottomNav.
 *
 * Usage in App.jsx:
 *   const isMobile = useMobileNav();
 *   {isMobile && <MobileBottomNav activeTab={tab} onTabChange={setTab} />}
 */
export function useMobileNav() {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return isMobile;
}

/** NAV_HEIGHT exported so App.jsx can add matching paddingBottom to main content */
export const MOBILE_NAV_HEIGHT = 64;
