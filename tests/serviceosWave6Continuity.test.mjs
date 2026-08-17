// Wave 6 — continuity (fallback / DR) session lifecycle, offline transaction
// correlation, and reconciliation idempotency. Pure tests: no database.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import {
  CONTINUITY_TRANSITIONS,
  canCloseContinuitySession,
  canTransitionContinuity,
  isDuplicateOfflineCorrelation,
  isValidOfflineCorrelationId,
  nextContinuityStatuses,
  pendingContinuityTransactions,
  resolveContinuityReconciliation,
} from "../src/lib/serviceosIntelligenceUtils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  path.join(
    here,
    "..",
    "supabase",
    "migrations",
    "014_wave6_intelligence_governance_continuity.sql"
  ),
  "utf8"
);
const clientSource = readFileSync(
  path.join(here, "..", "src", "lib", "serviceosIntelligenceClient.js"),
  "utf8"
);

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    );
  }
  return result;
}

function withTempPostgres(run) {
  const binDir = process.env.PG_BINDIR || "/usr/lib/postgresql/16/bin";
  const initdb = path.join(binDir, "initdb");
  const pgCtl = path.join(binDir, "pg_ctl");
  const psql = path.join(binDir, "psql");
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "wave6-pg-"));
  const dataDir = path.join(rootDir, "data");
  const socketDir = path.join(rootDir, "socket");
  const port = String(56000 + Math.floor(Math.random() * 3000));
  runChecked("mkdir", ["-p", dataDir, socketDir]);
  try {
    runChecked(initdb, ["-D", dataDir, "-A", "trust", "-U", "postgres", "--no-locale"]);
    runChecked(pgCtl, ["-D", dataDir, "-o", `-k ${socketDir} -p ${port}`, "-w", "start"]);
    const execSql = (statement) =>
      runChecked(
        psql,
        ["-h", socketDir, "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-c", statement]
      ).stdout.trim();
    return run(execSql);
  } finally {
    spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "stop"], { encoding: "utf8" });
    rmSync(rootDir, { recursive: true, force: true });
  }
}

// ── Session lifecycle ────────────────────────────────────────────────────────

test("continuity lifecycle walks declared → … → closed", () => {
  const chain = [
    "declared",
    "fallback_active",
    "service_restored",
    "reconciling",
    "reconciled",
    "closed",
  ];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(
      canTransitionContinuity(chain[i], chain[i + 1]),
      true,
      `${chain[i]} → ${chain[i + 1]} should be legal`
    );
  }
  assert.deepEqual(CONTINUITY_TRANSITIONS.closed, []);
  assert.deepEqual(nextContinuityStatuses("closed"), []);
});

test("continuity lifecycle rejects skipped and reversed transitions", () => {
  const illegal = [
    ["declared", "closed"],
    ["declared", "reconciled"],
    ["fallback_active", "reconciling"],
    ["reconciling", "fallback_active"],
    ["closed", "reconciling"],
    ["reconciled", "declared"],
  ];
  for (const [from, to] of illegal) {
    assert.equal(canTransitionContinuity(from, to), false, `${from} → ${to} must be rejected`);
  }
});

test("continuity lifecycle fails closed on unknown statuses", () => {
  assert.equal(canTransitionContinuity("bogus", "closed"), false);
  assert.equal(canTransitionContinuity(undefined, "closed"), false);
  assert.deepEqual(nextContinuityStatuses("bogus"), []);
});

test("session cannot close without reconciliation completion or a waiver", () => {
  const base = {
    session_status: "reconciled",
    reconciliation_completed_at: null,
    waiver_recorded: false,
  };
  assert.equal(canCloseContinuitySession(base, []), false);
  assert.equal(canCloseContinuitySession({ ...base, waiver_recorded: true }, []), true);
  assert.equal(
    canCloseContinuitySession(
      { ...base, reconciliation_completed_at: "2026-03-01T12:00:00Z" },
      []
    ),
    true
  );
});

test("session cannot close while transactions are pending unless waived", () => {
  const session = {
    session_status: "reconciled",
    reconciliation_completed_at: "2026-03-01T12:00:00Z",
    waiver_recorded: false,
  };
  const transactions = [
    { reconciliation_status: "matched" },
    { reconciliation_status: "pending" },
  ];
  assert.equal(pendingContinuityTransactions(transactions).length, 1);
  assert.equal(canCloseContinuitySession(session, transactions), false);
  assert.equal(
    canCloseContinuitySession({ ...session, waiver_recorded: true }, transactions),
    true
  );
});

test("session in a non-reconciled state can never close", () => {
  for (const status of ["declared", "fallback_active", "service_restored", "reconciling"]) {
    assert.equal(
      canCloseContinuitySession(
        {
          session_status: status,
          reconciliation_completed_at: "2026-03-01T12:00:00Z",
          waiver_recorded: true,
        },
        []
      ),
      false,
      `${status} must not close directly`
    );
  }
});

// ── Offline correlation ids ──────────────────────────────────────────────────

test("offline correlation id format is validated", () => {
  for (const valid of ["DR01", "dr-2026-03-01.job-17", "A_b-9.0", "0123456789"]) {
    assert.equal(isValidOfflineCorrelationId(valid), true, `${valid} should be valid`);
  }
  for (const invalid of ["", "ab", "abc", "-leading", " spaced id", "has/slash", null, 42, {}]) {
    assert.equal(
      isValidOfflineCorrelationId(invalid),
      false,
      `${JSON.stringify(invalid)} should be invalid`
    );
  }
});

test("offline correlation id length is bounded at 64", () => {
  assert.equal(isValidOfflineCorrelationId("a".repeat(64)), true);
  assert.equal(isValidOfflineCorrelationId("a".repeat(65)), false);
});

test("offline correlation ids are unique per session, not globally", () => {
  const transactions = [
    { continuity_session_id: "s1", offline_correlation_id: "job-1" },
    { continuity_session_id: "s2", offline_correlation_id: "job-2" },
  ];
  assert.equal(isDuplicateOfflineCorrelation(transactions, "s1", "job-1"), true);
  assert.equal(isDuplicateOfflineCorrelation(transactions, "s2", "job-1"), false);
  assert.equal(isDuplicateOfflineCorrelation(transactions, "s1", "job-2"), false);
  assert.equal(isDuplicateOfflineCorrelation([], "s1", "job-1"), false);
});

// ── Reconciliation ───────────────────────────────────────────────────────────

test("reconciliation applies once and is idempotent thereafter", () => {
  const pending = {
    id: "t1",
    reconciliation_status: "pending",
    offline_correlation_id: "job-1",
  };
  const first = resolveContinuityReconciliation(pending, {
    reconciliation_status: "matched",
    reconciled_at: "2026-03-01T12:00:00Z",
  });
  assert.equal(first.applied, true);
  assert.equal(first.transaction.reconciliation_status, "matched");
  assert.equal(first.transaction.reconciled_at, "2026-03-01T12:00:00Z");

  const second = resolveContinuityReconciliation(first.transaction, {
    reconciliation_status: "matched",
  });
  assert.equal(second.applied, false);
  assert.deepEqual(second.transaction, first.transaction);
});

test("re-reconciling never silently overwrites a different outcome", () => {
  const matched = { id: "t1", reconciliation_status: "matched" };
  const attempt = resolveContinuityReconciliation(matched, {
    reconciliation_status: "waived",
    waiver_evidence: "manager sign-off",
  });
  assert.equal(attempt.applied, false);
  assert.equal(attempt.transaction.reconciliation_status, "matched");
});

test("discrepancy reconciliation requires notes", () => {
  const pending = { id: "t1", reconciliation_status: "pending" };
  assert.throws(() =>
    resolveContinuityReconciliation(pending, { reconciliation_status: "discrepancy" })
  );
  const ok = resolveContinuityReconciliation(pending, {
    reconciliation_status: "discrepancy",
    discrepancy_notes: "amount mismatch vs master sheet",
  });
  assert.equal(ok.applied, true);
  assert.equal(ok.transaction.reconciliation_status, "discrepancy");
});

test("waived reconciliation requires waiver evidence", () => {
  const pending = { id: "t1", reconciliation_status: "pending" };
  assert.throws(() =>
    resolveContinuityReconciliation(pending, { reconciliation_status: "waived" })
  );
  const ok = resolveContinuityReconciliation(pending, {
    reconciliation_status: "waived",
    waiver_evidence: "owner waiver ref W-12",
  });
  assert.equal(ok.applied, true);
});

test("reconciliation rejects an unknown status and a missing transaction", () => {
  assert.throws(() =>
    resolveContinuityReconciliation(
      { reconciliation_status: "pending" },
      { reconciliation_status: "done" }
    )
  );
  assert.throws(() =>
    resolveContinuityReconciliation({ reconciliation_status: "pending" }, {})
  );
  assert.throws(() =>
    resolveContinuityReconciliation(null, { reconciliation_status: "matched" })
  );
});

test("reconciliation leaves reconciled_at DB-owned when caller omits it", () => {
  const result = resolveContinuityReconciliation(
    { id: "t1", reconciliation_status: "pending" },
    { reconciliation_status: "matched" }
  );
  assert.equal(result.applied, true);
  assert.equal(result.transaction.reconciled_at, undefined);
});

// ── Migration + client contracts ─────────────────────────────────────────────

test("migration enforces per-session correlation uniqueness", () => {
  assert.match(
    sql,
    /CONSTRAINT uq_ct_session_correlation\s+UNIQUE \(continuity_session_id, offline_correlation_id\)/
  );
});

test("migration enforces continuity status vocabulary and closure rule", () => {
  for (const status of [
    "declared",
    "fallback_active",
    "service_restored",
    "reconciling",
    "reconciled",
    "closed",
  ]) {
    assert.ok(sql.includes(`'${status}'`), `missing continuity status ${status}`);
  }
  assert.match(sql, /CONSTRAINT ck_cs_close_requires_reconciliation CHECK/);
});

test("migration enforces reconciliation evidence at the database layer", () => {
  assert.match(sql, /CONSTRAINT ck_ct_discrepancy_requires_notes CHECK/);
  assert.match(sql, /CONSTRAINT ck_ct_waived_requires_evidence CHECK/);
});

test("continuity transactions are never deleted by the client", () => {
  assert.match(clientSource, /export async function recordContinuityTransaction/);
  assert.match(clientSource, /export async function reconcileContinuityTransaction/);
  assert.doesNotMatch(clientSource, /method: "DELETE"/);
});

test("client validates correlation ids before recording a transaction", () => {
  assert.match(clientSource, /isValidOfflineCorrelationId/);
});

// ── Correction area 5: DB-level closure enforcement (M) ─────────────────────

test("migration FSM trigger enforces unresolved-transaction check before closure", () => {
  // Criterion M: continuity session cannot close with unresolved transactions at DB level
  const fsmBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_continuity_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_continuity_fsm")
  );
  assert.match(
    fsmBody,
    /continuity_transaction/,
    "FSM must query continuity_transaction on closure attempt"
  );
  assert.match(
    fsmBody,
    /reconciliation_status NOT IN/,
    "FSM must check terminal reconciliation statuses"
  );
  // Terminal statuses for reconciliation must include the full verified vocabulary
  for (const status of ["matched", "discrepancy", "waived"]) {
    assert.ok(
      fsmBody.includes(`'${status}'`),
      `FSM closure check must reference terminal status '${status}'`
    );
  }
});

test("migration FSM trigger checks terminal immutability on continuity_session", () => {
  // Criterion N: terminal closed session cannot be silently rewritten
  const fsmBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_continuity_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_continuity_fsm")
  );
  assert.match(
    fsmBody,
    /OLD\.session_status = 'closed'/,
    "FSM must detect terminal closed status"
  );
  assert.match(
    fsmBody,
    /terminal row is immutable/i,
    "FSM must raise on any update to a closed session"
  );
});

test("migration immutability trigger blocks mutation of payload evidence fields", () => {
  // Criterion C: DB-level immutability for payload_hash/transaction_data/offline_correlation_id
  assert.match(
    sql,
    /BEFORE UPDATE ON public\.continuity_transaction\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_immute_continuity_transaction_fields/
  );
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_immute_continuity_transaction_fields"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_immute_continuity_transaction_fields")
  );
  assert.match(body, /payload_hash IS DISTINCT FROM OLD\.payload_hash/);
  assert.match(body, /transaction_data IS DISTINCT FROM OLD\.transaction_data/);
  assert.match(body, /offline_correlation_id IS DISTINCT FROM OLD\.offline_correlation_id/);
});

test("PostgreSQL default declared_at and BEFORE INSERT trigger coexist; ordinary continuity declaration succeeds", () => {
  withTempPostgres((execSql) => {
    execSql(`
      CREATE TABLE continuity_session_like (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_code text NOT NULL,
        session_status text NOT NULL DEFAULT 'declared',
        declared_at timestamptz NOT NULL DEFAULT now(),
        declared_by_app_user_id uuid
      );
    `);
    execSql(`
      CREATE OR REPLACE FUNCTION trg_wave6_guard_continuity_session_insert_like()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.session_status <> 'declared' THEN
          RAISE EXCEPTION 'must start declared';
        END IF;
        NEW.declared_at := now();
        NEW.declared_by_app_user_id := '00000000-0000-0000-0000-000000000001'::uuid;
        RETURN NEW;
      END;
      $$;
    `);
    execSql(`
      CREATE TRIGGER trig_wave6_guard_continuity_session_insert_like
      BEFORE INSERT ON continuity_session_like
      FOR EACH ROW
      EXECUTE FUNCTION trg_wave6_guard_continuity_session_insert_like();
    `);
    const created = execSql(`
      INSERT INTO continuity_session_like (session_code)
      VALUES ('DR-ORDINARY-1')
      RETURNING session_status, declared_at IS NOT NULL, declared_by_app_user_id::text;
    `);
    const createdParts = created.split("|");
    assert.equal(createdParts[0], "declared");
    assert.equal(createdParts[1], "t");
    assert.equal(createdParts[2], "00000000-0000-0000-0000-000000000001");

    const overridden = execSql(`
      INSERT INTO continuity_session_like (session_code, declared_at)
      VALUES ('DR-OVERRIDE-1', '2001-01-01T00:00:00Z')
      RETURNING (declared_at > '2001-01-01T00:00:00Z'::timestamptz), declared_by_app_user_id::text;
    `);
    const overriddenParts = overridden.split("|");
    assert.equal(overriddenParts[0], "t");
    assert.equal(overriddenParts[1], "00000000-0000-0000-0000-000000000001");
  });
});

test("continuity insert guard allows ordinary declared insert while blocking prepopulated lifecycle evidence", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_guard_continuity_session_insert"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.trg_wave6_guard_continuity_session_insert")
  );
  assert.match(body, /NEW\.declared_at := now\(\)/);
  assert.match(body, /NEW\.declared_by_app_user_id := v_actor/);
  assert.doesNotMatch(body, /declared_at is DB-owned and must not be set on insert/);
  assert.match(body, /insert cannot pre-populate transition-owned timestamps\/actors/);
  assert.match(body, /insert cannot pre-populate waiver evidence/);
});

test("continuity waiver is one-way and immutable once recorded", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_stamp_continuity_session_update"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.trg_wave6_stamp_continuity_session_update")
  );
  assert.match(body, /waiver_recorded cannot transition true→false/);
  assert.match(body, /waiver evidence is immutable once recorded/);
});

test("continuity lifecycle timestamps are DB-owned and transition-scoped", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_stamp_continuity_session_update"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.trg_wave6_stamp_continuity_session_update")
  );
  assert.match(body, /service_restored_at may only be set on fallback_active→service_restored/);
  assert.match(body, /reconciliation_started_at may only be set on service_restored→reconciling/);
  assert.match(body, /reconciliation_completed_at may only be set on reconciling→reconciled/);
  assert.match(body, /closed_at\/closed_by may only be set on reconciled→closed/);
  assert.match(body, /declared_at is DB-owned and immutable/);
  assert.match(body, /closed_by_app_user_id is DB-owned and immutable once set/);
});
