import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { positionServiceOSTip } from "../../lib/serviceosLearnability.js";

export default function TipLayer({ enabled, onDisable }) {
  const [active, setActive] = useState(null); const [style, setStyle] = useState({}); const pillRef = useRef(null); const closeTimer = useRef(null);
  const close = useCallback(() => { window.clearTimeout(closeTimer.current); setActive(null); }, []);
  const scheduleClose = useCallback(() => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(close, 120); }, [close]);
  const place = useCallback(() => {
    if (!active?.node?.isConnected || !pillRef.current) return;
    const rect = active.node.getBoundingClientRect(); const pill = pillRef.current.getBoundingClientRect();
    setStyle(positionServiceOSTip(rect, { width: pill.width || 300, height: pill.height || 48 }, { width: window.innerWidth, height: window.innerHeight }));
  }, [active]);
  useEffect(() => {
    if (!enabled) { setActive(null); return undefined; }
    const enter = (event) => { const node = event.target?.closest?.("[data-tip]"); if (node?.dataset.tip) { window.clearTimeout(closeTimer.current); setActive({ node, text: node.dataset.tip }); } };
    const leave = (event) => { const node = event.target?.closest?.("[data-tip]"); if (node && !node.contains(event.relatedTarget)) scheduleClose(); };
    document.addEventListener("pointerover", enter); document.addEventListener("pointerout", leave); document.addEventListener("focusin", enter); document.addEventListener("focusout", leave);
    return () => { document.removeEventListener("pointerover", enter); document.removeEventListener("pointerout", leave); document.removeEventListener("focusin", enter); document.removeEventListener("focusout", leave); window.clearTimeout(closeTimer.current); };
  }, [enabled, scheduleClose]);
  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => { if (!active) return undefined; window.addEventListener("resize", place); window.addEventListener("scroll", place, true); return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); }; }, [active, place]);
  useEffect(() => { const escape = (event) => event.key === "Escape" && close(); document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [close]);
  return enabled && active ? <aside ref={pillRef} className="serviceos-tip-pill" role="tooltip" style={style} onPointerEnter={() => window.clearTimeout(closeTimer.current)} onPointerLeave={scheduleClose}><span>{active.text}<button className="serviceos-tip-pill__disable" type="button" onClick={onDisable}>Don’t show tips again</button></span><button type="button" onClick={close} aria-label="Dismiss tip">×</button></aside> : null;
}
