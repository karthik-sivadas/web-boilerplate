import { expect, it } from "vitest";
import { migrate, migrations, schemaReady } from "./migrations";
import { testDatabase } from "./test-database";

it("upgrades published 004 without drift, drops only obsolete auth receipt, and is repeatable", async () => {
  const db = await testDatabase();
  try {
    const plan = await migrations();
    const historical = plan.slice(0, 4);
    expect(historical[3]?.name).toBe("004-legacy-auth-receipt.sql");
    expect(historical[3]?.checksum).toBe(
      "c1a1b885cb53d77db96a2d2d6ed227df76259d1188a50857cb69e0de00984e2d",
    );
    await migrate(db.pool, historical);
    await db.pool.query(
      "INSERT INTO legacy_auth_receipt(fingerprint, counts) VALUES ('synthetic', '{}')",
    );
    const before = await db.pool.query(
      "SELECT name, checksum, applied_at FROM schema_migration ORDER BY name",
    );
    const tables = async () =>
      (
        await db.pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
    const previousTables = await tables();
    expect(await schemaReady(db.readOnly, plan)).toBe(false);
    await migrate(db.pool, plan);
    await migrate(db.pool, plan);
    expect(await schemaReady(db.readOnly, plan)).toBe(true);
    expect(await tables()).toEqual(
      previousTables.filter((name) => name !== "legacy_auth_receipt"),
    );
    expect(
      (
        await db.pool.query(
          "SELECT name, checksum, applied_at FROM schema_migration ORDER BY name LIMIT 4",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (await db.pool.query("SELECT to_regclass('legacy_auth_receipt') AS name"))
        .rows,
    ).toEqual([{ name: null }]);
  } finally {
    await db.close();
  }
});
