import { afterEach, expect, it, vi } from "vitest";
import { workspaceSchema } from "@workspace/contracts/v1";
import { workspaceRequest } from "./client";
afterEach(() => vi.unstubAllGlobals());
it("captures expected session and refuses dispatch from an expired lease", async () => {
  const fetcher = vi.fn((_url: string, _options: RequestInit) =>
    Promise.resolve(Response.json({ revision: 0, projects: [], tasks: [] })),
  );
  vi.stubGlobal("fetch", fetcher);
  const lease = {
    sessionId: "captured",
    canAct: () => true,
    reconcile: vi.fn(() => Promise.resolve()),
  };
  await workspaceRequest(lease, "workspace", workspaceSchema);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/workspace");
  expect(
    new Headers(fetcher.mock.calls[0]?.[1].headers).get(
      "X-Expected-Session-Id",
    ),
  ).toBe("captured");
  await expect(
    workspaceRequest(
      { ...lease, canAct: () => false },
      "workspace",
      workspaceSchema,
    ),
  ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("discards late successful mutations and late errors without reconciling a newer session", async () => {
  for (const status of [200, 401]) {
    let finish!: (response: Response) => void;
    let current = true;
    const reconcile = vi.fn(() => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = workspaceRequest(
      { sessionId: "old", canAct: () => current, reconcile },
      "projects",
      workspaceSchema,
      {
        method: "POST",
        body: { expectedRevision: 0, name: "Draft", description: "" },
      },
    );
    current = false;
    finish(Response.json({ revision: 1, projects: [], tasks: [] }, { status }));
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(reconcile).not.toHaveBeenCalled();
  }
});
it("reconciles current-session mismatch but never silently retries a mutation", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      Response.json(
        {
          error: {
            code: "SESSION_CHANGED",
            message: "Changed",
            requestId: crypto.randomUUID(),
          },
        },
        { status: 409 },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const reconcile = vi.fn(() => Promise.resolve());
  await expect(
    workspaceRequest(
      { sessionId: "old", canAct: () => true, reconcile },
      "projects",
      workspaceSchema,
      { method: "POST" },
    ),
  ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(reconcile).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});
