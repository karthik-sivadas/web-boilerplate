import { once } from "node:events";
import { request as nodeRequest } from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrations } from "better-auth/db/migration";
import { testDatabase } from "./infrastructure/test-database";
import { createPool } from "./infrastructure/postgres";
import { migrate, migrations, schemaReady } from "./infrastructure/migrations";
import { createApp } from "./app";
import { listen } from "./server";
import { authOptions } from "./auth/options";
import { postgresWorkspace } from "./modules/workspace/adapters/postgres/workspace";
import { workspaceSchema, sessionSchema } from "@workspace/contracts/v1";
const config = {
  origin: "http://localhost:3000",
  secret: "synthetic-integration-secret-00000000000000000",
};
const password = "Synthetic-password-only-123!";

describe("real PostgreSQL and HTTP boundary", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let runtime: ReturnType<typeof createApp>;
  let server: ReturnType<typeof listen>;
  let base: string;
  let cookie = "";
  let otherCookie = "";
  let owner = "";
  let projectId = "";
  const capturedSessions = new Map<string, string>();
  beforeAll(async () => {
    db = await testDatabase();
    const plan = await migrations();
    runtime = createApp(db.pool, db.readOnly, config, plan);
    server = listen(runtime.app, 0);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    if (db) await db.close();
  });
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    session = cookie,
    extra: Record<string, string> = {},
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        origin: config.origin,
        cookie: session,
        "content-type": "application/json",
        ...(capturedSessions.has(session)
          ? { "X-Expected-Session-Id": capturedSessions.get(session)! }
          : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  it("fails every route closed before explicit migrations, then migrates concurrently/repeatedly", async () => {
    expect((await request("/health/live")).status).toBe(200);
    expect((await request("/api/auth/get-session")).status).toBe(503);
    const plan = await migrations();
    await Promise.all([migrate(db.pool, plan), migrate(db.planner, plan)]);
    await migrate(db.pool, plan);
    expect(await schemaReady(db.readOnly, plan)).toBe(true);
    expect((await request("/health/ready")).status).toBe(200);
    const generated = await getMigrations(authOptions(db.planner, config));
    expect(generated.toBeCreated).toHaveLength(0);
    expect(generated.toBeAdded).toHaveLength(0);
    expect(generated.schemaProblems).toHaveLength(0);
  });
  it("rejects drift and rolls back partially executed migration SQL and ledger", async () => {
    const plan = await migrations();
    await expect(
      migrate(db.pool, [{ ...plan[0]!, checksum: "drift" }, ...plan.slice(1)]),
    ).rejects.toThrow("drift");
    const sql =
      "CREATE TABLE partial_failure(id integer); SELECT definitely_missing_function();";
    await expect(
      migrate(db.pool, [
        ...plan,
        {
          name: "003-failure.sql",
          sql,
          checksum: createHash("sha256").update(sql).digest("hex"),
        },
      ]),
    ).rejects.toThrow();
    expect(
      (await db.pool.query("SELECT to_regclass('partial_failure') AS name"))
        .rows,
    ).toEqual([{ name: null }]);
    expect(await schemaReady(db.readOnly, plan)).toBe(true);
  });
  it("enforces authentication before private 404 and ignores spoofed actors", async () => {
    expect(
      (
        await request("/api/v1/projects/missing", "GET", undefined, "", {
          "x-user-id": "fake",
        })
      ).status,
    ).toBe(401);
    const response = await request(
      "/api/auth/sign-up/email",
      "POST",
      { name: "First", email: "first@example.test", password },
      "",
    );
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.join(";")).toMatch(/HttpOnly/i);
    expect(cookies.join(";")).toMatch(/SameSite=Lax/i);
    expect(cookies.join(";")).toMatch(/Path=\//i);
    cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const identity = sessionSchema.parse(
      await (await request("/api/v1/session")).json(),
    );
    owner = identity.user.id;
    capturedSessions.set(cookie, identity.sessionId);
    expect(JSON.stringify(identity)).not.toContain("token");
    expect(
      workspaceSchema.parse(await (await request("/api/v1/workspace")).json()),
    ).toEqual({ revision: 0, projects: [], tasks: [] });
    expect((await request("/api/v1/projects/missing")).status).toBe(404);
    const second = await request(
      "/api/auth/sign-up/email",
      "POST",
      { name: "Second", email: "second@example.test", password },
      "",
    );
    expect(second.status).toBe(200);
    otherCookie = second.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    capturedSessions.set(
      otherCookie,
      sessionSchema.parse(
        await (
          await request("/api/v1/session", "GET", undefined, otherCookie)
        ).json(),
      ).sessionId,
    );
    const hashes = await db.pool.query<{ password: string }>(
      "SELECT password FROM account",
    );
    expect(hashes.rows).toHaveLength(2);
    for (const row of hashes.rows) {
      expect(row.password).not.toBe(password);
      expect(row.password.length).toBeGreaterThan(64);
    }
  });
  it("rejects missing/foreign origin, oversized JSON and owner fields", async () => {
    for (const origin of ["", "https://evil.test"])
      expect(
        (
          await request(
            "/api/v1/projects",
            "POST",
            { name: "Project", description: "", expectedRevision: 0 },
            cookie,
            { origin },
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await request("/api/auth/sign-out", "POST", {}, cookie, {
          origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/v1/projects", "POST", {
          name: "Project",
          description: "",
          expectedRevision: 0,
          ownerId: owner,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/v1/projects", "POST", {
          huge: "x".repeat(2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413);
  });
  it("bounds chunked bodies without Content-Length", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = nodeRequest(
        `${base}/api/v1/projects`,
        {
          method: "POST",
          headers: {
            origin: config.origin,
            cookie,
            "content-type": "application/json",
          },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      outgoing.on("error", reject);
      outgoing.write('{"oversize":"');
      for (let i = 0; i < 33; i++) outgoing.write("x".repeat(65536));
      outgoing.end('"}');
    });
    expect(status).toBe(413);
    expect((await request("/health/ready")).status).toBe(200);
  });
  it("creates projects and tasks with server values and prevents cross-account access", async () => {
    const response = await request(
      "/api/v1/projects",
      "POST",
      { name: "Project", description: "", expectedRevision: 0 },
      cookie,
      { "x-user-id": "other" },
    );
    expect(response.status).toBe(200);
    const state = workspaceSchema.parse(await response.json());
    projectId = state.projects[0]!.id;
    expect(projectId).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      (
        await request(
          `/api/v1/projects/${projectId}`,
          "GET",
          undefined,
          otherCookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/api/v1/tasks",
          "POST",
          {
            projectId,
            title: "Task",
            description: "",
            status: "todo",
            expectedRevision: 0,
          },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    const task = await request("/api/v1/tasks", "POST", {
      projectId,
      title: "Task",
      description: "",
      status: "todo",
      expectedRevision: 1,
    });
    expect(task.status).toBe(200);
    expect(
      workspaceSchema.parse(await task.json()).tasks[0]?.createdAt,
    ).toMatch(/^20/);
    expect(
      (
        await request(
          `/api/v1/projects/${projectId}`,
          "PATCH",
          {
            name: "Stolen",
            description: "",
            archived: false,
            expectedRevision: 0,
          },
          otherCookie,
        )
      ).status,
    ).toBe(404);
  });
  it("serializes independent revision races and rolls back domain failures", async () => {
    const results = await Promise.all(
      ["Winner one", "Winner two"].map((name) =>
        request(`/api/v1/projects/${projectId}`, "PATCH", {
          name,
          description: "",
          archived: true,
          expectedRevision: 2,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await request("/api/v1/tasks", "POST", {
          projectId,
          title: "No new task",
          description: "",
          status: "todo",
          expectedRevision: 3,
        })
      ).status,
    ).toBe(409);
    const state = workspaceSchema.parse(
      await (await request("/api/v1/workspace")).json(),
    );
    expect(state.revision).toBe(3);
    expect(state.tasks).toHaveLength(1);
    const task = state.tasks[0]!;
    expect(
      (
        await request(`/api/v1/tasks/${task.id}`, "PATCH", {
          projectId,
          title: "Edited archived task",
          description: "",
          status: "done",
          expectedRevision: 3,
        })
      ).status,
    ).toBe(200);
    expect((await request(`/api/v1/tasks/${task.id}`, "DELETE")).status).toBe(
      400,
    );
    expect(
      (
        await request(`/api/v1/tasks/${task.id}`, "DELETE", undefined, cookie, {
          "if-match": '"4"',
        })
      ).status,
    ).toBe(200);
  });
  it("confirms project deletion, cascades, rejects cross-owner foreign keys and rolls back SQL failures", async () => {
    const other = (await runtime.auth.identity(
      new Headers({ cookie: otherCookie }),
    ))!;
    const created = workspaceSchema.parse(
      await (
        await request(
          "/api/v1/projects",
          "POST",
          { name: "Other project", description: "", expectedRevision: 0 },
          otherCookie,
        )
      ).json(),
    );
    const id = created.projects[0]!.id;
    await expect(
      db.pool.query(
        "INSERT INTO task(owner_id,id,project_id,title,description,status,created_at,updated_at) VALUES($1,'foreign-task',$2,'Title','','todo','2026-09-05T00:00:00.000Z','2026-09-05T00:00:00.000Z')",
        [other.user.id, projectId],
      ),
    ).rejects.toThrow();
    expect(
      (
        await request(
          "/api/v1/tasks",
          "POST",
          {
            projectId: id,
            title: "Cascade task",
            description: "",
            status: "todo",
            expectedRevision: 1,
          },
          otherCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/v1/projects", "GET", undefined, otherCookie)).status,
    ).toBe(200);
    expect(
      (await request("/api/v1/tasks", "GET", undefined, otherCookie)).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/v1/projects/${id}`,
          "DELETE",
          { confirm: "Wrong" },
          otherCookie,
          { "if-match": '"2"' },
        )
      ).status,
    ).toBe(409);
    await db.pool.query(
      "CREATE FUNCTION fail_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic SQL failure'; END $$; CREATE TRIGGER fail_project BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION fail_project()",
    );
    const before = await postgresWorkspace(db.pool).read({
      userId: other.user.id,
    });
    const failed = await request(
      `/api/v1/projects/${id}`,
      "PATCH",
      {
        name: "Trigger failure",
        description: "",
        archived: false,
        expectedRevision: 2,
      },
      otherCookie,
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("synthetic SQL");
    expect(
      await postgresWorkspace(db.planner).read({ userId: other.user.id }),
    ).toEqual(before);
    await db.pool.query(
      "DROP TRIGGER fail_project ON project; DROP FUNCTION fail_project()",
    );
    const deleted = await request(
      `/api/v1/projects/${id}`,
      "DELETE",
      { confirm: "Other project" },
      otherCookie,
      { "if-match": '"2"' },
    );
    expect(workspaceSchema.parse(await deleted.json())).toEqual({
      revision: 3,
      projects: [],
      tasks: [],
    });
  });
  it("bounds a blocked workspace write while consistent reads remain available", async () => {
    const holder = await db.planner.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT revision FROM workspace WHERE owner_id=$1 FOR UPDATE",
        [owner],
      );
      const started = Date.now();
      const response = await request(`/api/v1/projects/${projectId}`, "PATCH", {
        name: "Blocked",
        description: "",
        archived: true,
        expectedRevision: 5,
      });
      expect(response.status).toBe(503);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(
        (await postgresWorkspace(db.pool).read({ userId: owner })).revision,
      ).toBe(5);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });
  it("enforces read-only guard connections for valid, expired and revoked sessions", async () => {
    await expect(db.readOnly.query("DELETE FROM session")).rejects.toThrow(
      /read-only/,
    );
    const before = await db.pool.query("SELECT * FROM session ORDER BY id");
    expect(await runtime.auth.identity(new Headers({ cookie }))).not.toBeNull();
    expect(
      (await db.pool.query("SELECT * FROM session ORDER BY id")).rows,
    ).toEqual(before.rows);
    await db.pool.query(
      'UPDATE session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',
      [owner],
    );
    expect(await runtime.auth.identity(new Headers({ cookie }))).toBeNull();
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM session WHERE "userId"=$1',
          [owner],
        )
      ).rows[0],
    ).toEqual({ count: 1 });
    await db.pool.query('DELETE FROM session WHERE "userId"=$1', [owner]);
    expect(await runtime.auth.identity(new Headers({ cookie }))).toBeNull();
  });
  it("authenticates stored hashes, persists across app replacement, logs out and rate limits spoofed IPs", async () => {
    const login = await request(
      "/api/auth/sign-in/email",
      "POST",
      { email: "first@example.test", password },
      "",
    );
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const replacement = createApp(
      db.pool,
      db.readOnly,
      config,
      await migrations(),
    );
    expect(
      await replacement.auth.identity(new Headers({ cookie })),
    ).not.toBeNull();
    expect(
      (await postgresWorkspace(db.planner).read({ userId: owner })).revision,
    ).toBe(5);
    const logout = await request("/api/auth/sign-out", "POST", {});
    expect(logout.status).toBe(200);
    expect((await request("/api/v1/session")).status).toBe(401);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const limited = await request(
        "/api/auth/sign-in/email",
        "POST",
        { email: "first@example.test", password: "wrong-password" },
        "",
        { "x-forwarded-for": `198.51.100.${i}` },
      );
      statuses.push(limited.status);
      if (limited.status === 429) {
        const seconds = Number(
          limited.headers.get("retry-after") ??
            limited.headers.get("x-retry-after"),
        );
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(60);
      }
    }
    expect(statuses).toContain(429);
  });
  it("persists per-account API rate limits regardless of spoofed headers", async () => {
    const identity = (await runtime.auth.identity(
      new Headers({ cookie: otherCookie }),
    ))!;
    await db.pool.query(
      "UPDATE api_rate_limit SET count=120,window_start=now() WHERE owner_id=$1",
      [identity.user.id],
    );
    const response = await request(
      "/api/v1/workspace",
      "GET",
      undefined,
      otherCookie,
      { "x-forwarded-for": "203.0.113.99" },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
  it("database unavailability is sanitized 503, not an anonymous session", async () => {
    const unavailable = createPool(
      "postgresql://synthetic:synthetic@127.0.0.1:1/test_outage",
      { readOnly: true },
    );
    const outage = listen(
      createApp(db.pool, unavailable, config, await migrations()).app,
      0,
    );
    await once(outage, "listening");
    try {
      const address = outage.address();
      if (!address || typeof address === "string")
        throw new Error("No address");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/session`,
      );
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toContain("requestId");
      expect(text).not.toMatch(/SELECT|postgres|password|stack/);
    } finally {
      await new Promise<void>((resolve) => {
        outage.close(() => resolve());
        outage.closeAllConnections();
      });
      await unavailable.end();
    }
  });
});
