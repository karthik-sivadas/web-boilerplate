import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrations } from "./infrastructure/migrations";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { createPool } from "./infrastructure/postgres";
import { workspaceSchema, sessionSchema } from "@workspace/contracts/v1";

it("actual rebuild excludes removed migrations and stale files from its owned output", async () => {
  const stale = new URL("../dist/migrations/999-stale.sql", import.meta.url);
  const staleAsset = new URL("../dist/stale.mjs", import.meta.url);
  try {
    await writeFile(stale, "CREATE TABLE stale_branch_marker(id integer);\n");
    await writeFile(staleAsset, "throw new Error('stale branch');\n");
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../scripts/build.mjs", import.meta.url))],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { PATH: process.env.PATH },
        stdio: "ignore",
      },
    );
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    expect(code).toBe(0);
    // Exercise the same loader used by artifact migrate/readiness, not source grep.
    expect(
      await migrations(new URL("../dist/migrations/", import.meta.url)),
    ).toEqual(await migrations());
    expect(await readdir(new URL("../dist/", import.meta.url))).not.toContain(
      "stale.mjs",
    );
  } finally {
    await rm(stale, { force: true });
    await rm(staleAsset, { force: true });
  }
});

it("boots copied source-free artifact, migrates explicitly, and retains cookie/workspace after process restart", async () => {
  const adminUrl = process.env.PG_TEST_ADMIN_URL;
  if (!adminUrl)
    throw new Error("PG_TEST_ADMIN_URL required for owned artifact database.");
  const parsed = new URL(adminUrl);
  if (!/test_admin$/.test(parsed.pathname) || /dev|prod/.test(parsed.pathname))
    throw new Error("Refusing non-test administrator target.");
  const admin = createPool(adminUrl, { max: 1 });
  const database = `test_${randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "workspace-api-artifact-"));
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    child = undefined;
  };
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    parsed.pathname = `/${database}`;
    await cp(new URL("../dist/", import.meta.url), directory, {
      recursive: true,
    });
    expect(await readdir(directory)).not.toContain("node_modules");
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      DATABASE_URL: parsed.href,
      BETTER_AUTH_SECRET: "synthetic-artifact-secret-000000000000000000",
      BETTER_AUTH_URL: "http://localhost:3000",
      API_PORT: String(port),
    };
    const run = async (entry: string) => {
      const process = spawn(
        globalThis.process.execPath,
        [join(directory, entry)],
        { cwd: directory, env, stdio: "ignore" },
      );
      const code = await new Promise<number | null>((resolve) =>
        process.once("exit", resolve),
      );
      expect(code).toBe(0);
    };
    const start = async (expectedStatus: number) => {
      child = spawn(process.execPath, [join(directory, "main.mjs")], {
        cwd: directory,
        env,
        stdio: "ignore",
      });
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null)
          throw new Error("Artifact exited before readiness.");
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
          if (response.status === expectedStatus) return;
        } catch {
          /* startup */
        }
        await delay(30);
      }
      throw new Error("Artifact readiness deadline exceeded.");
    };
    let expectedSessionId = "";
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
    ) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          origin: env.BETTER_AUTH_URL,
          "content-type": "application/json",
          cookie,
          ...(expectedSessionId
            ? { "X-Expected-Session-Id": expectedSessionId }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await start(503);
    await stop();
    await run("migrate.mjs");
    await run("migrate.mjs");
    await start(200);
    const signup = await request("/api/auth/sign-up/email", "POST", {
      email: "artifact@example.test",
      name: "Artifact",
      password: "Synthetic-password-123!",
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expectedSessionId = sessionSchema.parse(
      await (await request("/api/v1/session", "GET", undefined, cookie)).json(),
    ).sessionId;
    expect(
      (
        await request(
          "/api/v1/projects",
          "POST",
          { expectedRevision: 0, name: "Persisted", description: "" },
          cookie,
        )
      ).status,
    ).toBe(200);
    await stop();
    await start(200);
    const state = workspaceSchema.parse(
      await (
        await request("/api/v1/workspace", "GET", undefined, cookie)
      ).json(),
    );
    expect(state.revision).toBe(1);
    expect(state.projects[0]?.name).toBe("Persisted");
    const observer = createPool(parsed.href, { max: 1 });
    try {
      expect(
        (
          await observer.query(
            "SELECT name FROM schema_migration ORDER BY name",
          )
        ).rows.map((row) => (row as { name: string }).name),
      ).toEqual((await migrations()).map((item) => item.name));
      await observer.query(
        "CREATE FUNCTION delay_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER delay_project BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION delay_project()",
      );
      const pending = request(
        "/api/v1/projects",
        "POST",
        { expectedRevision: 1, name: "Drained", description: "" },
        cookie,
      );
      let active = false;
      for (let i = 0; i < 100; i++) {
        const result = await observer.query<{ active: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='PgSleep') AS active",
        );
        if (result.rows[0]?.active) {
          active = true;
          break;
        }
        await delay(20);
      }
      expect(active).toBe(true);
      const exiting = new Promise<number | null>((resolve) =>
        child!.once("exit", resolve),
      );
      const started = Date.now();
      child!.kill("SIGTERM");
      const drained = await pending;
      expect(drained.status).toBe(200);
      expect(workspaceSchema.parse(await drained.json()).revision).toBe(2);
      expect(await exiting).toBe(0);
      expect(Date.now() - started).toBeLessThan(15000);
      child = undefined;
      await observer.query(
        "DROP TRIGGER delay_project ON project; DROP FUNCTION delay_project()",
      );
      await start(200);
      const persisted = workspaceSchema.parse(
        await (
          await request("/api/v1/workspace", "GET", undefined, cookie)
        ).json(),
      );
      expect(persisted.revision).toBe(2);
      expect(persisted.projects.map((project) => project.name).sort()).toEqual([
        "Drained",
        "Persisted",
      ]);
    } finally {
      await observer.end();
    }
  } finally {
    await stop();
    try {
      if (created)
        await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 30000);
