import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterEach, beforeEach, expect, it } from "vitest";
import { testDatabase } from "./infrastructure/test-database";
import { migrate, migrations } from "./infrastructure/migrations";
import { createApp } from "./app";
import { listen } from "./server";
import {
  sessionSchema,
  exportSchema,
  importResultSchema,
  workspaceSchema,
  type ExportDto,
} from "@workspace/contracts/v1";
let db: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof listen>;
let base: string;
const origin = "http://localhost:3000";
type Identity = { cookie: string; sessionId: string };
beforeEach(async () => {
  db = await testDatabase();
  const plan = await migrations();
  await migrate(db.pool, plan);
  server = listen(
    createApp(
      db.pool,
      db.readOnly,
      { origin, secret: "synthetic-preservation-secret-00000000000000" },
      plan,
    ).app,
    0,
  );
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await db.close();
});
function request(path: string, identity?: Identity, body?: unknown) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: identity?.cookie ?? "",
      "X-Expected-Session-Id": identity?.sessionId ?? "",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function account() {
  const response = await request("/api/auth/sign-up/email", undefined, {
    name: "Import",
    email: `${randomUUID()}@example.test`,
    password: "Synthetic-import-password-123!",
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = sessionSchema.parse(
    await (await request("/api/v1/session", { cookie, sessionId: "" })).json(),
  );
  return { cookie, sessionId: session.sessionId };
}
const fixture: ExportDto = {
  version: 1,
  workspace: {
    projects: [
      { id: "old-project", name: "Imported", description: "", archived: true },
    ],
    tasks: [
      {
        id: "old-task",
        projectId: "old-project",
        title: "Preserved task",
        description: "",
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  },
};
it("remaps IDs and references, exports a roundtrippable envelope, prevents duplicates and guards rollback", async () => {
  const a = await account(),
    b = await account();
  const imported = importResultSchema.parse(
    await (
      await request("/api/v1/workspace/import", a, {
        expectedRevision: 0,
        data: fixture,
      })
    ).json(),
  );
  expect(imported.workspace.projects[0]?.id).not.toBe("old-project");
  expect(imported.workspace.tasks[0]?.projectId).toBe(
    imported.workspace.projects[0]?.id,
  );
  expect(
    (
      await request("/api/v1/workspace/import", a, {
        expectedRevision: 1,
        data: fixture,
      })
    ).status,
  ).toBe(409);
  const exported = exportSchema.parse(
    await (await request("/api/v1/workspace/export", a)).json(),
  );
  const copy = importResultSchema.parse(
    await (
      await request("/api/v1/workspace/import", b, {
        expectedRevision: 0,
        data: exported,
      })
    ).json(),
  );
  expect(copy.workspace.tasks[0]?.createdAt).toBe(
    fixture.workspace.tasks[0]?.createdAt,
  );
  expect(
    (
      await request("/api/v1/workspace/rollback", b, {
        expectedRevision: 1,
        fingerprint: imported.receipt.fingerprint,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/api/v1/projects", b, {
        expectedRevision: 1,
        name: "Subsequent edit",
        description: "",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/api/v1/workspace/rollback", b, {
        expectedRevision: 2,
        fingerprint: copy.receipt.fingerprint,
      })
    ).status,
  ).toBe(409);
  expect(
    workspaceSchema.parse(
      await (
        await request("/api/v1/workspace/rollback", a, {
          expectedRevision: 1,
          fingerprint: imported.receipt.fingerprint,
        })
      ).json(),
    ),
  ).toEqual({ revision: 2, projects: [], tasks: [] });
  expect(
    (
      await request("/api/v1/workspace/import", a, {
        expectedRevision: 2,
        data: fixture,
      })
    ).status,
  ).toBe(409);
});
it("rejects broken references and rolls back receipts, workspace row and partial inserts after SQL failure", async () => {
  const identity = await account();
  expect(
    (
      await request("/api/v1/workspace/import", identity, {
        expectedRevision: 0,
        data: {
          ...fixture,
          workspace: { projects: [], tasks: fixture.workspace.tasks },
        },
      })
    ).status,
  ).toBe(400);
  await db.pool.query(
    "CREATE FUNCTION fail_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic import failure'; END $$; CREATE TRIGGER fail_import BEFORE INSERT ON task FOR EACH ROW EXECUTE FUNCTION fail_import()",
  );
  const failed = await request("/api/v1/workspace/import", identity, {
    expectedRevision: 0,
    data: fixture,
  });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("synthetic import failure");
  expect(
    (await db.pool.query("SELECT * FROM workspace_import_receipt")).rows,
  ).toEqual([]);
  expect((await db.pool.query("SELECT * FROM workspace")).rows).toEqual([]);
  await db.pool.query(
    "DROP TRIGGER fail_import ON task; DROP FUNCTION fail_import()",
  );
  expect(
    (
      await request("/api/v1/workspace/import", identity, {
        expectedRevision: 0,
        data: fixture,
      })
    ).status,
  ).toBe(200);
});
it("roundtrips the maximum entity counts with a near-limit escaped aggregate through HTTP", async () => {
  const a = await account(),
    b = await account();
  const projects = Array.from({ length: 100 }, () => ({
    id: randomUUID(),
    name: "Project",
    description: "Description",
    archived: false,
  }));
  const tasks = Array.from({ length: 1000 }, (_, index) => ({
    id: randomUUID(),
    projectId: projects[index % 100]!.id,
    title: "t".repeat(120),
    description: String.fromCharCode(1).repeat(280),
    status: "todo" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const data = { version: 1, workspace: { projects, tasks } };
  expect(
    (
      await request("/api/v1/workspace/import", a, {
        expectedRevision: 0,
        data,
      })
    ).status,
  ).toBe(200);
  const exported = exportSchema.parse(
    await (await request("/api/v1/workspace/export", a)).json(),
  );
  const body = { expectedRevision: 0, data: exported };
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(2 * 1024 * 1024);
  expect((await request("/api/v1/workspace/import", b, body)).status).toBe(200);
  expect(
    workspaceSchema.parse(await (await request("/api/v1/workspace", b)).json())
      .tasks,
  ).toHaveLength(1000);
}, 30000);
