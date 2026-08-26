import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260826021500_goal5_native_quote_email_customer_decision.sql", "utf8");
const contextMigration = fs.readFileSync("supabase/migrations/20260826022000_goal5_public_quote_decision_context.sql", "utf8");
const notificationsApi = fs.readFileSync("api/notifications.js", "utf8");
const deliveryClient = fs.readFileSync("src/lib/serviceosQuoteDeliveryClient.js", "utf8");
const panel = fs.readFileSync("src/features/wave1/ServiceOSQuoteDeliveryPanel.jsx", "utf8");
const shell = fs.readFileSync("src/features/wave1/ServiceOSWave1Workspace.jsx", "utf8");

test("Goal 5.6F native email is mounted inside the authorized Revenue workflow", () => {
  assert.match(shell, /lazy\(\(\) => import\(["']\.\/ServiceOSQuoteDeliveryPanel["']\)\)/);
  assert.match(shell, /<ServiceOSRevenueWorkspace session=\{session\} revenueContext=\{activeRevenueContext\} \/>[\s\S]*<ServiceOSQuoteDeliveryPanel session=\{session\} revenueContext=\{activeRevenueContext\} \/>[\s\S]*<ServiceOSCustomerResponsePanel/);
  assert.match(panel, /Send Quote by Email/);
  assert.match(panel, /Quote Delivery \+ Customer Decision/);
  assert.match(deliveryClient, /\/api\/notifications\?action=quote-email/);
});

test("email action reads canonical saved quote and recipient through authenticated ServiceOS lineage", () => {
  assert.match(notificationsApi, /quote_version\?select=id,organization_id,business_unit_id,quote_id,lifecycle_status,title,line_items_snapshot,commercial_snapshot/);
  assert.match(notificationsApi, /quote\?select=id,opportunity_id/);
  assert.match(notificationsApi, /opportunity\?select=id,service_request_id/);
  assert.match(notificationsApi, /service_request\?select=id,requirements/);
  assert.match(notificationsApi, /serviceRequest\.requirements\?\.customer\?\.email/);
  assert.match(notificationsApi, /qv\.commercial_snapshot\?\.customerFacingText/);
  assert.doesNotMatch(notificationsApi, /SERVICE_ROLE|service_role|SUPABASE_SERVICE_ROLE/);
});

test("quote is recorded Sent only after Microsoft 365 accepts the exact quote message for sending", () => {
  const quoteEmail = notificationsApi.slice(notificationsApi.indexOf("async function handleQuoteEmail"), notificationsApi.indexOf("async function handleReminder"));
  const createIndex = quoteEmail.indexOf("/messages`");
  const sendIndex = quoteEmail.indexOf("/send`");
  const acceptedIndex = quoteEmail.indexOf("sendResponse.status !== 202");
  const rpcIndex = quoteEmail.indexOf("rpc/record_quote_email_delivery");
  assert.ok(createIndex >= 0 && sendIndex > createIndex && acceptedIndex > sendIndex && rpcIndex > acceptedIndex);
  assert.match(migration, /if v_qv\.lifecycle_status = 'draft' then[\s\S]*lifecycle_status = 'sent'/i);
  assert.match(migration, /provider_message_id text not null/);
  assert.match(migration, /provider_accepted_at timestamptz not null/);
});

test("native email includes a secure customer decision link without changing the saved quote content", () => {
  assert.match(notificationsApi, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(notificationsApi, /createHash\('sha256'\)/);
  assert.match(notificationsApi, /\/api\/notifications\?action=quote-decision&token=/);
  assert.match(notificationsApi, /Review & Respond to Quote/);
  assert.match(notificationsApi, /customerText/);
});

test("Goal 5.6G public link exposes only quote context and the two intended customer actions", () => {
  assert.match(contextMigration, /get_public_quote_decision_context/);
  assert.match(contextMigration, /customer_facing_text/);
  assert.match(notificationsApi, /Accept Quote/);
  assert.match(notificationsApi, /Request Changes/);
  assert.match(notificationsApi, /record_public_quote_decision/);
});

test("anonymous customer decision cannot create conversion, handoff, or job", () => {
  const publicDecisionStart = migration.indexOf("create or replace function public.record_public_quote_decision");
  const publicDecisionSql = migration.slice(publicDecisionStart);
  assert.match(publicDecisionSql, /insert into public\.customer_quote_decision/i);
  assert.doesNotMatch(publicDecisionSql, /insert into public\.conversion_record/i);
  assert.doesNotMatch(publicDecisionSql, /insert into public\.job_handoff/i);
  assert.doesNotMatch(publicDecisionSql, /insert into public\.operational_job/i);
  assert.match(panel, /customer link responses are evidence of the customer’s decision/i);
  assert.match(panel, /do not anonymously create a job/i);
});

test("customer decision is single-version, expiring, and conflict-safe", () => {
  assert.match(migration, /uq_customer_quote_decision_quote_version unique \(quote_version_id\)/i);
  assert.match(migration, /decision_expires_at/);
  assert.match(migration, /if v_delivery\.decision_expires_at < now\(\) then raise exception/i);
  assert.match(migration, /A different decision has already been recorded for this quote/i);
  assert.match(migration, /idempotent_replay',true/i);
});

test("Goal 5.6F/G stays within the existing Vercel serverless-function footprint", () => {
  assert.equal(fs.existsSync("api/quote-email.js"), false);
  assert.equal(fs.existsSync("api/quote-decision.js"), false);
  assert.match(notificationsApi, /action === 'quote-email'/);
  assert.match(notificationsApi, /action === 'quote-decision'/);
});
