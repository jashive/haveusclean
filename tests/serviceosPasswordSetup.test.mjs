import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mainSource = fs.readFileSync("src/main.jsx", "utf8");
const authGateSource = fs.readFileSync("src/auth/ServiceOSAuthGate.jsx", "utf8");
const setupSource = fs.readFileSync("src/auth/ServiceOSPasswordSetup.jsx", "utf8");

test("invite and recovery callbacks bypass the normal sign-in gate", () => {
  assert.match(mainSource, /window\.location\.pathname === "\/set-password"/);
  assert.match(mainSource, /callback\.get\("access_token"\)/);
  assert.match(mainSource, /type === "invite" \|\| type === "recovery"/);
  assert.match(mainSource, /<ServiceOSPasswordSetup \/>/);
});

test("failed or consumed auth callbacks route to password recovery", () => {
  assert.match(mainSource, /callback\.get\("error"\)/);
  assert.match(mainSource, /callback\.get\("error_code"\)/);
  assert.match(mainSource, /callback\.get\("error_description"\)/);
  assert.match(mainSource, /return hasPasswordSession \|\| hasAuthCallbackError/);
});

test("normal ServiceOS sign in exposes the existing password recovery route", () => {
  assert.match(authGateSource, /href="\/set-password"/);
  assert.match(authGateSource, />Forgot password\?<\/a>/);
});

test("password setup updates the authenticated Supabase user", () => {
  assert.match(setupSource, /fetch\(`\$\{url\}\/auth\/v1\/user`/);
  assert.match(setupSource, /method: "PUT"/);
  assert.match(setupSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(setupSource, /JSON\.stringify\(\{ password \}\)/);
});

test("already-confirmed staff can request a fresh password setup link", () => {
  assert.match(setupSource, /\/auth\/v1\/recover\?redirect_to=/);
  assert.match(setupSource, /Send Password Setup Link/);
  assert.match(setupSource, /window\.location\.origin\}\/set-password/);
});
