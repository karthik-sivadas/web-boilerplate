import type { Hono } from "hono";
import type { workspaceApplication } from "@workspace/core";
import {
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteProjectSchema,
  parseIfMatch,
} from "@workspace/contracts/v1";
import { HttpFailure, type ApiEnvironment } from "../../../infrastructure/http";

function revision(header: string | undefined) {
  try {
    return parseIfMatch(header);
  } catch {
    throw new HttpFailure(
      400,
      "VALIDATION",
      "A quoted If-Match revision is required.",
    );
  }
}
export function workspaceRoutes(
  app: Hono<ApiEnvironment>,
  workspace: ReturnType<typeof workspaceApplication>,
) {
  app.get("/api/v1/workspace", async (c) => {
    const state = await workspace.read({ userId: c.get("identity").user.id });
    c.header("ETag", `"${state.revision}"`);
    return c.json(state);
  });
  for (const kind of ["projects", "tasks"] as const) {
    app.get(`/api/v1/${kind}`, async (c) => {
      const state = await workspace.read({ userId: c.get("identity").user.id });
      c.header("ETag", `"${state.revision}"`);
      return c.json({ revision: state.revision, [kind]: state[kind] });
    });
    app.get(`/api/v1/${kind}/:id`, async (c) => {
      const state = await workspace.read({ userId: c.get("identity").user.id });
      const item = state[kind].find((item) => item.id === c.req.param("id"));
      if (!item) throw new HttpFailure(404, "NOT_FOUND", "Resource not found.");
      c.header("ETag", `"${state.revision}"`);
      return c.json({ revision: state.revision, item });
    });
  }
  app.post("/api/v1/projects", async (c) => {
    const { expectedRevision, ...input } = createProjectSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        expectedRevision,
        { type: "createProject", input },
      ),
    );
  });
  app.patch("/api/v1/projects/:id", async (c) => {
    const { expectedRevision, ...input } = updateProjectSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        expectedRevision,
        { type: "updateProject", id: c.req.param("id"), input },
      ),
    );
  });
  app.post("/api/v1/tasks", async (c) => {
    const { expectedRevision, ...input } = createTaskSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        expectedRevision,
        { type: "createTask", input },
      ),
    );
  });
  app.patch("/api/v1/tasks/:id", async (c) => {
    const { expectedRevision, ...input } = updateTaskSchema.parse(
      await c.req.json(),
    );
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        expectedRevision,
        { type: "updateTask", id: c.req.param("id"), input },
      ),
    );
  });
  app.delete("/api/v1/projects/:id", async (c) => {
    const expectedRevision = revision(c.req.header("if-match"));
    const { confirm } = deleteProjectSchema.parse(await c.req.json());
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        expectedRevision,
        { type: "deleteProject", id: c.req.param("id"), confirm },
      ),
    );
  });
  app.delete("/api/v1/tasks/:id", async (c) => {
    return c.json(
      await workspace.execute(
        { userId: c.get("identity").user.id },
        revision(c.req.header("if-match")),
        { type: "deleteTask", id: c.req.param("id") },
      ),
    );
  });
}
