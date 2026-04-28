import React from "react";
import { C, HUC_STATUS_COLOR } from "../lib/constants";

export default function StatusBadge({ status, color, style = {} }) {
  const badgeColor = color || HUC_STATUS_COLOR[status] || C.muted;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        background: `${badgeColor}22`,
        color: badgeColor,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {status}
    </span>
  );
}
