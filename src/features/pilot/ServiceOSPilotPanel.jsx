import React, { useState, useCallback } from "react";
import {
  capturePricingSnapshot,
  buildServiceRequestPayload,
  buildOpportunityPayload,
  buildEstimatePayload,
  buildQuotePayload,
  buildQuoteVersionPayload,
  buildQuoteResponsePayload,
  buildCustomerPayload,
  buildContactPayload,
  buildServiceLocationPayload,
  buildConversionRecordPayload,
  buildJobHandoffPayload,
} from "../../lib/serviceosRevenueUtils.js";
import { runRevenuePipeline, cleanupPilotSession } from "../../lib/serviceosRevenueClient.js";
import { calcResQuote } from "../../lib/pricing.js";
import { REGIONS } from "../../lib/constants.js";

// ── Feature flag ──────────────────────────────────────────────────────────────

const PILOT_UI_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_REVENUE_PILOT_UI === "true";

// ── Synthetic pilot data ──────────────────────────────────────────────────────

function buildPilotQuoteInput() {
  return {
    dwellingType: "Detached House",
    dwellingSize: "Medium",
    serviceType: "Deep Clean",
    frequency: "One-Time",
    beds: 3,
    baths: 2,
    sqft: 2000,
    addons: [],
  };
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const styles = {
  panel: {
    position: "fixed",
    bottom: 16,
    right: 16,
    width: 360,
    background: "#1A2235",
    border: "1px solid #2d3f5a",
    borderRadius: 8,
    padding: "1.25rem",
    fontFamily: "system-ui, sans-serif",
    color: "#f0f6ff",
    zIndex: 9998,
    boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
  },
  heading: {
    margin: "0 0 0.75rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#00D4AA",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    background: "#f59e0b",
    color: "#000",
    fontSize: "0.65rem",
    padding: "1px 5px",
    borderRadius: 4,
    fontWeight: 700,
  },
  step: { fontSize: "0.8rem", color: "#8899AA", margin: "0.25rem 0" },
  stepDone: { fontSize: "0.8rem", color: "#00D4AA", margin: "0.25rem 0" },
  stepError: { fontSize: "0.8rem", color: "#FF4757", margin: "0.25rem 0" },
  actions: { display: "flex", gap: 8, marginTop: "1rem" },
  btn: {
    flex: 1,
    padding: "0.5rem",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: 500,
  },
  btnRun: { background: "#2563eb", color: "#fff" },
  btnClean: { background: "#4b1c1c", color: "#FF4757" },
  btnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  divider: { borderColor: "#2d3f5a", margin: "0.75rem 0" },
  summary: { fontSize: "0.78rem", color: "#8899AA", marginTop: "0.5rem" },
  summaryValue: { color: "#f0f6ff" },
};

// ── Pipeline runner ───────────────────────────────────────────────────────────

async function runPilot({ orgId, businessUnitId, jurisdictionId, appUserId, accessToken, setLog }) {
  const log = (msg, kind = "step") => setLog((prev) => [...prev, { msg, kind }]);

  // Validate required canonical context before any network calls
  if (!orgId) throw new Error("Pilot requires revenueContext.orgId");
  if (!businessUnitId) throw new Error("Pilot requires revenueContext.primaryBusinessUnitId");
  if (!jurisdictionId) throw new Error("Pilot requires revenueContext.primaryJurisdictionId (HUC-ON jurisdiction_id)");

  log("Computing quote…");
  const region = REGIONS.ON;
  const quoteInput = buildPilotQuoteInput();
  const quote = calcResQuote(quoteInput, region);
  log(`Quote: CA$${quote.total} total (${quote.teamSize} crew, ${quote.jobHours}h)`, "done");

  log("Capturing pricing snapshot…");
  const pricingSnapshotPayload = capturePricingSnapshot({
    quote,
    organizationId: orgId,
    businessUnitId,
    appUserId,
  });
  log("Snapshot built (not yet persisted)", "done");

  log("Building pipeline payloads…");

  const serviceRequestPayload = buildServiceRequestPayload({
    organizationId: orgId,
    businessUnitId,
    serviceCategory: "residential",
    lifecycleStatus: "qualified",
    intakeChannel: "pilot_ui",
    title: "[PILOT] Synthetic Wave 2 service request",
    description: "[PILOT] Synthetic Wave 2 service request",
    metadata: { synthetic: true, source: "pilot_ui" },
    appUserId,
  });

  const opportunityPayload = buildOpportunityPayload({
    organizationId: orgId,
    businessUnitId,
    serviceRequestId: "__pipeline_resolved__",
    stage: "qualified",
    title: "[PILOT] Synthetic opportunity",
    metadata: { synthetic: true },
    appUserId,
  });

  const estimatePayload = buildEstimatePayload({
    organizationId: orgId,
    businessUnitId,
    opportunityId: "__pipeline_resolved__",
    lifecycleStatus: "prepared",
    versionNo: 1,
    scopeSnapshot: quoteInput,
    metadata: { synthetic: true },
    appUserId,
  });

  const quotePayload = buildQuotePayload({
    organizationId: orgId,
    businessUnitId,
    opportunityId: "__pipeline_resolved__",
    lifecycleStatus: "active",
    metadata: { synthetic: true },
    appUserId,
  });

  const quoteVersionPayload = buildQuoteVersionPayload({
    organizationId: orgId,
    businessUnitId,
    quoteId: "__pipeline_resolved__",
    pricingSnapshotId: "__pipeline_resolved__",
    versionNo: 1,
    lineItemsSnapshot: { quoteInput, quoteOutput: quote },
    metadata: { synthetic: true },
    appUserId,
  });

  const quoteResponsePayload = buildQuoteResponsePayload({
    organizationId: orgId,
    businessUnitId,
    quoteVersionId: "__pipeline_resolved__",
    responseType: "accepted",
    responseChannel: "pilot_ui",
    respondedByName: "Pilot User",
    notes: "[PILOT] Synthetic acceptance",
    metadata: { synthetic: true },
    appUserId,
  });

  const customerPayload = buildCustomerPayload({
    organizationId: orgId,
    businessUnitId,
    customerType: "person",
    displayName: "[PILOT] Synthetic Customer",
    metadata: { synthetic: true, source: "pilot_ui" },
  });

  const contactPayload = buildContactPayload({
    customerId: "__pipeline_resolved__",
    contactType: "primary",
    firstName: "Pilot",
    lastName: "Contact",
    email: "pilot-contact@example.invalid",
    phone: null,
    metadata: { synthetic: true },
  });

  const serviceLocationPayload = buildServiceLocationPayload({
    customerId: "__pipeline_resolved__",
    jurisdictionId,
    label: "Pilot Location",
    addressLine1: "123 Pilot Street",
    city: "Toronto",
    subdivision: "ON",
    postalCode: "M5V 0A1",
    countryCode: "CA",
    metadata: { synthetic: true },
  });

  const conversionRecordPayload = buildConversionRecordPayload({
    organizationId: orgId,
    businessUnitId,
    serviceRequestId: "__pipeline_resolved__",
    opportunityId: "__pipeline_resolved__",
    estimateId: "__pipeline_resolved__",
    quoteId: "__pipeline_resolved__",
    quoteVersionId: "__pipeline_resolved__",
    quoteResponseId: "__pipeline_resolved__",
    customerId: "__pipeline_resolved__",
    contactId: "__pipeline_resolved__",
    serviceLocationId: "__pipeline_resolved__",
    metadata: { synthetic: true },
    appUserId,
  });

  const jobHandoffPayload = buildJobHandoffPayload({
    organizationId: orgId,
    businessUnitId,
    conversionRecordId: "__pipeline_resolved__",
    quoteVersionId: "__pipeline_resolved__",
    pricingSnapshotId: "__pipeline_resolved__",
    handoffPayload: { source: "pilot_ui", synthetic: true },
    metadata: { synthetic: true },
    appUserId,
  });

  log("Running revenue pipeline…");

  const created = await runRevenuePipeline({
    serviceRequestPayload,
    opportunityPayload,
    estimatePayload,
    pricingSnapshotPayload,
    quotePayload,
    quoteVersionPayload,
    quoteResponsePayload,
    customerPayload,
    contactPayload,
    serviceLocationPayload,
    conversionRecordPayload,
    jobHandoffPayload,
    accessToken,
  });

  log("Pipeline complete — conversion_record created, Wave 3 job_handoff boundary set", "done");
  return created;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceOSPilotPanel({ session, revenueContext }) {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [createdIds, setCreatedIds] = useState(null);
  const [error, setError] = useState(null);

  const accessToken = session?.access_token;
  const orgId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const jurisdictionId = revenueContext?.primaryJurisdictionId ?? null;
  const appUserId = revenueContext?.appUserId ?? null;

  // Refuse to run if any required canonical context is missing
  const canRun = !!(accessToken && orgId && businessUnitId && jurisdictionId);

  const handleRun = useCallback(async () => {
    if (running || !canRun) return;
    setRunning(true);
    setError(null);
    setLog([]);
    setCreatedIds(null);
    try {
      const created = await runPilot({
        orgId,
        businessUnitId,
        jurisdictionId,
        appUserId,
        accessToken,
        setLog,
      });
      setCreatedIds(created);
    } catch (err) {
      setError(err?.message ?? "Pipeline failed");
      setLog((prev) => [...prev, { msg: err?.message ?? "Pipeline failed", kind: "error" }]);
    } finally {
      setRunning(false);
    }
  }, [running, canRun, accessToken, orgId, businessUnitId, jurisdictionId, appUserId]);

  const handleCleanup = useCallback(async () => {
    if (cleaning || !createdIds || !accessToken) return;
    setCleaning(true);
    setError(null);
    try {
      await cleanupPilotSession(createdIds, accessToken);
      setLog((prev) => [...prev, { msg: "Pilot records cleaned up", kind: "done" }]);
      setCreatedIds(null);
    } catch (err) {
      setError(err?.message ?? "Cleanup failed");
      setLog((prev) => [...prev, { msg: err?.message ?? "Cleanup failed", kind: "error" }]);
    } finally {
      setCleaning(false);
    }
  }, [cleaning, createdIds, accessToken]);

  if (!PILOT_UI_ENABLED) return null;

  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>
        Wave 2 Revenue Pilot <span style={styles.badge}>PILOT</span>
      </h3>

      {log.length > 0 && (
        <>
          {log.map((entry, i) => {
            const s = entry.kind === "done" ? styles.stepDone : entry.kind === "error" ? styles.stepError : styles.step;
            const prefix = entry.kind === "done" ? "✓ " : entry.kind === "error" ? "✗ " : "· ";
            return (
              <div key={i} style={s}>{prefix}{entry.msg}</div>
            );
          })}
          <hr style={styles.divider} />
        </>
      )}

      {createdIds && (
        <div style={styles.summary}>
          Created:{" "}
          {[
            "serviceRequest", "opportunity", "estimate", "pricingSnapshot",
            "quote", "quoteVersion", "quoteResponse",
            "customer", "contact", "serviceLocation",
            "conversionRecord", "jobHandoff",
          ]
            .filter((k) => createdIds[k]?.id)
            .map((k) => (
              <span key={k} style={styles.summaryValue}>
                {k.replace(/([A-Z])/g, " $1").trim()}{" "}
              </span>
            ))}
        </div>
      )}

      {error && <div style={styles.stepError}>✗ {error}</div>}

      <div style={styles.actions}>
        <button
          style={{ ...styles.btn, ...styles.btnRun, ...(!canRun || running ? styles.btnDisabled : {}) }}
          onClick={handleRun}
          disabled={!canRun || running}
          title={!canRun ? "Missing canonical context (orgId / businessUnitId / jurisdictionId)" : ""}
        >
          {running ? "Running…" : "Run Pilot"}
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnClean, ...(!createdIds || cleaning ? styles.btnDisabled : {}) }}
          onClick={handleCleanup}
          disabled={!createdIds || cleaning}
        >
          {cleaning ? "Cleaning…" : "Clean Up"}
        </button>
      </div>

      {!canRun && (
        <div style={{ ...styles.step, marginTop: 6 }}>
          Requires VITE_SERVICEOS_REVENUE_ENABLED + authenticated session with
          orgId, primaryBusinessUnitId, and primaryJurisdictionId in context.
        </div>
      )}
    </div>
  );
}
