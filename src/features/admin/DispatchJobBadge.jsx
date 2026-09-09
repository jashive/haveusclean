import React from "react";
import { dispatchJobBadge } from "../../lib/serviceosPipelineDispatch.js";

export default function DispatchJobBadge({ job }) {
  const badge = dispatchJobBadge(job);
  return <span className={`dispatch-kind-badge dispatch-kind-badge--${badge.tone}`}>{badge.label}</span>;
}
