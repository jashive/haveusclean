import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260831110500_wave3_worker_notification_delivery.sql', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/server/workerNotificationDelivery.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/features/wave3/ServiceOSOperationsWorkspace.jsx', import.meta.url), 'utf8');
const notifications = fs.readFileSync(new URL('../api/notifications.js', import.meta.url), 'utf8');

test('worker notification delivery has strict assignment/channel and idempotency uniqueness', () => {
  assert.match(migration, /UNIQUE\(worker_assignment_id, channel\)/);
  assert.match(migration, /UNIQUE\(idempotency_key\)/);
  assert.match(service, /worker-dispatch:\$\{assignment\.id\}:\$\{workOrder\.id\}:\$\{channel\.channel\}/);
  assert.match(service, /if \(!created \|\| \['sent','delivered','acknowledged'\]\.includes\(audit\.delivery_status\)\)/);
});

test('delivery lifecycle records requested sent delivered failed acknowledged without fabricating delivered', () => {
  assert.match(migration, /'requested','sent','delivered','failed','acknowledged'/);
  assert.match(migration, /requested_at timestamptz/);
  assert.match(migration, /sent_at timestamptz/);
  assert.match(migration, /delivered_at timestamptz/);
  assert.match(migration, /failed_at timestamptz/);
  assert.match(migration, /acknowledged_at timestamptz/);
  assert.match(service, /delivery_status: 'sent'/);
  assert.match(service, /delivery_status: 'failed'/);
  assert.doesNotMatch(service, /delivery_status: 'delivered'/);
});

test('Schedule & Dispatch invokes governed worker notification only after work order publication and dispatch transition', () => {
  const published = workspace.indexOf('updateWorkOrderStatus(workOrder.id, "published"');
  const dispatched = workspace.indexOf('updateOperationalJobStatus(job.id, "dispatched"');
  const notify = workspace.indexOf('postWorkerDispatchNotification(assignment.id, workOrder.id)');
  assert.ok(published >= 0 && dispatched > published && notify > dispatched);
  assert.match(workspace, /getValidAccessToken/);
  assert.match(notifications, /action === 'worker-dispatch'/);
  assert.match(notifications, /handleWorkerDispatchNotification\(req, res, bearer\(req\)\)/);
});

test('worker acknowledgment advances notification audit and remains assignment-scoped', () => {
  assert.match(workspace, /acknowledgeWorkerNotificationDelivery\(selected\.id\)/);
  assert.match(workspace, /worker_notification_delivery\?worker_assignment_id=eq\./);
  assert.match(workspace, /delivery_status: "acknowledged"/);
  assert.match(migration, /worker_id = public\.current_worker_id\(organization_id\)/);
  assert.match(migration, /delivery_status = 'acknowledged'/);
});

test('email and configured SMS are supported while missing channels fail closed', () => {
  assert.match(service, /provider: 'microsoft_graph'/);
  assert.match(service, /provider: 'twilio'/);
  assert.match(service, /TWILIO_ACCOUNT_SID/);
  assert.match(service, /TWILIO_AUTH_TOKEN/);
  assert.match(service, /TWILIO_FROM_NUMBER/);
  assert.match(service, /no configured deliverable email\/SMS channel/);
});
