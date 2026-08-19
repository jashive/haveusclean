#!/usr/bin/env bash
set -euo pipefail
: "${SERVICEOS_REPLAY_DATABASE_URL:?disposable PostgreSQL URL required}"
case "$SERVICEOS_REPLAY_DATABASE_URL" in *opazwghrohmfykzxxsjk*|*hqeamecwdsrjfjybrsox*) echo 'refusing managed production/acceptance target' >&2; exit 1;; esac
psql "$SERVICEOS_REPLAY_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
SQL
node -e "for(const f of require('./supabase/introspection/serviceos_canonical_migration_manifest.json').migrations) console.log(f)" | while read -r migration; do psql "$SERVICEOS_REPLAY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"; done
