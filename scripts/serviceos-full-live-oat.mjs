#!/usr/bin/env node
import { chromium } from "playwright";

const ACCEPTANCE_REF = "hqeamecwdsrjfjybrsox";
const PRODUCTION_REF = "opazwghrohmfykzxxsjk";
const SUPABASE_ORIGIN = `https://${ACCEPTANCE_REF}.supabase.co`;
const EXPECTED_BASE_HOST = "haveusclean-k872t00xl-jasons-projects-54483428.vercel.app";
const roles = ["owner", "office", "worker", "qa"];
const runId = `TEST-W6-FULL-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

function fail(message, severity = "HIGH") {
  const error = new Error(message);
  error.severity = severity;
  throw error;
}
function assert(condition, message, severity = "HIGH") {
  if (!condition) fail(message, severity);
}
function redact(value) {
  let text = String(value?.message ?? value ?? "unknown error");
  for (const role of roles) {
    for (const field of ["EMAIL", "PASSWORD"]) {
      const secret = process.env[`SERVICEOS_OAT_${role.toUpperCase()}_${field}`];
      if (secret) text = text.split(secret).join("[REDACTED]");
    }
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) text = text.split(bypass).join("[REDACTED_VERCEL_BYPASS]");
  return text.replace(/([?&](?:token|access_token|refresh_token|apikey|api_key|key|password|secret)=)[^&#\s"'<>]*/gi, "$1[REDACTED]");
}
function requiredEnv() {
  const names = [
    "BASE_URL",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    ...roles.flatMap((role) => [
      `SERVICEOS_OAT_${role.toUpperCase()}_EMAIL`,
      `SERVICEOS_OAT_${role.toUpperCase()}_PASSWORD`,
    ]),
  ];
  const missing = names.filter((name) => !String(process.env[name] ?? "").trim());
  if (missing.length) fail(`missing required environment variables: ${missing.join(", ")}`, "BLOCKER");
  const base = new URL(process.env.BASE_URL);
  assert(base.protocol === "https:", "BASE_URL must be HTTPS", "BLOCKER");
  assert(base.hostname === EXPECTED_BASE_HOST, "BASE_URL is not the exact authoritative Preview", "BLOCKER");
  assert(!base.href.includes(PRODUCTION_REF), "Production target prohibited", "CRITICAL");
}
function decodeJwtSub(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).sub;
}

async function establishPreview(page) {
  await page.goto(process.env.BASE_URL, { waitUntil: "networkidle" });
  const current = new URL(page.url());
  assert(current.hostname === EXPECTED_BASE_HOST, `protected Preview navigation escaped authoritative host: ${current.hostname}`, "BLOCKER");
  await page.locator("#sos-email").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#sos-password").waitFor({ state: "visible", timeout: 30000 });
}

async function browserLogin(browser, role) {
  const context = await browser.newContext({ ignoreHTTPSErrors: process.env.SERVICEOS_OAT_IGNORE_HTTPS_ERRORS === "true" });
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  await context.route((url) => url.hostname === EXPECTED_BASE_HOST, async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    });
  });
  const page = await context.newPage();
  let apikey = null;
  let jwt = null;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(PRODUCTION_REF)) fail("Production Supabase traffic detected", "CRITICAL");
    if (!url.startsWith(SUPABASE_ORIGIN)) return;
    const headers = req.headers();
    if (headers["x-vercel-protection-bypass"] || headers["x-vercel-set-bypass-cookie"]) {
      fail("Vercel bypass header leaked to Supabase", "CRITICAL");
    }
    if (headers.apikey) apikey = headers.apikey;
    const auth = headers.authorization || "";
    if (/^Bearer\s+eyJ/i.test(auth)) {
      const candidate = auth.replace(/^Bearer\s+/i, "");
      try { if (decodeJwtSub(candidate)) jwt = candidate; } catch {}
    }
  });
  await establishPreview(page);
  await page.locator("#sos-email").fill(process.env[`SERVICEOS_OAT_${role.toUpperCase()}_EMAIL`]);
  await page.locator("#sos-password").fill(process.env[`SERVICEOS_OAT_${role.toUpperCase()}_PASSWORD`]);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByText(role === "owner" ? "owner admin" : role === "office" ? "office ops" : role, { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  assert(apikey, `${role}: browser-safe Supabase apikey was not observed`, "BLOCKER");
  assert(jwt, `${role}: authenticated JWT was not observed`, "BLOCKER");
  const authUserId = decodeJwtSub(jwt);
  await context.close();
  return { role, apikey, jwt, authUserId };
}

async function rest(session, resource, { method = "GET", body, prefer = "return=representation", allowFailure = false } = {}) {
  assert(!resource.includes(PRODUCTION_REF), "Production REST target prohibited", "CRITICAL");
  const url = resource.startsWith("http") ? resource : `${SUPABASE_ORIGIN}/rest/v1/${resource}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: session.apikey,
      Authorization: `Bearer ${session.jwt}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok && !allowFailure) {
    fail(`${session.role} ${method} ${resource.split("?")[0]} failed HTTP ${res.status}: ${typeof data === "string" ? data.slice(0, 240) : JSON.stringify(data).slice(0, 240)}`);
  }
  return { ok: res.ok, status: res.status, data };
}
async function select(session, table, query = "") {
  const r = await rest(session, `${table}${query ? `?${query}` : ""}`);
  return Array.isArray(r.data) ? r.data : [];
}
async function insert(session, table, body, { allowFailure = false } = {}) {
  const r = await rest(session, table, { method: "POST", body, allowFailure });
  if (allowFailure) return r;
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  assert(row?.id, `${table} insert returned no row`);
  return row;
}
async function patch(session, table, id, body, { allowFailure = false } = {}) {
  const r = await rest(session, `${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body, allowFailure });
  if (allowFailure) return r;
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  assert(row?.id, `${table} patch matched no row (RLS or state guard)`);
  return row;
}
async function previewApi(session, path, body) {
  const base = new URL(process.env.BASE_URL);
  const url = new URL(path, `${base.origin}/`);
  assert(url.hostname === EXPECTED_BASE_HOST, "Preview API request escaped authoritative host", "CRITICAL");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.jwt}`,
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) fail(`${session.role} POST ${url.pathname} failed HTTP ${res.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return { ok: true, status: res.status, data };
}
async function expectDenied(label, promise) {
  const r = await promise;
  const rowCount = Array.isArray(r.data) ? r.data.length : r.data?.id ? 1 : 0;
  assert(!r.ok || rowCount === 0, `${label}: unauthorized mutation unexpectedly succeeded`, "HIGH");
}
async function expectDuplicateRejected(label, promise) {
  const r = await promise;
  assert(!r.ok, `${label}: duplicate/concurrent obligation was accepted`, "HIGH");
}
async function identity(session) {
  const users = await select(session, "app_user", `auth_user_id=eq.${encodeURIComponent(session.authUserId)}&select=id,auth_user_id,display_name,status`);
  assert(users.length === 1, `${session.role}: own app_user mapping not uniquely visible`);
  const appUser = users[0];
  const memberships = await select(session, "user_membership", `app_user_id=eq.${appUser.id}&status=eq.active&select=id,organization_id,business_unit_id,role_id,status`);
  assert(memberships.length === 1, `${session.role}: active membership not uniquely visible`);
  return { ...session, appUser, membership: memberships[0] };
}

async function run() {
  requiredEnv();
  const report = { runId, candidateSha: "433d4f64f6d7ba34863a03b7421e92543dd28818", status: "RUNNING", phases: {} };
  const browser = await chromium.launch({ headless: true });
  try {
    const sessions = {};
    for (const role of roles) sessions[role] = await identity(await browserLogin(browser, role));
    report.phases.auth = "PASS";

    const scope = sessions.office.membership;
    for (const role of roles) {
      assert(sessions[role].membership.organization_id === scope.organization_id, `${role}: organization scope mismatch`);
      assert(sessions[role].membership.business_unit_id === scope.business_unit_id, `${role}: business unit scope mismatch`);
    }
    const bu = (await select(sessions.office, "business_unit", `id=eq.${scope.business_unit_id}&select=id,organization_id,jurisdiction_id,code`))[0];
    assert(bu?.jurisdiction_id, "acceptance business unit jurisdiction missing");
    const jurisdiction = (await select(sessions.office, "jurisdiction", `id=eq.${bu.jurisdiction_id}&select=id,code,country_code,subdivision_code,currency_code,timezone,tax_label,default_tax_rate`))[0];
    assert(jurisdiction?.id, "acceptance jurisdiction is not visible");
    assert(jurisdiction.currency_code && jurisdiction.country_code && jurisdiction.timezone, "acceptance jurisdiction currency/country/timezone incomplete");
    const currencyCode = String(jurisdiction.currency_code).toUpperCase();
    const countryCode = String(jurisdiction.country_code).toUpperCase();
    const subdivisionCode = jurisdiction.subdivision_code ? String(jurisdiction.subdivision_code) : null;
    const timezone = String(jurisdiction.timezone);
    const taxName = jurisdiction.tax_label ? String(jurisdiction.tax_label) : "NONE";
    const taxRate = Number(jurisdiction.default_tax_rate ?? 0);
    assert(Number.isFinite(taxRate) && taxRate >= 0, "acceptance jurisdiction tax rate is invalid");
    const subtotalAmount = 300;
    const taxAmount = Number((subtotalAmount * taxRate).toFixed(2));
    const totalAmount = Number((subtotalAmount + taxAmount).toFixed(2));
    report.jurisdiction = { code: jurisdiction.code, currencyCode, countryCode, subdivisionCode, timezone, taxName, taxRate };
    const workerRow = (await select(sessions.worker, "worker", `app_user_id=eq.${sessions.worker.appUser.id}&status=eq.active&select=id,organization_id,business_unit_id,app_user_id,status`))[0];
    assert(workerRow?.id, "worker identity link missing");
    report.phases.identityScope = "PASS";

    const unauthorizedServiceRequest = {
      organization_id: scope.organization_id,
      business_unit_id: scope.business_unit_id,
      service_category: "residential",
      lifecycle_status: "qualified",
      intake_channel: "oat_negative",
      title: `${runId}-UNAUTHORIZED`,
      metadata: { acceptance: true, runId },
      requirements: {},
    };
    await expectDenied("worker revenue mutation", insert(sessions.worker, "service_request", unauthorizedServiceRequest, { allowFailure: true }));
    await expectDenied("qa revenue mutation", insert(sessions.qa, "service_request", unauthorizedServiceRequest, { allowFailure: true }));
    await expectDenied("owner worker impersonation", insert(sessions.owner, "completion_evidence", {
      organization_id: scope.organization_id,
      business_unit_id: scope.business_unit_id,
      operational_job_id: "00000000-0000-0000-0000-000000000001",
      work_order_id: "00000000-0000-0000-0000-000000000001",
      evidence_type: "note",
      evidence_payload: { negative: true },
      captured_at: new Date().toISOString(),
      captured_by_app_user_id: sessions.owner.appUser.id,
    }, { allowFailure: true }));
    report.phases.rlsNegativePreflight = "PASS";

    const office = sessions.office;
    const owner = sessions.owner;
    const org = scope.organization_id;
    const buId = scope.business_unit_id;
    const jur = bu.jurisdiction_id;
    const meta = { acceptance: true, runId };

    const sr = await insert(office, "service_request", { organization_id: org, business_unit_id: buId, service_category: "residential", lifecycle_status: "qualified", intake_channel: "full_oat", requested_at: new Date().toISOString(), title: `${runId} Service Request`, description: "Synthetic full OAT", requirements: { package: "complete_deep" }, metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    const opp = await insert(office, "opportunity", { organization_id: org, business_unit_id: buId, service_request_id: sr.id, stage: "qualified", title: `${runId} Opportunity`, summary: "Synthetic full OAT", metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    const est = await insert(office, "estimate", { organization_id: org, business_unit_id: buId, opportunity_id: opp.id, version_no: 1, lifecycle_status: "prepared", assumptions: {}, scope_snapshot: { acceptance: true }, notes: runId, metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    const pricing = await insert(office, "pricing_snapshot", { organization_id: org, business_unit_id: buId, opportunity_id: opp.id, estimate_id: est.id, currency_code: currencyCode, tax_name: taxName, tax_rate: taxRate, subtotal_amount: subtotalAmount, discount_amount: 0, tax_amount: taxAmount, total_amount: totalAmount, calculator_version: "TEST-W6-OAT-1", configuration_snapshot: { acceptance: true, jurisdiction: report.jurisdiction }, labor_economics: { teamSize: 1, jobHours: 3, partnerPayTotal: 100, profit: 200 }, calculation_inputs: {}, calculation_outputs: { subtotal: subtotalAmount, tax: taxAmount, total: totalAmount }, raw_calculation_snapshot: { runId }, frozen_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: office.appUser.id });
    const quote = await insert(office, "quote", { organization_id: org, business_unit_id: buId, opportunity_id: opp.id, estimate_id: est.id, lifecycle_status: "active", metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    let qv = await insert(office, "quote_version", { organization_id: org, business_unit_id: buId, quote_id: quote.id, estimate_id: est.id, pricing_snapshot_id: pricing.id, version_no: 1, lifecycle_status: "draft", title: `${runId} Quote`, line_items_snapshot: [{ description: "Synthetic complete deep clean", amount: subtotalAmount }], commercial_snapshot: { currency: currencyCode, total: totalAmount }, metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    qv = await patch(office, "quote_version", qv.id, { lifecycle_status: "sent", sent_at: new Date().toISOString(), updated_by_app_user_id: office.appUser.id });
    const qr = await insert(office, "quote_response", { organization_id: org, business_unit_id: buId, quote_version_id: qv.id, response_type: "accepted", response_channel: "full_oat", responded_by_name: "TEST-W6 Customer", responded_by_email: "test-w6-customer@example.invalid", responded_at: new Date().toISOString(), notes: runId, metadata: meta, created_by_app_user_id: office.appUser.id });
    qv = await patch(office, "quote_version", qv.id, { lifecycle_status: "accepted", updated_by_app_user_id: office.appUser.id });
    const customer = await insert(office, "customer", { organization_id: org, business_unit_id: buId, customer_type: "person", display_name: `${runId} Customer`, status: "active", notes: "Synthetic acceptance only", metadata: meta });
    const contact = await insert(office, "contact", { customer_id: customer.id, contact_type: "primary", first_name: "TEST-W6", last_name: "Customer", email: "test-w6-customer@example.invalid", is_primary: true, metadata: meta });
    const location = await insert(office, "service_location", { customer_id: customer.id, jurisdiction_id: jur, label: `${runId} Location`, address_line1: "1 Synthetic Acceptance Way", city: "Test", ...(subdivisionCode ? { subdivision: subdivisionCode } : {}), country_code: countryCode, access_notes: "Synthetic only", metadata: meta });
    const conversion = await insert(office, "conversion_record", { organization_id: org, business_unit_id: buId, service_request_id: sr.id, opportunity_id: opp.id, estimate_id: est.id, quote_id: quote.id, quote_version_id: qv.id, quote_response_id: qr.id, customer_id: customer.id, contact_id: contact.id, service_location_id: location.id, converted_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: office.appUser.id });
    const handoff = await insert(office, "job_handoff", { organization_id: org, business_unit_id: buId, conversion_record_id: conversion.id, quote_version_id: qv.id, pricing_snapshot_id: pricing.id, handoff_status: "ready", handoff_payload: { runId }, metadata: meta, handed_off_at: new Date().toISOString(), created_by_app_user_id: office.appUser.id });
    report.phases.revenueLifecycle = "PASS";

    let job = await insert(office, "operational_job", { organization_id: org, business_unit_id: buId, jurisdiction_id: jur, job_handoff_id: handoff.id, conversion_record_id: conversion.id, quote_version_id: qv.id, pricing_snapshot_id: pricing.id, customer_id: customer.id, contact_id: contact.id, service_location_id: location.id, service_family: "residential", operational_status: "ready_to_schedule", service_scope_snapshot: { runId }, commercial_authority_snapshot: { quote_version_id: qv.id, pricing_snapshot_id: pricing.id }, metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    await expectDuplicateRejected("duplicate job handoff", insert(office, "operational_job", { ...job, id: undefined }, { allowFailure: true }));
    const start = new Date(Date.now() + 3600_000).toISOString();
    const end = new Date(Date.now() + 3 * 3600_000).toISOString();
    const window = await insert(office, "schedule_window", { organization_id: org, business_unit_id: buId, jurisdiction_id: jur, operational_job_id: job.id, scheduled_start: start, scheduled_end: end, timezone, status: "planned", scheduling_notes: runId, metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    let assignment = await insert(office, "worker_assignment", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, schedule_window_id: window.id, worker_id: workerRow.id, assignment_role: "service_worker", assignment_status: "assigned", assigned_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    await expectDuplicateRejected("duplicate active worker/window assignment", insert(office, "worker_assignment", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, schedule_window_id: window.id, worker_id: workerRow.id, assignment_role: "service_worker", assignment_status: "assigned", metadata: meta }, { allowFailure: true }));
    const workOrder = await insert(office, "work_order", { organization_id: org, business_unit_id: buId, jurisdiction_id: jur, operational_job_id: job.id, schedule_window_id: window.id, work_order_status: "published", scope_snapshot: { runId }, customer_instruction_snapshot: {}, access_instruction_snapshot: {}, checklist_template_snapshot: { items: ["full_oat"] }, safety_instruction_snapshot: {}, pricing_reference_snapshot: { pricing_snapshot_id: pricing.id }, published_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "scheduled", updated_by_app_user_id: office.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "dispatched", updated_by_app_user_id: office.appUser.id });
    report.phases.scheduleAssignment = "PASS";

    assignment = await patch(sessions.worker, "worker_assignment", assignment.id, { assignment_status: "acknowledged", acknowledged_at: new Date().toISOString(), updated_by_app_user_id: sessions.worker.appUser.id });
    await expectDenied("worker unrelated revenue write", insert(sessions.worker, "quote", { organization_id: org, business_unit_id: buId, opportunity_id: opp.id, lifecycle_status: "active", metadata: meta }, { allowFailure: true }));
    await insert(sessions.worker, "work_order_event", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, worker_assignment_id: assignment.id, event_type: "arrived", event_at: new Date().toISOString(), actor_app_user_id: sessions.worker.appUser.id, actor_worker_id: workerRow.id, event_payload: { runId }, metadata: meta });
    job = await patch(office, "operational_job", job.id, { operational_status: "in_progress", updated_by_app_user_id: office.appUser.id });
    await patch(office, "work_order", workOrder.id, { work_order_status: "in_progress", started_at: new Date().toISOString(), updated_by_app_user_id: office.appUser.id });
    await insert(sessions.worker, "work_order_event", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, worker_assignment_id: assignment.id, event_type: "work_started", event_at: new Date().toISOString(), actor_app_user_id: sessions.worker.appUser.id, actor_worker_id: workerRow.id, event_payload: { runId }, metadata: meta });
    await insert(sessions.worker, "completion_evidence", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, worker_assignment_id: assignment.id, evidence_type: "note", evidence_payload: { note: `${runId} initial completion evidence` }, captured_at: new Date().toISOString(), captured_by_worker_id: workerRow.id, captured_by_app_user_id: sessions.worker.appUser.id, metadata: meta });
    await insert(sessions.worker, "service_checklist_result", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, checklist_item_key: "full_oat_initial", checklist_item_label: "Full OAT initial completion", result_status: "pass", result_payload: { runId }, completed_by_worker_id: workerRow.id, completed_by_app_user_id: sessions.worker.appUser.id, completed_at: new Date().toISOString(), metadata: meta });
    await insert(sessions.worker, "work_order_event", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, worker_assignment_id: assignment.id, event_type: "completion_submitted", event_at: new Date().toISOString(), actor_app_user_id: sessions.worker.appUser.id, actor_worker_id: workerRow.id, event_payload: { runId }, metadata: meta });
    await patch(office, "work_order", workOrder.id, { work_order_status: "service_complete", service_completed_at: new Date().toISOString(), updated_by_app_user_id: office.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "service_complete", updated_by_app_user_id: office.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "qa_pending", updated_by_app_user_id: office.appUser.id });
    report.phases.workerExecution = "PASS";

    await expectDenied("worker self QA", insert(sessions.worker, "qa_inspection", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, inspection_status: "passed", inspection_type: "standard", findings: {}, inspected_at: new Date().toISOString(), inspector_app_user_id: sessions.worker.appUser.id, metadata: meta }, { allowFailure: true }));
    const qaFail = await insert(sessions.qa, "qa_inspection", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, inspector_app_user_id: sessions.qa.appUser.id, inspection_status: "failed", inspection_type: "standard", score: 70, findings: { runId, finding: "Synthetic rework required" }, inspected_at: new Date().toISOString(), metadata: meta });
    let corrective = await insert(sessions.qa, "corrective_action", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, qa_inspection_id: qaFail.id, action_status: "assigned", action_type: "rework", description: `${runId} synthetic rework`, assigned_worker_id: workerRow.id, due_at: new Date(Date.now() + 3600_000).toISOString(), resolution_payload: {}, metadata: meta, created_by_app_user_id: sessions.qa.appUser.id, updated_by_app_user_id: sessions.qa.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "corrective_action_required", updated_by_app_user_id: office.appUser.id });
    await insert(sessions.worker, "completion_evidence", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, worker_assignment_id: assignment.id, evidence_type: "note", evidence_payload: { note: `${runId} rework completion evidence`, corrective_action_id: corrective.id }, captured_at: new Date().toISOString(), captured_by_worker_id: workerRow.id, captured_by_app_user_id: sessions.worker.appUser.id, metadata: meta });
    await insert(sessions.worker, "service_checklist_result", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, checklist_item_key: "full_oat_rework", checklist_item_label: "Full OAT corrective rework", result_status: "pass", result_payload: { runId, corrective_action_id: corrective.id }, completed_by_worker_id: workerRow.id, completed_by_app_user_id: sessions.worker.appUser.id, completed_at: new Date().toISOString(), metadata: meta });
    corrective = await patch(sessions.qa, "corrective_action", corrective.id, { action_status: "resolved", resolution_payload: { runId, worker_rework_evidence: true }, resolved_at: new Date().toISOString(), updated_by_app_user_id: sessions.qa.appUser.id });
    corrective = await patch(sessions.qa, "corrective_action", corrective.id, { action_status: "verified", verified_at: new Date().toISOString(), updated_by_app_user_id: sessions.qa.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "qa_pending", updated_by_app_user_id: office.appUser.id });
    const qaPass = await insert(sessions.qa, "qa_inspection", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, inspector_app_user_id: sessions.qa.appUser.id, inspection_status: "passed", inspection_type: "reinspection", score: 100, findings: { runId, prior_failure_id: qaFail.id, rework_verified: true }, inspected_at: new Date().toISOString(), metadata: meta });
    await patch(office, "work_order", workOrder.id, { work_order_status: "qa_complete", updated_by_app_user_id: office.appUser.id });
    job = await patch(office, "operational_job", job.id, { operational_status: "qa_passed", updated_by_app_user_id: office.appUser.id });
    assignment = await patch(sessions.worker, "worker_assignment", assignment.id, { assignment_status: "completed", updated_by_app_user_id: sessions.worker.appUser.id });
    const inspections = await select(sessions.qa, "qa_inspection", `operational_job_id=eq.${job.id}&select=id,inspection_status,inspection_type,findings,created_at&order=created_at.asc`);
    assert(inspections.some((x) => x.id === qaFail.id && x.inspection_status === "failed"), "original failed QA inspection was not preserved", "HIGH");
    assert(inspections.some((x) => x.id === qaPass.id && x.inspection_status === "passed"), "reinspection pass missing", "HIGH");
    report.phases.qaFailReworkPass = "PASS";

    const opHandoff = await insert(office, "operational_handoff", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, work_order_id: workOrder.id, qa_inspection_id: qaPass.id, pricing_snapshot_id: pricing.id, quote_version_id: qv.id, handoff_status: "ready", handoff_payload: { runId, qa_passed: true }, metadata: meta, handed_off_at: new Date().toISOString(), created_by_app_user_id: office.appUser.id });
    const gate = await insert(office, "billing_readiness_gate", { organization_id: org, business_unit_id: buId, jurisdiction_id: jur, operational_job_id: job.id, work_order_id: workOrder.id, operational_handoff_id: opHandoff.id, pricing_snapshot_id: pricing.id, quote_version_id: qv.id, gate_status: "ready", gate_assessment: { job_status: job.operational_status, work_order_status: "qa_complete", open_corrective_actions: 0, runId }, blocking_reasons: [], assessed_at: new Date().toISOString(), assessed_by_app_user_id: office.appUser.id, metadata: meta, created_by_app_user_id: office.appUser.id });
    const invoice = await insert(office, "invoice_request", { organization_id: org, business_unit_id: buId, jurisdiction_id: jur, billing_readiness_gate_id: gate.id, operational_job_id: job.id, work_order_id: workOrder.id, operational_handoff_id: opHandoff.id, customer_id: customer.id, service_location_id: location.id, pricing_snapshot_id: pricing.id, quote_version_id: qv.id, quote_response_id: qr.id, conversion_record_id: conversion.id, currency_code: currencyCode, subtotal_amount: subtotalAmount, tax_amount: taxAmount, total_amount: totalAmount, tax_name: taxName, tax_rate: taxRate, financial_snapshot: { pricing_snapshot_id: pricing.id, total_amount: totalAmount, jurisdiction: report.jurisdiction, runId }, request_status: "submitted", submitted_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: office.appUser.id, updated_by_app_user_id: office.appUser.id });
    await expectDuplicateRejected("duplicate invoice for job", insert(office, "invoice_request", { ...invoice, id: undefined }, { allowFailure: true }));

    const directDeniedPayload = { organization_id: org, business_unit_id: buId, invoice_request_id: invoice.id, provider: "preview_test", provider_event_id: `${runId}-DIRECT-DENIED`, provider_event_type: "preview.direct.denied", currency_code: currencyCode, amount_observed: totalAmount, payment_status: "observed", event_payload_snapshot: { runId }, observed_at: new Date().toISOString(), is_test_provider: true, metadata: meta, created_by_app_user_id: office.appUser.id };
    await expectDenied("office direct payment persistence", insert(office, "payment_observation", directDeniedPayload, { allowFailure: true }));
    await expectDenied("qa finance mutation", insert(sessions.qa, "payment_observation", { ...directDeniedPayload, provider_event_id: `${runId}-QA-DENIED`, created_by_app_user_id: sessions.qa.appUser.id }, { allowFailure: true }));

    const paymentEvent = `${runId}-PAYMENT`;
    const paymentCall = await previewApi(office, "/api/wave5-preview-payment", { invoice_request_id: invoice.id, provider_event_id: paymentEvent });
    assert(paymentCall.data?.success === true && paymentCall.data?.payment_observation?.id, "preview payment endpoint did not persist a canonical payment observation");
    const payment = paymentCall.data.payment_observation;
    const repeatPayment = await previewApi(office, "/api/wave5-preview-payment", { invoice_request_id: invoice.id, provider_event_id: paymentEvent });
    assert(repeatPayment.data?.success === true && repeatPayment.data?.idempotent === true, "preview payment endpoint did not return idempotent success for repeated provider event");
    const paymentRows = await select(office, "payment_observation", `provider=eq.preview_test&provider_event_id=eq.${encodeURIComponent(paymentEvent)}&select=id,invoice_request_id`);
    assert(paymentRows.length === 1 && paymentRows[0].invoice_request_id === invoice.id, "preview payment provider event did not persist exactly once");

    const comp = await insert(owner, "contractor_compensation_version", { organization_id: org, business_unit_id: buId, worker_id: workerRow.id, service_family: "residential", version: `${runId}-COMP`, compensation_method: "flat_amount", currency_code: currencyCode, rate_value: 100, effective_from: new Date(Date.now() - 86400_000).toISOString(), compensation_status: "active", approved_by_app_user_id: owner.appUser.id, approved_at: new Date().toISOString(), governance_reference_snapshot: { runId }, metadata: meta, created_by_app_user_id: owner.appUser.id });
    let payable = await insert(owner, "contractor_payable", { organization_id: org, business_unit_id: buId, worker_id: workerRow.id, worker_assignment_id: assignment.id, operational_job_id: job.id, work_order_id: workOrder.id, contractor_compensation_version_id: comp.id, compensation_method: "flat_amount", currency_code: currencyCode, basis_value: 0, computed_amount: 100, payable_status: "pending", eligibility_assessment: { assignment_completed: true, qa_passed: true, runId }, eligibility_passed: true, metadata: meta, created_by_app_user_id: owner.appUser.id });
    await expectDuplicateRejected("duplicate contractor payable", insert(owner, "contractor_payable", { ...payable, id: undefined }, { allowFailure: true }));
    payable = await patch(owner, "contractor_payable", payable.id, { payable_status: "approved", approved_by_app_user_id: owner.appUser.id, approved_at: new Date().toISOString() });
    const profitability = await insert(owner, "job_profitability_snapshot", { organization_id: org, business_unit_id: buId, operational_job_id: job.id, invoice_request_id: invoice.id, currency_code: currencyCode, recognized_revenue_amount: subtotalAmount, tax_amount: taxAmount, direct_labor_cost: 100, other_direct_cost: 0, gross_contribution: 200, gross_margin_percent: 66.6667, source_lineage: { invoice_request_id: invoice.id, contractor_payable_id: payable.id, payment_observation_id: payment.id, runId }, snapshot_taken_at: new Date().toISOString(), metadata: meta, created_by_app_user_id: owner.appUser.id });
    await expectDenied("worker finance mutation", patch(sessions.worker, "contractor_payable", payable.id, { payable_status: "paid" }, { allowFailure: true }));
    report.phases.finance = "PASS";

    const concurrentEvent = `${runId}-CONCURRENT`;
    const concurrent = await Promise.all([
      previewApi(office, "/api/wave5-preview-payment", { invoice_request_id: invoice.id, provider_event_id: concurrentEvent }),
      previewApi(office, "/api/wave5-preview-payment", { invoice_request_id: invoice.id, provider_event_id: concurrentEvent }),
    ]);
    assert(concurrent.every((r) => r.data?.success === true), "concurrent preview payment requests did not both resolve safely");
    const concurrentRows = await select(office, "payment_observation", `provider=eq.preview_test&provider_event_id=eq.${encodeURIComponent(concurrentEvent)}&select=id,invoice_request_id`);
    assert(concurrentRows.length === 1 && concurrentRows[0].invoice_request_id === invoice.id, `concurrent provider event persisted ${concurrentRows.length} rows`);
    report.phases.idempotencyConcurrency = "PASS";

    const kpiDefs = await select(owner, "kpi_definition", `active=eq.true&select=id,code,version&limit=1`);
    assert(kpiDefs.length >= 1, "owner cannot read active KPI definitions", "HIGH");
    const periodStart = new Date(Date.now() - 3600_000).toISOString();
    const periodEnd = new Date().toISOString();
    const kpi = await insert(owner, "kpi_snapshot", { kpi_definition_id: kpiDefs[0].id, kpi_code: kpiDefs[0].code, definition_version: kpiDefs[0].version ?? "1", organization_id: org, business_unit_id: buId, jurisdiction_id: jur, period_type: "DAILY", period_start: periodStart, period_end: periodEnd, timezone, numeric_value: 1, numerator: 1, denominator: 1, source_lineage: { operational_job_id: job.id, profitability_snapshot_id: profitability.id, runId }, source_freshness_at: new Date().toISOString(), captured_at: new Date().toISOString(), captured_by_app_user_id: owner.appUser.id });
    const review = await insert(owner, "management_review", { organization_id: org, business_unit_id: buId, period_type: "DAILY", period_start: periodStart, period_end: periodEnd, timezone, review_status: "in_review", summary: `${runId} controlled pilot OAT management review`, exceptions: [], decisions: [{ decision: "OAT evidence captured" }], actions: [], kpi_snapshot_manifest: [{ id: kpi.id, code: kpi.kpi_code }], owner_app_user_id: owner.appUser.id, review_version: 1, opened_at: new Date().toISOString(), waiver_recorded: false, created_by_app_user_id: owner.appUser.id });
    assert(review?.id, "management review insert failed");
    await expectDenied("worker management review mutation", insert(sessions.worker, "management_review", { organization_id: org, business_unit_id: buId, period_type: "DAILY", period_start: periodStart, period_end: periodEnd, timezone, review_status: "draft" }, { allowFailure: true }));
    report.phases.kpiManagement = "PASS";

    const finalQa = await select(owner, "qa_inspection", `operational_job_id=eq.${job.id}&select=id,inspection_status,inspection_type,findings`);
    const finalInvoices = await select(owner, "invoice_request", `operational_job_id=eq.${job.id}&select=id,request_status,total_amount`);
    const finalPayables = await select(owner, "contractor_payable", `operational_job_id=eq.${job.id}&select=id,payable_status,computed_amount`);
    const finalProfit = await select(owner, "job_profitability_snapshot", `operational_job_id=eq.${job.id}&select=id,gross_contribution,gross_margin_percent`);
    assert(finalQa.length === 2, `expected exactly 2 QA inspections, found ${finalQa.length}`, "HIGH");
    assert(finalInvoices.length === 1, `expected exactly 1 invoice request, found ${finalInvoices.length}`, "HIGH");
    assert(finalPayables.length === 1, `expected exactly 1 payable, found ${finalPayables.length}`, "HIGH");
    assert(finalProfit.length >= 1, "profitability snapshot missing", "HIGH");
    report.phases.postRunIntegrity = "PASS";

    report.status = "PASS";
    report.evidence = {
      operationalJobId: job.id,
      qaFailId: qaFail.id,
      qaPassId: qaPass.id,
      invoiceRequestId: invoice.id,
      paymentObservationId: payment.id,
      contractorPayableId: payable.id,
      profitabilitySnapshotId: profitability.id,
      managementReviewId: review.id,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  const payload = { status: "FAIL", runId, severity: error?.severity ?? "HIGH", reason: redact(error) };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
