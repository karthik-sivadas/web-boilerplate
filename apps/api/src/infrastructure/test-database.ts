import { randomUUID } from "node:crypto";
import { createPool } from "./postgres";

/** Explicit disposable database only; every runtime/planner/guard pool shares this schema. */
export async function testDatabase() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection)
    throw new Error(
      "TEST_DATABASE_URL is required (never falls back to DATABASE_URL).",
    );
  const url = new URL(connection);
  const development = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : undefined;
  if (
    !/^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(url.pathname) ||
    /dev|prod/i.test(url.pathname) ||
    (development && url.pathname === development.pathname)
  )
    throw new Error("Refusing a non-test or development database target.");
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = createPool(connection, { max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = createPool(connection, { schema });
  const readOnly = createPool(connection, { schema, readOnly: true });
  const planner = createPool(connection, { schema });
  return {
    schema,
    pool,
    readOnly,
    planner,
    async close() {
      await Promise.all([pool.end(), readOnly.end(), planner.end()]);
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
