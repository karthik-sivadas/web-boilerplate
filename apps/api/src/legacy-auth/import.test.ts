import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterEach, beforeEach, expect, it } from "vitest";
import { testDatabase } from "../infrastructure/test-database";
import { migrate, migrations } from "../infrastructure/migrations";
import { authOptions } from "../auth/options";
import { createApp } from "../app";
import { listen } from "../server";
import { importLegacyAuth } from "./import";
let db: Awaited<ReturnType<typeof testDatabase>>,
  directory: string,
  sourceCopy: string,
  cookie: string;
const config = {
  origin: "http://localhost:3000",
  secret: "synthetic-preserved-secret-00000000000000000",
};
const password = "Synthetic-preserved-password-123!";
beforeEach(async () => {
  db = await testDatabase();
  await migrate(db.pool, await migrations());
  directory = await mkdtemp(join(tmpdir(), "legacy-auth-fixture-"));
  sourceCopy = join(directory, "source-copy.sqlite");
  const sqlite = new DatabaseSync(sourceCopy);
  try {
    const options = { ...authOptions(db.pool, config), database: sqlite };
    await (await getMigrations(options)).runMigrations();
    const auth = betterAuth(options);
    const response = await auth.handler(
      new Request(`${config.origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin: config.origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Preserved",
          email: "legacy@example.test",
          password,
        }),
      }),
    );
    expect(response.status).toBe(200);
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  } finally {
    sqlite.close();
  }
});
afterEach(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const options = () => ({
  sourceCopy,
  confirmOffline: true,
  confirmStableSecret: true,
  stableSecret: config.secret,
  timestampUnit: "milliseconds" as const,
});
it("imports a read-only synthetic copy, preserves cookie/hash/IDs and is idempotent; actual HTTP login works", async () => {
  const before = await readFile(sourceCopy);
  const result = await importLegacyAuth(db.pool, options());
  expect(result.alreadyImported).toBe(false);
  expect(result.counts).toMatchObject({ user: 1, account: 1, session: 1 });
  expect(await readFile(sourceCopy)).toEqual(before);
  expect((await importLegacyAuth(db.pool, options())).alreadyImported).toBe(
    true,
  );
  const server = listen(
    createApp(db.pool, db.readOnly, config, await migrations()).app,
    0,
  );
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${address.port}`;
    const preserved = await fetch(`${base}/api/v1/session`, {
      headers: { cookie },
    });
    expect(preserved.status).toBe(200);
    expect(await preserved.json()).toMatchObject({
      user: { name: "Preserved", email: "legacy@example.test" },
    });
    const login = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "legacy@example.test", password }),
    });
    expect(login.status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  const changed = new DatabaseSync(sourceCopy);
  changed.exec("UPDATE user SET name='Changed source'");
  changed.close();
  await expect(importLegacyAuth(db.pool, options())).rejects.toThrow(
    "empty PostgreSQL",
  );
});
it("rolls back all auth tables and receipt after partial SQL failure, then permits a safe retry", async () => {
  await db.pool.query(
    "CREATE FUNCTION fail_legacy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic legacy failure'; END $$; CREATE TRIGGER fail_legacy BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION fail_legacy()",
  );
  await expect(importLegacyAuth(db.pool, options())).rejects.toThrow();
  expect((await db.pool.query('SELECT id FROM "user"')).rows).toEqual([]);
  expect(
    (await db.pool.query("SELECT fingerprint FROM legacy_auth_receipt")).rows,
  ).toEqual([]);
  await db.pool.query(
    "DROP TRIGGER fail_legacy ON session; DROP FUNCTION fail_legacy()",
  );
  expect((await importLegacyAuth(db.pool, options())).alreadyImported).toBe(
    false,
  );
});
it.each([
  ["calendar rollover", "UPDATE user SET createdAt='2026-02-30T10:00:00Z'"],
  ["non-leap day", "UPDATE user SET updatedAt='2025-02-29T10:00:00+02:00'"],
  ["24-hour rollover", "UPDATE session SET expiresAt='2026-05-01T24:00:00Z'"],
  ["unsupported session id", "UPDATE session SET id='legacy.session'"],
  ["long session id", `UPDATE session SET id='${"s".repeat(129)}'`],
  [
    "long user id",
    `PRAGMA foreign_keys=OFF;UPDATE user SET id='${"u".repeat(129)}';UPDATE account SET userId='${"u".repeat(129)}';UPDATE session SET userId='${"u".repeat(129)}'`,
  ],
  ["invalid runtime email", "UPDATE user SET email='not-an-email'"],
])(
  "rejects %s without any target writes or source changes",
  async (_label, sql) => {
    const source = new DatabaseSync(sourceCopy);
    try {
      source.exec(sql);
    } finally {
      source.close();
    }
    const before = await readFile(sourceCopy);
    await expect(importLegacyAuth(db.pool, options())).rejects.toThrow();
    expect((await readFile(sourceCopy)).equals(before)).toBe(true);
    for (const table of [
      "user",
      "account",
      "session",
      "verification",
      "rateLimit",
      "legacy_auth_receipt",
    ])
      expect((await db.pool.query(`SELECT 1 FROM "${table}"`)).rows).toEqual(
        [],
      );
  },
);
it("preserves valid leap-day/offset timestamps and supported IDs without normalization of identity", async () => {
  const source = new DatabaseSync(sourceCopy);
  let originalUser: unknown;
  try {
    source.exec(
      "UPDATE user SET createdAt='2024-02-29T10:15:30.123+02:00'; UPDATE session SET id='Legacy_session-123'",
    );
    originalUser = source.prepare('SELECT id FROM "user"').get()?.id;
  } finally {
    source.close();
  }
  await importLegacyAuth(db.pool, options());
  const users = await db.pool.query<{ id: string; createdAt: Date }>(
    'SELECT id,"createdAt" FROM "user"',
  );
  expect(users.rows[0]?.id === originalUser).toBe(true);
  expect(users.rows[0]?.createdAt.toISOString()).toBe(
    "2024-02-29T08:15:30.123Z",
  );
  expect((await db.pool.query("SELECT id FROM session")).rows).toEqual([
    { id: "Legacy_session-123" },
  ]);
});
it("rejects unconfirmed operation, invalid booleans, ambiguous dates and orphan references before import", async () => {
  await expect(
    importLegacyAuth(db.pool, { ...options(), confirmOffline: false }),
  ).rejects.toThrow("confirmation");
  const source = new DatabaseSync(sourceCopy);
  try {
    source.exec("UPDATE user SET emailVerified=2");
    await expect(importLegacyAuth(db.pool, options())).rejects.toThrow(
      "boolean",
    );
    source.exec(
      "UPDATE user SET emailVerified=0,createdAt='2026-01-01 10:00:00'",
    );
    await expect(importLegacyAuth(db.pool, options())).rejects.toThrow(
      "timestamp",
    );
    source.exec(
      "UPDATE user SET createdAt='2026-01-01T10:00:00Z'; PRAGMA foreign_keys=OFF; UPDATE session SET userId='missing'",
    );
    await expect(importLegacyAuth(db.pool, options())).rejects.toThrow(
      "Orphan",
    );
  } finally {
    source.close();
  }
  expect((await db.pool.query('SELECT id FROM "user"')).rows).toEqual([]);
});
