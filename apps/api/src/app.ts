import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timeout } from "hono/timeout";
import { ZodError } from "zod";
import {
  expectedSessionHeader,
  expectedSessionIdSchema,
} from "@workspace/contracts/v1";
import {
  workspaceApplication,
  preservationApplication,
  WorkspaceFailure,
} from "@workspace/core";
import { preservationRoutes } from "./modules/workspace/http/preservation";
import type { Pool } from "pg";
import { createAuth, type AuthConfig } from "./auth/options";
import { schemaReady, type Migration } from "./infrastructure/migrations";
import { HttpFailure, type ApiEnvironment } from "./infrastructure/http";
import { postgresWorkspace } from "./modules/workspace/adapters/postgres/workspace";
import { workspaceRoutes } from "./modules/workspace/http/routes";

function assertActive(expired: boolean, signal: AbortSignal) {
  if (expired || signal.aborted)
    throw new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
}

export function createApp(
  pool: Pool,
  readOnly: Pool,
  config: AuthConfig,
  plan: Migration[],
) {
  const app = new Hono<ApiEnvironment>();
  let initializedAuth: ReturnType<typeof createAuth> | undefined;
  const getAuth = () =>
    (initializedAuth ??= createAuth(pool, readOnly, config));
  const store = postgresWorkspace(pool);
  const workspace = workspaceApplication(store, {
    id: randomUUID,
    now: () => new Date().toISOString(),
  });
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    c.set("requestExpired", false);
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
    // Opaque auth Responses replace the context response: reapply transport policy.
    c.header("Cache-Control", "private, no-store");
    c.header("X-Request-Id", c.get("requestId"));
    c.header("X-Content-Type-Options", "nosniff");
  });
  app.use(
    "*",
    timeout(12000, (c) => {
      c.set("requestExpired", true);
      return new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
    }),
  );
  app.use("*", async (c, next) => {
    if (c.req.path === "/health/live") {
      await next();
      return;
    }
    if (!(await schemaReady(readOnly, plan)))
      throw new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
    assertActive(c.get("requestExpired"), c.req.raw.signal);
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: () => {
        throw new HttpFailure(413, "BODY_TOO_LARGE", "Request body too large.");
      },
    }),
  );
  app.use("*", async (c, next) => {
    assertActive(c.get("requestExpired"), c.req.raw.signal);
    const headers = new Headers(c.req.raw.headers);
    for (const name of [...headers.keys()])
      if (
        name.startsWith("x-forwarded-") ||
        name === "forwarded" ||
        name === "x-user-id" ||
        name === "x-real-ip"
      )
        headers.delete(name);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      (headers.get("origin") !== config.origin ||
        headers.get("sec-fetch-site") === "cross-site")
    )
      throw new HttpFailure(403, "CSRF", "Origin not allowed.");
    if (c.req.path.startsWith("/api/auth/")) {
      const response = await getAuth().auth.handler(
        new Request(c.req.raw, { headers }),
      );
      assertActive(c.get("requestExpired"), c.req.raw.signal);
      if (response.status >= 500)
        throw new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
      // Better Auth can swallow DELETE failures on sign-out. Check the ORIGINAL
      // cookie through its database-authoritative guard before forwarding success
      // or any cookie expiration. Never parse cookies or change public refresh.
      if (
        c.req.method === "POST" &&
        c.req.path.replace(/\/+$/, "") === "/api/auth/sign-out" &&
        response.ok &&
        (await getAuth().identity(headers))
      )
        throw new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
      return response;
    }
    if (c.req.path.startsWith("/api/v1/")) {
      const identity = await getAuth().identity(headers);
      assertActive(c.get("requestExpired"), c.req.raw.signal);
      if (!identity)
        throw new HttpFailure(401, "UNAUTHENTICATED", "Sign in required.");
      c.set("identity", identity);
      // A captured lease is a precondition, never an authentication credential.
      // Gate the entire versioned surface except session discovery, including
      // future import/export/rollback and unknown routes, before business access.
      if (c.req.path !== "/api/v1/session") {
        const expected = expectedSessionIdSchema.safeParse(
          headers.get(expectedSessionHeader),
        );
        if (!expected.success)
          throw new HttpFailure(
            400,
            "SESSION_BINDING_REQUIRED",
            "A valid expected session ID is required.",
          );
        if (expected.data !== identity.sessionId)
          throw new HttpFailure(
            409,
            "SESSION_CHANGED",
            "Session changed. Reconcile before retrying.",
          );
      }
      // One bounded persistent row per verified account, never spoofable IP/header keys.
      const rate = await pool.query<{ count: number }>(
        "INSERT INTO api_rate_limit(owner_id,window_start,count) VALUES($1,now(),1) ON CONFLICT(owner_id) DO UPDATE SET count=CASE WHEN api_rate_limit.window_start < now()-interval '60 seconds' THEN 1 ELSE LEAST(api_rate_limit.count+1,121) END, window_start=CASE WHEN api_rate_limit.window_start < now()-interval '60 seconds' THEN now() ELSE api_rate_limit.window_start END RETURNING count",
        [identity.user.id],
      );
      assertActive(c.get("requestExpired"), c.req.raw.signal);
      if ((rate.rows[0]?.count ?? 121) > 120) {
        c.header("Retry-After", "60");
        throw new HttpFailure(429, "RATE_LIMITED", "Too many requests.");
      }
    }
    await next();
  });
  app.get("/health/live", (c) => c.json({ status: "ok" }));
  app.get("/health/ready", (c) => c.json({ status: "ready" }));
  app.get("/api/v1/session", (c) => c.json(c.get("identity")));
  workspaceRoutes(app, workspace);
  preservationRoutes(
    app,
    store,
    preservationApplication(store, {
      id: randomUUID,
      now: () => new Date().toISOString(),
    }),
  );
  app.notFound(() => {
    throw new HttpFailure(404, "NOT_FOUND", "Resource not found.");
  });
  app.onError((error, c) => {
    let failure: HttpFailure;
    if (error instanceof HttpFailure) failure = error;
    else if (error instanceof ZodError || error instanceof SyntaxError)
      failure = new HttpFailure(400, "VALIDATION", "Invalid request.");
    else if (error instanceof WorkspaceFailure)
      failure = new HttpFailure(
        error.code === "NOT_FOUND" ? 404 : 409,
        error.code,
        error.message,
      );
    else failure = new HttpFailure(503, "UNAVAILABLE", "Service unavailable.");
    console.error(
      JSON.stringify({
        event: "request_failed",
        requestId: c.get("requestId"),
        status: failure.status,
        code: failure.code,
      }),
    );
    // An unread rejected request body must not leave a reusable keepalive connection.
    if (failure.status === 413) c.header("Connection", "close");
    return c.json(
      {
        error: {
          code: failure.code,
          message: failure.message,
          requestId: c.get("requestId"),
        },
      },
      failure.status,
    );
  });
  return {
    app,
    get auth() {
      return getAuth();
    },
  };
}
