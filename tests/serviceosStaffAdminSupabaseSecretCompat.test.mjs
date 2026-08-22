import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSupabaseSecretKeyHeaders } from "../server-internal/supabase-secret-key-fetch-compat.js";

test("modern Supabase sb_secret key is not sent as bearer JWT", () => {
  const init = normalizeSupabaseSecretKeyHeaders({
    method: "GET",
    headers: {
      apikey: "sb_secret_example",
      Authorization: "Bearer sb_secret_example",
      Accept: "application/json",
    },
  });

  assert.equal(init.headers.apikey, "sb_secret_example");
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.headers.Accept, "application/json");
});

test("legacy service-role JWT bearer header is preserved", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.example.signature";
  const original = {
    method: "GET",
    headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
  };
  const init = normalizeSupabaseSecretKeyHeaders(original);

  assert.equal(init.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(init.headers.apikey, jwt);
});

test("authenticated user bearer session is preserved", () => {
  const init = normalizeSupabaseSecretKeyHeaders({
    method: "GET",
    headers: {
      apikey: "public-anon-key",
      Authorization: "Bearer user-session-jwt",
    },
  });

  assert.equal(init.headers.Authorization, "Bearer user-session-jwt");
  assert.equal(init.headers.apikey, "public-anon-key");
});
