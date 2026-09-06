import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

function psqlValue(value) {
  if (value === null || value === undefined) return "";
  if (value === true) return "t";
  if (value === false) return "f";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Run a PostgreSQL regression in an isolated, in-process WASM cluster.
 *
 * The prior harness hard-coded a system PostgreSQL 16 installation and failed
 * before executing SQL in containers without initdb (or when tests ran as
 * root). PGlite executes PostgreSQL DDL, PL/pgSQL, triggers, roles, privileges,
 * and constraints without relying on host packages or process privileges.
 */
export async function withTempPostgres(_prefix, _portBase, _portRange, run) {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  const execSql = async (statement) => {
    const responses = await database.exec(statement, { rowMode: "array" });
    // Match `psql -qAt`: transaction-control statements do not erase output
    // emitted by the last row-producing statement in a multi-statement script.
    const result = responses.findLast((response) => response.rows?.length);
    return (result?.rows || []).map((row) => row.map(psqlValue).join("|")).join("\n").trim();
  };
  try {
    return await run(execSql);
  } finally {
    await database.close();
  }
}
