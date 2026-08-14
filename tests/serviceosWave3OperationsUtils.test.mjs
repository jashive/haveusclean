// tests/serviceosWave3OperationsUtils.test.mjs
//
// Tests for serviceosOperationsUtils.js (pure payload builders).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOperationalJobPayload,
  buildScheduleWindowPayload,
  buildWorkerAssignmentPayload,
  buildWorkOrderPayload,
  buildWorkOrderEventPayload,
  buildCompletionEvidencePayload,
  buildChecklistResultPayload,
  buildQaInspectionPayload,
  buildCorrectiveActionPayload,
  buildOperationalHandoffPayload,
  OPERATIONAL_JOB_STATUSES,
  SCHEDULE_WINDOW_STATUSES,
  ASSIGNMENT_ROLES,
  ASSIGNMENT_STATUSES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_EVENT_TYPES,
  EVIDENCE_TYPES,
  CHECKLIST_RESULT_STATUSES,
  QA_INSPECTION_STATUSES,
  QA_INSPECTION_TYPES,
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_TYPES,
  OPERATIONAL_HANDOFF_STATUSES,
} from "../src/lib/serviceosOperationsUtils.js";

// ── shared minimal input ──────────────────────────────────────────────────────

const BASE = {
  organizationId: "org-001",
  businessUnitId: "bu-001",
  jurisdictionId: "jur-001",
};

// ── no import.meta.env dependency ────────────────────────────────────────────

test("serviceosOperationsUtils has no import.meta.env reference", async () => {
  const { readFileSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, "../src/lib/serviceosOperationsUtils.js"), "utf8");
  // Strip comment lines before checking
  const codeOnly = src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.ok(!codeOnly.includes("import.meta.env"), "utils must not reference import.meta.env");
});

// ── no network access ─────────────────────────────────────────────────────────

test("serviceosOperationsUtils has no fetch/authenticatedRestFetch import", async () => {
  const { readFileSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, "../src/lib/serviceosOperationsUtils.js"), "utf8");
  assert.ok(!src.includes("authenticatedRestFetch"), "utils must not call network");
  assert.ok(!src.includes("import { fetch"), "utils must not import fetch");
});

// ── no pricing imports ────────────────────────────────────────────────────────

test("serviceosOperationsUtils does not import pricing modules", async () => {
  const { readFileSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(__dirname, "../src/lib/serviceosOperationsUtils.js"), "utf8");
  assert.ok(!src.includes("pricing.js"), "utils must not import pricing.js");
  assert.ok(!src.includes("quoteEngine"), "utils must not import quoteEngine");
  assert.ok(!src.includes("serviceosRevenueClient"), "utils must not import revenueClient");
});

// ── operational_job builder ───────────────────────────────────────────────────

test("buildOperationalJobPayload: required fields produce correct M007 column names", () => {
  const payload = buildOperationalJobPayload({
    ...BASE,
    jobHandoffId: "jh-001",
    conversionRecordId: "cr-001",
    quoteVersionId: "qv-001",
    pricingSnapshotId: "ps-001",
    customerId: "cust-001",
    contactId: "cont-001",
    serviceLocationId: "sl-001",
    serviceFamily: "residential",
  });
  assert.equal(payload.organization_id, "org-001");
  assert.equal(payload.business_unit_id, "bu-001");
  assert.equal(payload.jurisdiction_id, "jur-001");
  assert.equal(payload.job_handoff_id, "jh-001");
  assert.equal(payload.conversion_record_id, "cr-001");
  assert.equal(payload.quote_version_id, "qv-001");
  assert.equal(payload.pricing_snapshot_id, "ps-001");
  assert.equal(payload.customer_id, "cust-001");
  assert.equal(payload.contact_id, "cont-001");
  assert.equal(payload.service_location_id, "sl-001");
  assert.equal(payload.service_family, "residential");
  assert.equal(payload.operational_status, "ready_to_schedule");
  assert.deepEqual(payload.metadata, {});
  assert.deepEqual(payload.service_scope_snapshot, {});
  assert.deepEqual(payload.commercial_authority_snapshot, {});
});

test("buildOperationalJobPayload: default status is ready_to_schedule", () => {
  const p = buildOperationalJobPayload({
    ...BASE,
    jobHandoffId: "x", conversionRecordId: "x", quoteVersionId: "x",
    pricingSnapshotId: "x", customerId: "x", contactId: "x",
    serviceLocationId: "x", serviceFamily: "commercial",
  });
  assert.equal(p.operational_status, "ready_to_schedule");
});

test("buildOperationalJobPayload: throws on missing required field", () => {
  assert.throws(
    () => buildOperationalJobPayload({ ...BASE }),
    /jobHandoffId is required/
  );
});

test("buildOperationalJobPayload: rejects invalid operational_status", () => {
  assert.throws(
    () =>
      buildOperationalJobPayload({
        ...BASE,
        jobHandoffId: "x", conversionRecordId: "x", quoteVersionId: "x",
        pricingSnapshotId: "x", customerId: "x", contactId: "x",
        serviceLocationId: "x", serviceFamily: "residential",
        operationalStatus: "INVALID_STATUS",
      }),
    /operationalStatus must be one of/
  );
});

test("buildOperationalJobPayload: all valid operational_statuses accepted", () => {
  for (const s of OPERATIONAL_JOB_STATUSES) {
    const p = buildOperationalJobPayload({
      ...BASE,
      jobHandoffId: "x", conversionRecordId: "x", quoteVersionId: "x",
      pricingSnapshotId: "x", customerId: "x", contactId: "x",
      serviceLocationId: "x", serviceFamily: "residential",
      operationalStatus: s,
    });
    assert.equal(p.operational_status, s);
  }
});

test("buildOperationalJobPayload: does not include price/tax/quote calc fields", () => {
  const p = buildOperationalJobPayload({
    ...BASE,
    jobHandoffId: "x", conversionRecordId: "x", quoteVersionId: "x",
    pricingSnapshotId: "x", customerId: "x", contactId: "x",
    serviceLocationId: "x", serviceFamily: "residential",
  });
  const keys = Object.keys(p);
  assert.ok(!keys.includes("price"), "must not have price");
  assert.ok(!keys.includes("tax"), "must not have tax");
  assert.ok(!keys.includes("subtotal"), "must not have subtotal");
});

// ── schedule_window builder ───────────────────────────────────────────────────

test("buildScheduleWindowPayload: default status is planned", () => {
  const p = buildScheduleWindowPayload({
    ...BASE,
    operationalJobId: "oj-1",
    scheduledStart: "2026-09-01T08:00:00Z",
    scheduledEnd: "2026-09-01T12:00:00Z",
    timezone: "America/Toronto",
  });
  assert.equal(p.status, "planned");
  assert.equal(p.timezone, "America/Toronto");
});

test("buildScheduleWindowPayload: rejects end <= start", () => {
  assert.throws(
    () =>
      buildScheduleWindowPayload({
        ...BASE,
        operationalJobId: "oj-1",
        scheduledStart: "2026-09-01T12:00:00Z",
        scheduledEnd: "2026-09-01T08:00:00Z",
        timezone: "America/Toronto",
      }),
    /scheduledEnd must be after scheduledStart/
  );
});

test("buildScheduleWindowPayload: rejects equal start and end", () => {
  assert.throws(
    () =>
      buildScheduleWindowPayload({
        ...BASE,
        operationalJobId: "oj-1",
        scheduledStart: "2026-09-01T10:00:00Z",
        scheduledEnd: "2026-09-01T10:00:00Z",
        timezone: "UTC",
      }),
    /scheduledEnd must be after scheduledStart/
  );
});

test("buildScheduleWindowPayload: rejects invalid status", () => {
  assert.throws(
    () =>
      buildScheduleWindowPayload({
        ...BASE,
        operationalJobId: "oj-1",
        scheduledStart: "2026-09-01T08:00:00Z",
        scheduledEnd: "2026-09-01T12:00:00Z",
        timezone: "UTC",
        status: "bad_status",
      }),
    /status must be one of/
  );
});

// ── worker_assignment builder ─────────────────────────────────────────────────

test("buildWorkerAssignmentPayload: defaults role=service_worker, status=proposed", () => {
  const p = buildWorkerAssignmentPayload({
    ...BASE,
    operationalJobId: "oj-1",
    scheduleWindowId: "sw-1",
    workerId: "w-1",
  });
  assert.equal(p.assignment_role, "service_worker");
  assert.equal(p.assignment_status, "proposed");
  assert.equal(p.worker_id, "w-1");
});

test("buildWorkerAssignmentPayload: rejects invalid role", () => {
  assert.throws(
    () =>
      buildWorkerAssignmentPayload({
        ...BASE,
        operationalJobId: "oj-1",
        scheduleWindowId: "sw-1",
        workerId: "w-1",
        assignmentRole: "manager",
      }),
    /assignmentRole must be one of/
  );
});

test("buildWorkerAssignmentPayload: all valid roles accepted", () => {
  for (const role of ASSIGNMENT_ROLES) {
    const p = buildWorkerAssignmentPayload({
      ...BASE,
      operationalJobId: "oj-1",
      scheduleWindowId: "sw-1",
      workerId: "w-1",
      assignmentRole: role,
    });
    assert.equal(p.assignment_role, role);
  }
});

// ── work_order builder ────────────────────────────────────────────────────────

test("buildWorkOrderPayload: default status is draft", () => {
  const p = buildWorkOrderPayload({
    ...BASE,
    operationalJobId: "oj-1",
  });
  assert.equal(p.work_order_status, "draft");
  assert.deepEqual(p.pricing_reference_snapshot, {});
});

test("buildWorkOrderPayload: rejects invalid status", () => {
  assert.throws(
    () =>
      buildWorkOrderPayload({
        ...BASE,
        operationalJobId: "oj-1",
        workOrderStatus: "pending",
      }),
    /workOrderStatus must be one of/
  );
});

// ── work_order_event builder ──────────────────────────────────────────────────

test("buildWorkOrderEventPayload: valid event_type accepted", () => {
  const p = buildWorkOrderEventPayload({
    organizationId: "org-001",
    businessUnitId: "bu-001",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    eventType: "arrived",
  });
  assert.equal(p.event_type, "arrived");
  assert.ok(p.event_at, "event_at should be set");
});

test("buildWorkOrderEventPayload: rejects invalid event_type", () => {
  assert.throws(
    () =>
      buildWorkOrderEventPayload({
        organizationId: "org-001",
        businessUnitId: "bu-001",
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        eventType: "invoice_created",
      }),
    /eventType must be one of/
  );
});

// ── completion_evidence builder ───────────────────────────────────────────────

test("buildCompletionEvidencePayload: rejects invalid evidenceType", () => {
  assert.throws(
    () =>
      buildCompletionEvidencePayload({
        organizationId: "org-001",
        businessUnitId: "bu-001",
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        evidenceType: "base64_binary",
        capturedAt: new Date().toISOString(),
      }),
    /evidenceType must be one of/
  );
});

test("buildCompletionEvidencePayload: evidence_payload is object (no binary)", () => {
  const p = buildCompletionEvidencePayload({
    organizationId: "org-001",
    businessUnitId: "bu-001",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    evidenceType: "note",
    evidencePayload: { note: "ref-only" },
    capturedAt: "2026-09-01T10:00:00Z",
  });
  assert.equal(typeof p.evidence_payload, "object");
  assert.ok(!Object.values(p.evidence_payload).some((v) => typeof v === "string" && v.length > 1000),
    "no large binary content in evidence_payload");
});

// ── checklist_result builder ──────────────────────────────────────────────────

test("buildChecklistResultPayload: default result_status is pending", () => {
  const p = buildChecklistResultPayload({
    organizationId: "org-001",
    businessUnitId: "bu-001",
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    checklistItemKey: "item_01",
    checklistItemLabel: "Item 01",
  });
  assert.equal(p.result_status, "pending");
});

test("buildChecklistResultPayload: rejects invalid result_status", () => {
  assert.throws(
    () =>
      buildChecklistResultPayload({
        organizationId: "org-001",
        businessUnitId: "bu-001",
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        checklistItemKey: "item_01",
        checklistItemLabel: "Item 01",
        resultStatus: "skipped",
      }),
    /resultStatus must be one of/
  );
});

test("buildChecklistResultPayload: valid statuses pass, fail, not_applicable accepted", () => {
  for (const s of ["pass", "fail", "not_applicable"]) {
    const p = buildChecklistResultPayload({
      organizationId: "org-001",
      businessUnitId: "bu-001",
      operationalJobId: "oj-1",
      workOrderId: "wo-1",
      checklistItemKey: "item_x",
      checklistItemLabel: "X",
      resultStatus: s,
    });
    assert.equal(p.result_status, s);
  }
});

// ── qa_inspection builder ─────────────────────────────────────────────────────

test("buildQaInspectionPayload: defaults pending/standard", () => {
  const p = buildQaInspectionPayload({
    ...BASE,
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
  });
  assert.equal(p.inspection_status, "pending");
  assert.equal(p.inspection_type, "standard");
});

test("buildQaInspectionPayload: rejects invalid inspection_status", () => {
  assert.throws(
    () =>
      buildQaInspectionPayload({
        ...BASE,
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        inspectionStatus: "approved",
      }),
    /inspectionStatus must be one of/
  );
});

test("buildQaInspectionPayload: valid QA types accepted", () => {
  for (const t of QA_INSPECTION_TYPES) {
    const p = buildQaInspectionPayload({
      ...BASE,
      operationalJobId: "oj-1",
      workOrderId: "wo-1",
      inspectionType: t,
    });
    assert.equal(p.inspection_type, t);
  }
});

// ── corrective_action builder ─────────────────────────────────────────────────

test("buildCorrectiveActionPayload: default action_status is open", () => {
  const p = buildCorrectiveActionPayload({
    ...BASE,
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    actionType: "rework",
    description: "Re-clean bathroom",
  });
  assert.equal(p.action_status, "open");
  assert.equal(p.action_type, "rework");
});

test("buildCorrectiveActionPayload: rejects invalid action_type", () => {
  assert.throws(
    () =>
      buildCorrectiveActionPayload({
        ...BASE,
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        actionType: "price_adjustment",
        description: "d",
      }),
    /actionType must be one of/
  );
});

// ── operational_handoff builder ───────────────────────────────────────────────

test("buildOperationalHandoffPayload: default handoff_status is ready", () => {
  const p = buildOperationalHandoffPayload({
    ...BASE,
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    pricingSnapshotId: "ps-1",
    quoteVersionId: "qv-1",
  });
  assert.equal(p.handoff_status, "ready");
  assert.deepEqual(p.handoff_payload, {});
});

test("buildOperationalHandoffPayload: rejects invalid handoff_status", () => {
  assert.throws(
    () =>
      buildOperationalHandoffPayload({
        ...BASE,
        operationalJobId: "oj-1",
        workOrderId: "wo-1",
        pricingSnapshotId: "ps-1",
        quoteVersionId: "qv-1",
        handoffStatus: "paid",
      }),
    /handoffStatus must be one of/
  );
});

test("buildOperationalHandoffPayload: does not create invoice/payment fields", () => {
  const p = buildOperationalHandoffPayload({
    ...BASE,
    operationalJobId: "oj-1",
    workOrderId: "wo-1",
    pricingSnapshotId: "ps-1",
    quoteVersionId: "qv-1",
  });
  const keys = Object.keys(p);
  assert.ok(!keys.includes("invoice_id"), "must not create invoice");
  assert.ok(!keys.includes("payment_id"), "must not create payment");
});
