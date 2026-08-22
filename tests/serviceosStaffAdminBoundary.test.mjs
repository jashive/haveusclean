import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../src/features/wave1/ServiceOSWave1Workspace.jsx', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/serviceosStaffAdminClient.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/serviceos-staff-admin.js', import.meta.url), 'utf8');
const impl = fs.readFileSync(new URL('../server-internal/serviceos-staff-admin-impl.js', import.meta.url), 'utf8');
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('staff administration is dark-gated and Owner/Admin only in the canonical shell', () => {
  assert.match(envExample, /^VITE_SERVICEOS_STAFF_ADMIN_ENABLED=false$/m);
  assert.match(shell, /VITE_SERVICEOS_STAFF_ADMIN_ENABLED/);
  assert.match(shell, /STAFF_ADMIN_ENABLED && role === "owner_admin"/);
  assert.match(shell, /data-staff-admin-authorized/);
});

test('browser staff client calls only the guarded first-party API', () => {
  assert.match(client, /\/api\/serviceos-staff-admin/);
  assert.match(client, /getValidAccessToken/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|\/auth\/v1\/admin\/users|\/auth\/v1\/invite/);
});

test('server endpoint uses canonical environment isolation before staff admin implementation', () => {
  assert.match(api, /requireServiceosServerTarget/);
  assert.match(api, /requireProductionApproval:\s*true/);
  assert.match(api, /runStaffAdmin/);
});

test('staff admin implementation validates canonical Owner/Admin membership before privileged actions', () => {
  assert.match(impl, /\/auth\/v1\/user/);
  assert.match(impl, /app_user\?select=/);
  assert.match(impl, /app_role\?select=id,code&code=eq\.owner_admin/);
  assert.match(impl, /user_membership\?select=/);
  assert.match(impl, /active\.length !== 1/);
  assert.match(impl, /STAFF_ADMIN_OWNER_REQUIRED/);
});

test('privileged Supabase operations stay server-side and invitation writes canonical audit evidence', () => {
  assert.match(impl, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(impl, /\/auth\/v1\/invite/);
  assert.match(impl, /audit_event/);
  assert.match(impl, /staff\.invited/);
  assert.match(impl, /staff\.deactivated/);
  assert.match(impl, /STAFF_ADMIN_DUPLICATE_USER/);
  assert.match(impl, /provisioning_failed/);
});

test('staff admin role vocabulary remains the ServiceOS canonical five-role set', () => {
  for (const role of ['owner_admin', 'office_ops', 'worker', 'qa', 'finance']) {
    assert.match(impl, new RegExp(`\\"${role}\\"`));
  }
  assert.doesNotMatch(impl, /user_metadata[^\n]*role|raw_user_meta_data[^\n]*role/);
});
