import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260904150536_applicant_in_app_training.sql", "utf8");
const api = fs.readFileSync("server-internal/workforce-compliance-dashboard-impl.js", "utf8");
const player = fs.readFileSync("src/features/workforce/ApplicantTrainingPlayer.jsx", "utf8");
const portal = fs.readFileSync("src/features/workforce/PublicApplicantPortal.jsx", "utf8");
const portalProfileRls = fs.readFileSync("supabase/migrations/20260904151000_harden_applicant_portal_profile_rls.sql", "utf8");
const mediaSeed = fs.readFileSync("supabase/migrations/20260904213000_seed_interim_industry_training_media.sql", "utf8");

test("applicant portal profiles are RLS-protected and service-role-only", () => {
  assert.match(portalProfileRls, /applicant_portal_profile enable row level security/i);
  assert.match(portalProfileRls, /revoke all privileges[\s\S]+from public, anon, authenticated/i);
  assert.match(portalProfileRls, /grant select, insert, update, delete[\s\S]+to service_role/i);
});

test("candidate training stays in private HEMS tables with indexed foreign keys", () => {
  assert.match(migration, /create table if not exists hems_hr\.applicant_training_record/i);
  assert.match(migration, /idx_applicant_training_record_submission/i);
  assert.match(migration, /idx_applicant_training_record_module/i);
  assert.match(migration, /idx_applicant_training_record_media/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on hems_hr\.applicant_training_media,hems_hr\.applicant_training_record from public,anon,authenticated/i);
});

test("public training RPCs are service-role-only and token-bound", () => {
  assert.match(migration, /applicant_token_matches\(p_reference text,p_access_token text\)/i);
  assert.match(migration, /access_token_hash=pg_catalog\.encode\(extensions\.digest/i);
  assert.match(migration, /revoke all on function %s from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function %s to service_role/i);
});

test("completion requires watch threshold and current comprehension", () => {
  assert.match(migration, /v_percent<v_media\.required_watch_percent/i);
  assert.match(migration, /p_comprehension_version is distinct from v_media\.comprehension_version/i);
  assert.match(migration, /Video completion satisfies the applicant video milestone only/i);
});

test("existing applicant endpoint consolidates catalog, progress, and completion", () => {
  for (const action of ["training_catalog", "training_progress", "training_complete"]) assert.match(api, new RegExp(action));
  assert.match(api, /record_applicant_training_milestone/);
});

test("portal embeds direct and governed player media without leaving the app", () => {
  assert.match(portal, /ApplicantTrainingPlayer/);
  assert.match(player, /<video/);
  assert.match(player, /<iframe/);
  assert.match(player, /application\/vnd\.apple\.mpegurl/);
  assert.match(player, /sandbox="allow-scripts allow-same-origin allow-presentation"/);
  assert.match(player, /Confirm module completion/);
  assert.match(player, /youtube\.com\/iframe_api/);
  assert.match(player, /YT\.PlayerState\.ENDED/);
});

test("interim media configures four logical modules for each jurisdiction", () => {
  assert.match(mediaSeed, /HUC_FINAL_QA_WALKTHROUGH/);
  assert.match(mediaSeed, /youtube-nocookie\.com\/embed\/M8bvESowYJg/);
  assert.match(mediaSeed, /youtube-nocookie\.com\/embed\/sHQVhInihF0/);
  assert.match(mediaSeed, /youtube-nocookie\.com\/embed\/R5oAqYogEOg/);
  assert.match(mediaSeed, /youtube-nocookie\.com\/embed\/EEX4-O4fgBU/);
  assert.match(mediaSeed, /youtube-nocookie\.com\/embed\/r1mp6oE7bhw/);
  assert.match(mediaSeed, /required_count/);
  assert.match(mediaSeed, /training module is outside the applicant jurisdiction/);
});
