import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./app";
import { listen } from "./server";
import { testDatabase } from "./infrastructure/test-database";
import { migrate, migrations } from "./infrastructure/migrations";
import { sessionSchema, workspaceSchema } from "@workspace/contracts/v1";

const config = {
  origin: "https://workspace.example.test",
  secret: "synthetic-security-secret-00000000000000000",
};
const password = "Synthetic-security-password-123!";
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createApp>;
let server: ReturnType<typeof listen>;
let base: string;
type Login = { cookie: string; sessionId: string; userId: string };
beforeEach(async () => {
  db = await testDatabase();
  const plan = await migrations();
  await migrate(db.pool, plan);
  runtime = createApp(db.pool, db.readOnly, config, plan);
  server = listen(runtime.app, 0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  if (db) await db.close();
});
function request(
  path: string,
  login?: Login,
  method = "GET",
  body?: unknown,
  expected: string | null = login?.sessionId ?? null,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      origin: config.origin,
      "content-type": "application/json",
      cookie: login?.cookie ?? "",
      ...(expected === null ? {} : { "X-Expected-Session-Id": expected }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function account(email = "security@example.test") {
  const response = await request("/api/auth/sign-up/email", undefined, "POST", {
    email,
    name: "Security",
    password,
  });
  expect(response.status).toBe(200);
  const cookies = response.headers.getSetCookie();
  // Real HTTPS public-origin config over the internal HTTP hop, not a test-only cookie override.
  expect(
    cookies.some(
      (cookie) =>
        cookie.startsWith("__Secure-better-auth.session_token=") &&
        /; Secure(?:;|$)/.test(cookie) &&
        /; HttpOnly(?:;|$)/.test(cookie) &&
        /; SameSite=Lax(?:;|$)/.test(cookie) &&
        /; Path=\/(?:;|$)/.test(cookie),
    ),
  ).toBe(true);
  const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const identity = sessionSchema.parse(
    await (
      await request("/api/v1/session", { cookie, sessionId: "", userId: "" })
    ).json(),
  );
  return { cookie, sessionId: identity.sessionId, userId: identity.user.id };
}
it("does not clear cookies or claim logout when PostgreSQL session DELETE times out", async () => {
  const login = await account();
  const holder = await db.planner.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM session WHERE id=$1 FOR UPDATE", [
      login.sessionId,
    ]);
    expect((await request("/health/ready")).status).toBe(200);
    const failed = await request("/api/auth/sign-out", login, "POST", {});
    expect(failed.status).toBe(503);
    expect(failed.headers.getSetCookie()).toEqual([]);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    const text = await failed.text();
    expect(text).toContain("UNAVAILABLE");
    expect(text).not.toMatch(/DELETE|lock timeout|stack|password/);
    expect((await request("/api/v1/session", login)).status).toBe(200);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  const success = await request("/api/auth/sign-out", login, "POST", {});
  expect(success.status).toBe(200);
  expect(success.headers.getSetCookie().join(";")).toMatch(/Max-Age=0/);
  expect((await request("/api/v1/session", login)).status).toBe(401);
  expect(
    (
      await db.pool.query("SELECT id FROM session WHERE id=$1", [
        login.sessionId,
      ])
    ).rows,
  ).toEqual([]);
});
it("binds all workspace intent to the verified session, including same-user replacement", async () => {
  const a = await account("a@example.test"),
    b = await account("b@example.test");
  for (const path of [
    "/api/v1/workspace",
    "/api/v1/projects",
    "/api/v1/tasks",
    "/api/v1/workspace/export",
    "/api/v1/workspace/import",
    "/api/v1/workspace/rollback",
  ]) {
    const matching = await request(path, b);
    if (path === "/api/v1/workspace") expect(matching.status).toBe(200);
    const absent = await request(path, b, "GET", undefined, null);
    expect(absent.status).toBe(400);
    const stale = await request(path, b, "GET", undefined, a.sessionId);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "SESSION_CHANGED" },
    });
  }
  const create = await request(
    "/api/v1/projects",
    b,
    "POST",
    { name: "A private draft", description: "", expectedRevision: 0 },
    a.sessionId,
  );
  expect(create.status).toBe(409);
  const text = await create.text();
  expect(text).not.toContain(b.userId);
  expect(text).not.toContain("projects");
  expect(
    (
      await db.pool.query("SELECT owner_id FROM workspace WHERE owner_id=$1", [
        b.userId,
      ])
    ).rows,
  ).toEqual([]);
  expect(
    workspaceSchema.parse(await (await request("/api/v1/workspace", b)).json()),
  ).toEqual({ revision: 0, projects: [], tasks: [] });
  expect(
    (await request("/api/v1/workspace", b, "GET", undefined, "x".repeat(129)))
      .status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/v1/workspace",
        undefined,
        "GET",
        undefined,
        a.sessionId,
      )
    ).status,
  ).toBe(401);
  const replacement = await request(
    "/api/auth/sign-in/email",
    undefined,
    "POST",
    { email: "b@example.test", password },
  );
  expect(replacement.status).toBe(200);
  const cookie = replacement.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const identity = sessionSchema.parse(
    await (await request("/api/v1/session", { ...b, cookie })).json(),
  );
  expect(identity.user.id).toBe(b.userId);
  expect(identity.sessionId).not.toBe(b.sessionId);
  const newer = {
    cookie,
    userId: identity.user.id,
    sessionId: identity.sessionId,
  };
  expect(
    (await request("/api/v1/workspace", newer, "GET", undefined, b.sessionId))
      .status,
  ).toBe(409);
  expect(
    (
      await request(
        "/api/v1/projects",
        newer,
        "POST",
        { name: "Stale draft", description: "", expectedRevision: 0 },
        b.sessionId,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/api/v1/projects", newer, "POST", {
        name: "Matching draft",
        description: "",
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200);
});
it("serializes archive versus task creation on independent connections", async () => {
  const login = await account();
  const created = workspaceSchema.parse(
    await (
      await request("/api/v1/projects", login, "POST", {
        name: "Race",
        description: "",
        expectedRevision: 0,
      })
    ).json(),
  );
  const id = created.projects[0]!.id;
  const holder = await db.planner.connect();
  await holder.query("BEGIN");
  await holder.query(
    "SELECT revision FROM workspace WHERE owner_id=$1 FOR UPDATE",
    [login.userId],
  );
  const pending = Promise.all([
    request(`/api/v1/projects/${id}`, login, "PATCH", {
      name: "Race",
      description: "",
      archived: true,
      expectedRevision: 1,
    }),
    request("/api/v1/tasks", login, "POST", {
      projectId: id,
      title: "Race task",
      description: "",
      status: "todo",
      expectedRevision: 1,
    }),
  ]);
  try {
    for (let i = 0; i < 40 && db.pool.totalCount - db.pool.idleCount < 2; i++)
      await delay(20);
    await delay(50);
    // Both HTTP operations hold distinct normal-pool clients behind our owner lock.
    expect(db.pool.totalCount - db.pool.idleCount).toBe(2);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  const [archive, task] = await pending;
  expect([archive.status, task.status].sort()).toEqual([200, 409]);
  const state = workspaceSchema.parse(
    await (await request("/api/v1/workspace", login)).json(),
  );
  expect(state.revision).toBe(2);
  if (archive.status === 200) {
    expect(state.projects[0]?.archived).toBe(true);
    expect(state.tasks).toEqual([]);
  } else {
    expect(state.projects[0]?.archived).toBe(false);
    expect(state.tasks).toHaveLength(1);
  }
});
it("includes readiness plus downstream PostgreSQL delays in the same 12-second deadline and releases clients", async () => {
  const login = await account();
  expect(
    (
      await request("/api/v1/projects", login, "POST", {
        name: "Delay",
        description: "",
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200);
  // Each real statement is below its 5s bound; combined readiness + read exceeds 12s.
  // LIMIT 0 schema probes do not execute the view's materialized pause.
  for (const name of ["schema_migration", "workspace", "project"])
    await db.pool.query(
      `ALTER TABLE ${name} RENAME TO ${name}_data; CREATE VIEW ${name} AS WITH pause AS MATERIALIZED (SELECT pg_sleep(4.3)) SELECT data.* FROM ${name}_data data CROSS JOIN pause`,
    );
  const started = Date.now();
  const response = await request("/api/v1/workspace", login);
  expect(response.status).toBe(503);
  expect(Date.now() - started).toBeLessThan(12800);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(await response.json()).toMatchObject({
    error: { code: "UNAVAILABLE" },
  });
  // A timed-out read can still finish its already-dispatched query; cleanup remains bounded.
  await delay(1500);
  expect(db.pool.waitingCount).toBe(0);
  expect(db.pool.idleCount).toBe(db.pool.totalCount);
  expect(db.readOnly.waitingCount).toBe(0);
  expect(db.readOnly.idleCount).toBe(db.readOnly.totalCount);
}, 25000);
