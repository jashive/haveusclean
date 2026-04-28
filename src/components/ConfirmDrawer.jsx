import React, { useEffect } from "react";
import { C } from "../lib/constants";

/**
 * ConfirmDrawer
 *
 * Mobile-safe confirmation UI that replaces window.confirm.
 * Renders as a bottom sheet on mobile, centered modal on desktop.
 * Does NOT change any delete or business logic — that happens in the next phase.
 *
 * Props:
 *  open          — boolean — whether the drawer is visible
 *  title         — string — bold heading (e.g. "Delete this lead?")
 *  message       — string — supporting detail text (optional)
 *  confirmLabel  — string — confirm button text (default: "Confirm")
 *  cancelLabel   — string — cancel button text (default: "Cancel")
 *  variant       — "danger" | "default" — controls confirm button color
 *  onConfirm     — () => void — called when user confirms
 *  onCancel      — () => void — called when user cancels or taps backdrop
 */
export default function ConfirmDrawer({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel  = "Cancel",
  variant      = "default",
  onConfirm,
  onCancel,
}) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === "danger";

  const confirmColor   = isDanger ? C.red    : C.accent;
  const confirmTextCol = isDanger ? "#fff"   : "#0A0F1E";
  const confirmBg      = isDanger ? C.red    : C.accent;

  const st = {
    // Backdrop
    backdrop: {
      position:   "fixed",
      inset:      0,
      background: "rgba(0,0,0,0.75)",
      zIndex:     600,
      display:    "flex",
      alignItems: "flex-end",       // bottom sheet on mobile
      justifyContent: "center",
    },
    // Sheet / modal
    sheet: {
      background:   C.surface,
      border:       `1px solid ${C.border}`,
      borderRadius: "16px 16px 0 0",
      padding:      "24px 20px",
      width:        "100%",
      maxWidth:     480,
      boxSizing:    "border-box",
      // Slide up animation
      animation:    "confirmSlideUp 0.2s ease-out",
      paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))",
    },
    // Drag handle
    handle: {
      width:        36,
      height:       4,
      borderRadius: 2,
      background:   C.border,
      margin:       "0 auto 20px",
    },
    // Variant icon
    iconWrapper: {
      width:        48,
      height:       48,
      borderRadius: "50%",
      background:   isDanger ? `${C.red}22` : `${C.accent}22`,
      display:      "flex",
      alignItems:   "center",
      justifyContent: "center",
      fontSize:     22,
      margin:       "0 auto 16px",
    },
    title: {
      fontSize:    18,
      fontWeight:  800,
      color:       C.text,
      textAlign:   "center",
      marginBottom: message ? 8 : 24,
      letterSpacing: "-0.2px",
    },
    message: {
      fontSize:    14,
      color:       C.muted,
      textAlign:   "center",
      lineHeight:  1.6,
      marginBottom: 24,
    },
    // Button row
    buttons: {
      display:   "flex",
      flexDirection: "column",
      gap:       10,
    },
    confirmBtn: {
      padding:      "14px",
      borderRadius: 10,
      border:       "none",
      background:   confirmBg,
      color:        confirmTextCol,
      fontSize:     15,
      fontWeight:   800,
      cursor:       "pointer",
      width:        "100%",
      WebkitTapHighlightColor: "transparent",
      letterSpacing: "-0.2px",
    },
    cancelBtn: {
      padding:      "14px",
      borderRadius: 10,
      border:       `1px solid ${C.border}`,
      background:   "transparent",
      color:        C.muted,
      fontSize:     15,
      fontWeight:   600,
      cursor:       "pointer",
      width:        "100%",
      WebkitTapHighlightColor: "transparent",
    },
  };

  const icon = isDanger ? "🗑" : "✅";

  return (
    <>
      {/* Inject keyframe animation once */}
      <style>{`
        @keyframes confirmSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Backdrop — click to cancel */}
      <div
        style={st.backdrop}
        onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div style={st.sheet} onClick={(e) => e.stopPropagation()}>

          {/* Drag handle */}
          <div style={st.handle} />

          {/* Icon */}
          <div style={st.iconWrapper}>{icon}</div>

          {/* Title */}
          <div id="confirm-title" style={st.title}>{title}</div>

          {/* Message */}
          {message && <div style={st.message}>{message}</div>}

          {/* Buttons */}
          <div style={st.buttons}>
            <button
              style={st.confirmBtn}
              onClick={() => onConfirm?.()}
              autoFocus
            >
              {confirmLabel}
            </button>
            <button
              style={st.cancelBtn}
              onClick={() => onCancel?.()}
            >
              {cancelLabel}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
