import { Pool, types, type PoolClient } from "pg";
// Better Auth performs numeric arithmetic on BIGINT millisecond timestamps.
// pg otherwise returns text, producing invalid rate-limit retry windows.
const safeInteger = (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("Database integer exceeds supported precision.");
  return number;
};
const getTypeParser: typeof types.getTypeParser = ((
  oid: number,
  format?: "text" | "binary",
): unknown =>
  oid === Number(types.builtins.INT8) && format !== "binary"
    ? safeInteger
    : types.getTypeParser(oid, format)) as typeof types.getTypeParser;

export function createPool(
  connectionString: string,
  options: { schema?: string; readOnly?: boolean; max?: number } = {},
): Pool {
  if (options.schema && !/^test_[a-f0-9]{32}$/.test(options.schema))
    throw new Error("Invalid owned test schema.");
  const url = new URL(connectionString);
  for (const key of url.searchParams.keys())
    if (key !== "sslmode")
      throw new Error(
        "Database URL options must not override bounded pool policy.",
      );
  const pool = new Pool({
    connectionString,
    types: { getTypeParser },
    max: options.max ?? 6,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000,
    options: `-c search_path=${options.schema ?? "public"} -c default_transaction_read_only=${options.readOnly ? "on" : "off"}`,
  });
  // Never log driver errors: they may contain connection details or SQL.
  pool.on("error", () => {
    console.error(JSON.stringify({ event: "database_pool_error" }));
  });
  return pool;
}
export async function transaction<T>(
  pool: Pool,
  mode: "read" | "write",
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroyed = false;
  let released = false;
  const deadline = setTimeout(() => {
    destroyed = true;
    released = true;
    client.release(true);
  }, 10000);
  deadline.unref();
  try {
    await client.query(
      mode === "read"
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN",
    );
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyed = true;
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    if (!released) client.release(destroyed);
  }
}
