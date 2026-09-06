import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Pool } from "pg";

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}
export async function migrations(
  directory = new URL("../../migrations/", import.meta.url),
): Promise<Migration[]> {
  return Promise.all(
    (await readdir(directory))
      .filter((name) => /^\d{3}-[a-z-]+\.sql$/.test(name))
      .sort()
      .map(async (name) => {
        const sql = await readFile(new URL(name, directory), "utf8");
        return {
          name,
          sql,
          checksum: createHash("sha256").update(sql).digest("hex"),
        };
      }),
  );
}
const ledger =
  "CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())";
export async function migrate(pool: Pool, plan: Migration[]): Promise<void> {
  if (!plan.length) throw new Error("No reviewed migrations found.");
  const client = await pool.connect();
  let locked = false;
  let destroyed = false;
  try {
    // Session lock spans ledger inspection AND transaction, on this same client.
    await client.query("SELECT pg_advisory_lock(187643210, 1)");
    locked = true;
    await client.query("BEGIN");
    await client.query(ledger);
    const existing = await client.query<{ name: string; checksum: string }>(
      "SELECT name,checksum FROM schema_migration ORDER BY name",
    );
    for (const [index, row] of existing.rows.entries())
      if (
        plan[index]?.name !== row.name ||
        plan[index]?.checksum !== row.checksum
      )
        throw new Error("Migration checksum/version drift.");
    for (const migration of plan.slice(existing.rows.length)) {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migration(name,checksum) VALUES($1,$2)",
        [migration.name, migration.checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyed = true;
    }
    throw error;
  } finally {
    if (locked && !destroyed) {
      try {
        await client.query("SELECT pg_advisory_unlock(187643210, 1)");
      } catch {
        destroyed = true;
      }
    }
    client.release(destroyed);
  }
}
export async function schemaReady(
  pool: Pool,
  plan: Migration[],
): Promise<boolean> {
  try {
    const result = await pool.query<{ name: string; checksum: string }>(
      "SELECT name,checksum FROM schema_migration ORDER BY name",
    );
    await pool.query(
      'SELECT w.revision,p.name,p.description,p.archived,t.project_id,t.title,t.description,t.status,t.created_at,t.updated_at,r.count,i.fingerprint,u.email,s.token,a.password,v.value,l.count FROM workspace w,project p,task t,api_rate_limit r,workspace_import_receipt i,"user" u,session s,account a,verification v,"rateLimit" l LIMIT 0',
    );
    return (
      plan.length > 0 &&
      result.rows.length === plan.length &&
      result.rows.every(
        (row, index) =>
          row.name === plan[index]?.name &&
          row.checksum === plan[index]?.checksum,
      )
    );
  } catch {
    return false;
  }
}
