import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("api/notifications.js", "utf8");

test("Goal 5.6F-1 uses Microsoft Graph app-only OAuth for native quote delivery", () => {
  assert.match(api, /M365_TENANT_ID/);
  assert.match(api, /M365_CLIENT_ID/);
  assert.match(api, /M365_CLIENT_SECRET/);
  assert.match(api, /M365_SENDER_EMAIL/);
  assert.match(api, /https:\/\/login\.microsoftonline\.com\/\$\{encodeURIComponent\(tenantId\)\}\/oauth2\/v2\.0\/token/);
  assert.match(api, /scope: 'https:\/\/graph\.microsoft\.com\/\.default'/);
  assert.match(api, /grant_type: 'client_credentials'/);
  assert.doesNotMatch(api.slice(api.indexOf('async function handleQuoteEmail'), api.indexOf('async function handleReminder')), /GOOGLE_EMAIL|GOOGLE_APP_PASSWORD|smtp\.gmail\.com|gmail_smtp/);
});

test("Microsoft 365 delivery creates a provider message before sending and records that exact ID", () => {
  const quoteEmail = api.slice(api.indexOf('async function handleQuoteEmail'), api.indexOf('async function handleReminder'));
  const createIndex = quoteEmail.indexOf("/messages`");
  const sendIndex = quoteEmail.indexOf("/send`");
  const rpcIndex = quoteEmail.indexOf("rpc/record_quote_email_delivery");
  assert.ok(createIndex >= 0 && sendIndex > createIndex && rpcIndex > sendIndex);
  assert.match(quoteEmail, /providerMessageId = String\(draft\?\.id \|\| ''\)\.trim\(\)/);
  assert.match(quoteEmail, /p_provider: 'microsoft_graph'/);
  assert.match(quoteEmail, /graph_message_id: providerMessageId/);
  assert.match(quoteEmail, /internet_message_id: draft\?\.internetMessageId \|\| null/);
});

test("Microsoft Graph failures fail closed before quote delivery evidence is recorded", () => {
  assert.match(api, /Microsoft 365 authentication failed/);
  assert.match(api, /Microsoft 365 could not create the quote email/);
  assert.match(api, /Microsoft 365 did not accept the quote email for sending/);
  assert.match(api, /if \(sendResponse\.status !== 202\)/);
});

test("Microsoft 365 quote delivery stays in the existing notifications function", () => {
  assert.equal(fs.existsSync("api/m365-quote-email.js"), false);
  assert.equal(fs.existsSync("api/quote-email.js"), false);
  assert.match(api, /action === 'quote-email'/);
});
