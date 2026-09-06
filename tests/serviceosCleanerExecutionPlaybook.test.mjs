import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allocateZoneBudgets, dwellTimeAlerts, ROOM_SEQUENCE, scheduledDurationMinutes } from "../src/lib/cleanerExecutionPlaybook.js";

const operations = readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
const playbook = readFileSync(new URL("../src/features/wave3/CleanerExecutionPlaybook.jsx", import.meta.url), "utf8");
test("room sequence follows the approved standard", () => assert.deepEqual(ROOM_SEQUENCE.map((zone) => zone.id), ["bathrooms", "kitchen", "bedrooms", "living", "floors"]));
test("zone budgets preserve the governed scheduled duration", () => { const rows = allocateZoneBudgets(180); assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 180); assert.deepEqual(rows.map((row) => row.minutes), [45, 45, 36, 27, 27]); });
test("invalid schedule never fabricates a time budget", () => { assert.equal(scheduledDurationMinutes({ scheduled_start: "2026-09-06T10:00:00Z", scheduled_end: "2026-09-06T13:00:00Z" }), 180); assert.equal(scheduledDurationMinutes({}), null); assert.ok(allocateZoneBudgets(null).every((row) => row.minutes === null)); });
test("oven and shower add-ons produce label-safe dwell reminders", () => { const alerts = dwellTimeAlerts(["inside oven", "shower descaler"]); assert.deepEqual(alerts.map((alert) => [alert.id, alert.minutes]), [["oven", 15], ["shower-descaler", 10]]); assert.ok(alerts.every((alert) => /label/.test(alert.prompt))); });
test("active execution mode is gated by the governed in-progress status", () => { assert.match(operations, /executionActive = context\?\.operational_status === "in_progress"/); assert.match(operations, /rpc\/worker_start_assigned_job/); assert.match(operations, /<CleanerExecutionPlaybook/); assert.match(operations, />Start Job</); });
test("playbook contains accessible live timers and standard reminders", () => { assert.match(playbook, /aria-live="polite"/); assert.match(playbook, /Active execution mode/); assert.match(playbook, /top-to-bottom and clockwise/i); });
