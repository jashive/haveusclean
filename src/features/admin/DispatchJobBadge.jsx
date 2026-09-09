import React from "react";
import { dispatchJobBadge } from "../../lib/serviceosPipelineDispatch.js";

export default function DispatchJobBadge({ job }) {
  const badge = dispatchJobBadge(job);
  return <span className={`dispatch-kind-badge dispatch-kind-badge--${badge.tone}`} data-tip={job.isCommercial ? "Commercial facility inquiry — requires square footage walkthrough inspection." : undefined}>{badge.label}</span>;
}
