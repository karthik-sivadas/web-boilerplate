import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { parseEnv } from "node:util";
/** A deliberately bounded common dotenv/Node format, not JSON or shell escaping. */
function serializeEntry(key: string, value: string): string {
  if (
    value.includes("\0") ||
    value.includes("\r") ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  )
    throw new Error("Unsupported configuration value; no file was created.");
  // Single quotes preserve backslashes, literal backslash-n, dollar signs and LF.
  // Double quotes are used only when no escaping/interpolation is necessary.
  const candidates = [
    ...(!value.includes("'") ? [`'${value}'`] : []),
    ...(!/["\\\\$]/.test(value) ? [`"${value}"`] : []),
  ];
  for (const candidate of candidates) {
    const entry = `${key}=${candidate}\n`;
    const dotenv = parse(entry),
      node = parseEnv(entry);
    if (
      Object.keys(dotenv).length === 1 &&
      Object.keys(node).length === 1 &&
      dotenv[key] === value &&
      node[key] === value
    )
      return entry;
  }
  throw new Error("Unsupported configuration value; no file was created.");
}
/** Only normal operator commands read their selected config. Tests always select owned temporary files. */
export async function developmentConfiguration(
  path: string,
  environment: NodeJS.ProcessEnv,
) {
  let saved: Record<string, string> = {},
    exists = true;
  try {
    const bytes = await readFile(path, "utf8");
    saved = parse(bytes);
    const node = parseEnv(bytes);
    if (
      Object.keys(saved).length !== Object.keys(node).length ||
      Object.entries(saved).some(([key, value]) => node[key] !== value)
    )
      throw new Error(
        "Selected configuration has incompatible dotenv/Node semantics; it was not changed.",
      );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    exists = false;
  }
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const supplied = { ...saved, ...inherited };
  if (exists && (!supplied.DATABASE_URL || !supplied.BETTER_AUTH_SECRET))
    throw new Error(
      "Existing config needs DATABASE_URL and BETTER_AUTH_SECRET; it was not changed.",
    );
  const database = new URL(
    supplied.DATABASE_URL ?? "postgresql://127.0.0.1:55432/web_boilerplate_dev",
  );
  if (!supplied.DATABASE_URL) {
    database.username = supplied.POSTGRES_USER ?? "workbench";
    database.password =
      supplied.POSTGRES_PASSWORD ?? randomBytes(32).toString("hex");
    database.pathname = `/${supplied.POSTGRES_DB ?? "web_boilerplate_dev"}`;
    database.port = supplied.POSTGRES_PORT ?? "55432";
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error("PostgreSQL is required.");
  const test = new URL(database);
  test.pathname = "/web_boilerplate_test_admin";
  const container = new URL(database);
  container.hostname = "postgres";
  container.port = "5432";
  const resolved = {
    DATABASE_URL: database.href,
    TEST_DATABASE_URL: test.href,
    PG_TEST_ADMIN_URL: test.href,
    BETTER_AUTH_SECRET:
      supplied.BETTER_AUTH_SECRET ?? randomBytes(48).toString("hex"),
    BETTER_AUTH_URL: "http://localhost:3000",
    API_INTERNAL_URL: "http://127.0.0.1:4000",
    API_PORT: "4000",
    POSTGRES_USER: decodeURIComponent(database.username),
    POSTGRES_PASSWORD: decodeURIComponent(database.password),
    POSTGRES_DB: database.pathname.slice(1),
    POSTGRES_PORT: database.port || "5432",
    CONTAINER_DATABASE_URL: container.href,
    ...supplied,
  };
  if (!exists) {
    // Persist only application configuration, never the rest of the inherited environment.
    const keys = [
      "DATABASE_URL",
      "TEST_DATABASE_URL",
      "PG_TEST_ADMIN_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "API_INTERNAL_URL",
      "API_PORT",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
      "POSTGRES_PORT",
      "CONTAINER_DATABASE_URL",
    ] as const;
    const bytes = keys
      .map((key) => serializeEntry(key, resolved[key]))
      .join("");
    const dotenv = parse(bytes),
      node = parseEnv(bytes);
    if (
      keys.some(
        (key) => dotenv[key] !== resolved[key] || node[key] !== resolved[key],
      )
    )
      throw new Error("Unsupported configuration value; no file was created.");
    // Validate everything before creating even the parent directory. Exclusive
    // creation also preserves another writer's file in a concurrent setup race.
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  }
  return resolved;
}
