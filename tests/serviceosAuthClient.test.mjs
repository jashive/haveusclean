import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/serviceosAuthClient.js", "utf8");

test("auth client recognizes current Supabase message errors", () => {
  assert.match(source, /data\?\.message \?\? data\?\.error_description \?\? data\?\.msg/);
  assert.match(source, /authErrorMessage\(data, "Sign-in failed"\)/);
});

test("auth client parses response text safely before JSON", () => {
  assert.match(source, /const text = await response\.text\(\)/);
  assert.match(source, /if \(!text\) return \{\}/);
  assert.match(source, /JSON\.parse\(text\)/);
  assert.match(source, /catch \{\s*return \{\};\s*\}/s);
  assert.doesNotMatch(source, /await response\.json\(\)/);
});

test("auth client does not surface arbitrary non-JSON response bodies", () => {
  assert.match(source, /return data\?\.message \?\? data\?\.error_description \?\? data\?\.msg \?\? fallback/);
  assert.doesNotMatch(source, /throw new Error\(text\)/);
  assert.doesNotMatch(source, /throw new Error\(.*response.*body/i);
});

test("refresh path uses the same safe auth parser and canonical fallback", () => {
  const refreshStart = source.indexOf("export async function refreshSession");
  const signOutStart = source.indexOf("export async function signOut");
  const refreshSource = source.slice(refreshStart, signOutStart);
  assert.match(refreshSource, /parseAuthResponse\(response\)/);
  assert.match(refreshSource, /authErrorMessage\(data, "Session refresh failed"\)/);
});

test("canonical role validation includes finance without weakening mixed-role rejection", () => {
  assert.match(source, /code=in\.\(owner_admin,office_ops,worker,qa,finance\)/);
  assert.match(source, /roles\.length !== 5/);
  assert.match(source, /mixed or unsupported canonical role/);
});
