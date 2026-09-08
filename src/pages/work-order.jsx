import React from "react";
import { useServiceOSContext } from "../auth/ServiceOSAuthGate.jsx";
import { WorkerOperations } from "../features/wave3/ServiceOSOperationsWorkspace.jsx";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function WorkOrderPage({ workOrderId }) {
  const context = useServiceOSContext();
  const role = context?.revenueContext?.roleCode;
  if (!UUID_PATTERN.test(workOrderId || "")) return <main className="field-route-shell"><div className="financial-alert" role="alert">The work-order link is invalid.</div></main>;
  if (role !== "worker") return <main className="field-route-shell"><div className="financial-alert" role="alert">This route is restricted to the assigned technician.</div></main>;
  return <main className="field-route-shell" data-mobile-work-order-route={workOrderId}><WorkerOperations revenueContext={context.revenueContext} targetWorkOrderId={workOrderId} dedicated /></main>;
}
