import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type {
  preservationApplication,
  WorkspacePreservation,
} from "@workspace/core";
import {
  exportSchema,
  importSchema,
  rollbackSchema,
} from "@workspace/contracts/v1";
import type { ApiEnvironment } from "../../../infrastructure/http";
export function preservationRoutes(
  app: Hono<ApiEnvironment>,
  store: WorkspacePreservation,
  operations: ReturnType<typeof preservationApplication>,
) {
  app.get("/api/v1/workspace/import-receipt", async (c) =>
    c.json({
      receipt: await store.receipt({ userId: c.get("identity").user.id }),
    }),
  );
  app.get("/api/v1/workspace/export", async (c) => {
    const { projects, tasks } = await store.read({
      userId: c.get("identity").user.id,
    });
    c.header("Content-Disposition", 'attachment; filename="workspace.json"');
    return c.json(
      exportSchema.parse({ version: 1, workspace: { projects, tasks } }),
    );
  });
  app.post("/api/v1/workspace/import", async (c) => {
    const { expectedRevision, data } = importSchema.parse(await c.req.json());
    const canonical = {
      version: 1,
      workspace: {
        projects: [...data.workspace.projects].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
        tasks: [...data.workspace.tasks].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      },
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");
    const workspace = await operations.import(
      { userId: c.get("identity").user.id },
      expectedRevision,
      fingerprint,
      canonical.workspace,
    );
    return c.json({
      workspace,
      receipt: { fingerprint, importedRevision: workspace.revision },
    });
  });
  app.post("/api/v1/workspace/rollback", async (c) => {
    const { expectedRevision, fingerprint } = rollbackSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await operations.rollback(
        { userId: c.get("identity").user.id },
        expectedRevision,
        fingerprint,
      ),
    );
  });
}
