// ── Wave 4 Runtime Tests ─────────────────────────────────────────────────────
// Tests for src/lib/serviceosWave4Runtime.js and related source-level controls.
// NO database calls. All async functions are exercised with stub injection or
// by inspecting pure-function behaviour.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildProviderNeutralEvidenceReference,
  assessWave4Readiness,
} from "../src/lib/serviceosWave4Runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const runtimeSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosWave4Runtime.js"),
  "utf8"
);
const panelSrc = readFileSync(
  resolve(ROOT, "src/features/pilot/ServiceOSWave4PilotPanel.jsx"),
  "utf8"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    is_mandatory: true,
    requirement_key: "photo_after_kitchen",
    evidence_type: "photo",
    required_count: 1,
    requires_external_reference: false,
    ...overrides,
  };
}

function makeEvidence(overrides = {}) {
  return {
    id: "ev-1",
    operational_job_id: "job-1",
    work_order_id: "wo-1",
    evidence_type: "photo",
    evidence_payload: { requirement_key: "photo_after_kitchen" },
    storage_system: "s3",
    storage_reference: "bucket/path.jpg",
    ...overrides,
  };
}

function makeQa(overrides = {}) {
  return {
    id: "qa-1",
    inspection_status: "passed",
    operational_job_id: "job-1",
    work_order_id: "wo-1",
    ...overrides,
  };
}

function makeCa(overrides = {}) {
  return {
    id: "ca-1",
    action_status: "verified",
    operational_job_id: "job-1",
    work_order_id: "wo-1",
    ...overrides,
  };
}

function makeApplicability(overrides = {}) {
  return {
    applicability_status: "enrolled",
    operational_job_id: "job-1",
    work_order_id: "wo-1",
    ...overrides,
  };
}

function makeGovernanceLink() {
  return { id: "gov-1", operational_job_id: "job-1", work_order_id: "wo-1" };
}

// ── Provider-Neutral Evidence ─────────────────────────────────────────────────

test("1. buildProviderNeutralEvidenceReference: blank provider rejected", () => {
  assert.throws(
    () => buildProviderNeutralEvidenceReference({ provider: "", reference: "bucket/a.jpg" }),
    /provider must be nonblank/
  );
});

test("2. buildProviderNeutralEvidenceReference: blank reference rejected", () => {
  assert.throws(
    () => buildProviderNeutralEvidenceReference({ provider: "s3", reference: "   " }),
    /reference must be nonblank/
  );
});

test("3. buildProviderNeutralEvidenceReference: base64/data URI rejected", () => {
  assert.throws(
    () =>
      buildProviderNeutralEvidenceReference({
        provider: "s3",
        reference: "data:image/png;base64,abc123",
      }),
    /base64 data URIs are not allowed/
  );
});

test("4. attachProviderNeutralEvidence readback checks id (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.id === created.id"),
    "readback must check e.id === created.id"
  );
});

test("5. attachProviderNeutralEvidence readback checks operational_job_id (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.operational_job_id === operationalJobId"),
    "readback must check operational_job_id"
  );
});

test("6. attachProviderNeutralEvidence readback checks work_order_id (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.work_order_id === workOrderId"),
    "readback must check work_order_id"
  );
});

test("7. attachProviderNeutralEvidence readback checks evidence_type (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.evidence_type === requirement.evidence_type"),
    "readback must check evidence_type"
  );
});

test("8. attachProviderNeutralEvidence readback checks requirement_key (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.evidence_payload?.requirement_key === requirement.requirement_key"),
    "readback must check requirement_key"
  );
});

test("9. attachProviderNeutralEvidence readback checks storage_system (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.storage_system === ref.storageSystem"),
    "readback must check storage_system"
  );
});

test("10. attachProviderNeutralEvidence readback checks storage_reference (source)", () => {
  assert.ok(
    runtimeSrc.includes("e.storage_reference === ref.storageReference"),
    "readback must check storage_reference"
  );
});

// ── assessWave4Readiness ──────────────────────────────────────────────────────

test("11. assessWave4Readiness: false with unresolved scope (no IDs)", () => {
  const r = assessWave4Readiness({
    // no explicit operationalJobId/workOrderId; all fallback sources also null
    applicability: makeApplicability({ operational_job_id: null, work_order_id: null }),
    governanceLink: { id: "gov-1", operational_job_id: null, work_order_id: null },
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.readyToClose, false);
});

test("12. assessWave4Readiness: false without enrollment", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability({ applicability_status: "pending" }),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.readyToClose, false);
  assert.equal(r.enrolled, false);
});

test("13. assessWave4Readiness: false without governance link", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: null,
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.readyToClose, false);
  assert.equal(r.hasGovernance, false);
});

test("14. assessWave4Readiness: false without requirements", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.readyToClose, false);
  assert.equal(r.hasRequirements, false);
});

test("15. assessWave4Readiness: evidence_type-only match does not satisfy", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [
      makeEvidence({
        evidence_payload: { requirement_key: "WRONG_KEY" }, // correct type, wrong key
      }),
    ],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
  assert.ok(r.missingRequirementKeys.includes("photo_after_kitchen"));
});

test("16. assessWave4Readiness: requirement_key-only match does not satisfy", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [
      makeEvidence({
        evidence_type: "video", // correct key, wrong type
      }),
    ],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("17. assessWave4Readiness: evidence from wrong work_order does not satisfy", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence({ work_order_id: "wo-OTHER" })],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("18. assessWave4Readiness: evidence from wrong operational_job does not satisfy", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence({ operational_job_id: "job-OTHER" })],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("19. assessWave4Readiness: required_count enforced", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq({ required_count: 2 })],
    evidence: [makeEvidence()], // only 1, need 2
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("20. assessWave4Readiness: external storage_system required when requires_external_reference", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq({ requires_external_reference: true })],
    evidence: [makeEvidence({ storage_system: "" })],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("21. assessWave4Readiness: external storage_reference required when requires_external_reference", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq({ requires_external_reference: true })],
    evidence: [makeEvidence({ storage_reference: "   " })],
    qaInspections: [makeQa()],
    correctiveActions: [],
  });
  assert.equal(r.mandatoryEvidenceSatisfied, false);
});

test("22. assessWave4Readiness: QA from wrong job/work_order does not satisfy", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa({ operational_job_id: "job-OTHER", work_order_id: "wo-OTHER" })],
    correctiveActions: [],
  });
  assert.equal(r.qaSatisfied, false);
  assert.equal(r.readyToClose, false);
});

test("23. assessWave4Readiness: unresolved CA from same scope blocks close", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [makeCa({ action_status: "open" })],
  });
  assert.equal(r.correctiveActionsSatisfied, false);
  assert.ok(r.blockingCorrectiveActionIds.includes("ca-1"));
  assert.equal(r.readyToClose, false);
});

test("24. assessWave4Readiness: CA from another scope does not block", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [
      makeCa({ action_status: "open", operational_job_id: "job-OTHER", work_order_id: "wo-OTHER" }),
    ],
  });
  assert.equal(r.correctiveActionsSatisfied, true);
});

test("25. assessWave4Readiness: full valid state returns readyToClose=true", () => {
  const r = assessWave4Readiness({
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    applicability: makeApplicability(),
    governanceLink: makeGovernanceLink(),
    requirements: [makeReq()],
    evidence: [makeEvidence()],
    qaInspections: [makeQa()],
    correctiveActions: [makeCa({ action_status: "verified" })],
  });
  assert.equal(r.readyToClose, true);
});

// ── Exception/rework source-level invariants ──────────────────────────────────

test("26. runExceptionReworkFlow: source type is qa (source)", () => {
  assert.ok(
    runtimeSrc.includes('sourceType: "qa"'),
    "exception sourceType must be \"qa\""
  );
  assert.ok(
    !runtimeSrc.includes('sourceType: "qa_failure"'),
    "must not contain deprecated sourceType \"qa_failure\""
  );
});

test("27. runExceptionReworkFlow: default category is service_quality (source)", () => {
  assert.ok(
    runtimeSrc.includes('exceptionCategory = "service_quality"'),
    "default exceptionCategory must be \"service_quality\""
  );
  assert.ok(
    !runtimeSrc.includes('exceptionCategory = "quality"'),
    "must not default exceptionCategory to \"quality\""
  );
});

test("28. runExceptionReworkFlow: actorAppUserId supplied (source)", () => {
  assert.ok(
    runtimeSrc.includes("actorAppUserId: appUserId"),
    "service_exception payload must include actorAppUserId: appUserId"
  );
});

test("29. runExceptionReworkFlow: corrective action linked before ready_for_reinspection (source)", () => {
  const linkIdx = runtimeSrc.indexOf("linkServiceExceptionCorrectiveAction");
  const readyIdx = runtimeSrc.indexOf('"ready_for_reinspection"');
  assert.ok(linkIdx > -1, "linkServiceExceptionCorrectiveAction must exist");
  assert.ok(readyIdx > -1, '"ready_for_reinspection" must exist');
  assert.ok(linkIdx < readyIdx, "CA must be linked before ready_for_reinspection transition");
});

test("30. runExceptionReworkFlow: reinspection uses inspection_type=reinspection (source)", () => {
  assert.ok(
    runtimeSrc.includes('inspectionType: "reinspection"'),
    "reinspection payload must have inspectionType: \"reinspection\""
  );
});

test("31. runExceptionReworkFlow: reinspection uses inspectorAppUserId (source)", () => {
  assert.ok(
    runtimeSrc.includes("inspectorAppUserId: appUserId"),
    "reinspection buildQaInspectionPayload call must use inspectorAppUserId: appUserId"
  );
});

test("32. runExceptionReworkFlow: original failed QA ID never passed to updateQaInspectionStatus (source)", () => {
  // Extract the runExceptionReworkFlow function body
  const fnStart = runtimeSrc.indexOf("export async function runExceptionReworkFlow");
  const fnEnd = runtimeSrc.indexOf("\nexport ", fnStart + 1);
  const fnBody = runtimeSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  // All updateQaInspectionStatus calls in the function must use reinspection.id, not failedQaInspectionId
  const updateQaCallRegex = /updateQaInspectionStatus\(([^,]+),/g;
  let m;
  while ((m = updateQaCallRegex.exec(fnBody)) !== null) {
    const firstArg = m[1].trim();
    assert.notEqual(
      firstArg,
      "failedQaInspectionId",
      `updateQaInspectionStatus must not be called with failedQaInspectionId (got: ${firstArg})`
    );
  }
});

// ── Fail-closed reads (source-level) ─────────────────────────────────────────

test("33. loadWave4QualitySignals: does not contain catch-to-empty-array fallback (source)", () => {
  // Extract the loadWave4QualitySignals function body
  const fnStart = runtimeSrc.indexOf("export async function loadWave4QualitySignals");
  const fnEnd = runtimeSrc.indexOf("\nexport ", fnStart + 1);
  const fnBody = runtimeSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  assert.ok(
    !fnBody.includes(".catch(() => [])"),
    "loadWave4QualitySignals must not catch reads into []"
  );
  assert.ok(
    !fnBody.includes(".catch(() => null)"),
    "loadWave4QualitySignals must not catch reads into null"
  );
});

test("34. Preview readiness load: critical reads not caught into [] or null (source)", () => {
  // Extract the handleRefresh callback body from the panel source
  const fnStart = panelSrc.indexOf("const handleRefresh = useCallback");
  const fnEnd = panelSrc.indexOf("\n  }, [jobId, workOrderId, accessToken]");
  const fnBody = fnStart > -1 ? panelSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined) : "";
  assert.ok(
    !fnBody.includes(".catch(() => null)"),
    "handleRefresh must not catch any read into null"
  );
  assert.ok(
    !fnBody.includes(".catch(() => [])"),
    "handleRefresh must not catch any read into []"
  );
});

// ── HEMS governance (source-level) ───────────────────────────────────────────

test("35. Panel exposes SOP/HEMS Reference Snapshot JSON input (source)", () => {
  assert.ok(
    panelSrc.includes("sopReferenceJson"),
    "panel must expose sopReferenceJson state"
  );
  assert.ok(
    panelSrc.includes("setSopReferenceJson"),
    "panel must expose setSopReferenceJson setter"
  );
});

test("36. Panel exposes governance snapshot JSON input (source)", () => {
  assert.ok(
    panelSrc.includes("governanceSnapshotJson"),
    "panel must expose governanceSnapshotJson state"
  );
  assert.ok(
    panelSrc.includes("setGovernanceSnapshotJson"),
    "panel must expose setGovernanceSnapshotJson setter"
  );
});

test("37. handleMaterializeGovernance: invalid JSON produces error (source)", () => {
  assert.ok(
    panelSrc.includes("is not valid JSON"),
    "panel must reject invalid JSON for SOP/governance inputs"
  );
});

test("38. handleMaterializeGovernance: empty SOP reference array rejected (source)", () => {
  assert.ok(
    panelSrc.includes("must be a non-empty array"),
    "panel must reject empty SOP reference array"
  );
});

test("39. handleMaterializeGovernance: empty governance object rejected (source)", () => {
  assert.ok(
    panelSrc.includes("must be a non-empty object"),
    "panel must reject empty governance snapshot object"
  );
});

// ── Canonical actor (source-level) ───────────────────────────────────────────

test("40. Panel uses revenueContext.appUserId (source)", () => {
  assert.ok(
    panelSrc.includes("revenueContext?.appUserId"),
    "panel must derive appUserId from revenueContext?.appUserId"
  );
});

test("41. Panel mutation eligibility requires appUserId (canMutate) (source)", () => {
  assert.ok(
    panelSrc.includes("const canMutate"),
    "panel must define canMutate"
  );
  assert.ok(
    panelSrc.includes("!!appUserId"),
    "canMutate must require !!appUserId"
  );
});

test("42. Panel does not fall back to session.user.id (source)", () => {
  assert.ok(
    !panelSrc.includes("session?.user?.id"),
    "panel must not fall back to session?.user?.id for appUserId"
  );
  assert.ok(
    !panelSrc.includes("session.user.id"),
    "panel must not fall back to session.user.id for appUserId"
  );
});

// ── Safety invariants (source-level) ─────────────────────────────────────────

test("43. Runtime does not call runOperationsPilot (source)", () => {
  assert.ok(
    !runtimeSrc.includes("runOperationsPilot"),
    "Wave 4 runtime must not call runOperationsPilot"
  );
});

test("44. Runtime does not call cleanupOperationsPilotSession (source)", () => {
  assert.ok(
    !runtimeSrc.includes("cleanupOperationsPilotSession"),
    "Wave 4 runtime must not call cleanupOperationsPilotSession"
  );
});

test("45. Runtime does not contain destructive DELETE flow (source)", () => {
  assert.ok(
    !runtimeSrc.includes(".delete("),
    "Wave 4 runtime must not issue .delete() calls"
  );
});

test("46. Runtime does not mutate huc_* tables (source)", () => {
  assert.ok(
    !runtimeSrc.includes("huc_"),
    "Wave 4 runtime must not reference huc_* tables"
  );
});

test("47. Runtime does not mutate pricing_snapshot (source)", () => {
  assert.ok(
    !runtimeSrc.includes("pricing_snapshot"),
    "Wave 4 runtime must not reference pricing_snapshot"
  );
});

test("48. Runtime does not mutate quote_version (source)", () => {
  assert.ok(
    !runtimeSrc.includes("quote_version"),
    "Wave 4 runtime must not reference quote_version"
  );
});

test("49. loadWave4QualitySignals contract_version remains wave4-quality-v1 (source)", () => {
  assert.ok(
    runtimeSrc.includes('"wave4-quality-v1"'),
    "contract_version must remain \"wave4-quality-v1\""
  );
});

test("50. Runtime does not contain employee scoring or bonus logic (source)", () => {
  // The comment "calculate employee scores or bonuses" is acceptable documentation.
  // Assert that no *code* (assignment or function call) references bonus or employee_score.
  assert.ok(
    !runtimeSrc.includes("bonus =") && !runtimeSrc.includes("bonus("),
    "Wave 4 runtime must not contain bonus assignment or function call"
  );
  assert.ok(
    !runtimeSrc.includes("employee_score"),
    "Wave 4 runtime must not contain employee_score logic"
  );
});
