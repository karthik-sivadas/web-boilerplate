import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { createSessionController } from "./session-controller";
import type { SessionIdentity } from "./identity";
const identity = (user = "a", session = "first"): SessionIdentity => ({
  sessionId: session,
  user: { id: user, name: user, email: `${user}@example.test` },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function fixture() {
  const deps = {
    httpSession: vi
      .fn<() => Promise<SessionIdentity | null>>()
      .mockResolvedValue(identity()),
    routeSession: vi
      .fn<() => Promise<SessionIdentity | null>>()
      .mockResolvedValue(identity()),
    clearQueries: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
  };
  return { deps, controller: createSessionController(deps) };
}
it("never trusts initial identity and synchronously revokes old action leases on refetch", async () => {
  const { deps, controller } = fixture();
  expect(controller.getSnapshot().status).toBe("pending");
  await controller.revalidate();
  const old = controller.lease(controller.getSnapshot().epoch);
  expect(old()).toBe(true);
  const pending = deferred<SessionIdentity | null>();
  deps.httpSession.mockReturnValueOnce(pending.promise);
  const request = controller.revalidate();
  expect(controller.getSnapshot().status).toBe("pending");
  expect(old()).toBe(false);
  pending.resolve(identity());
  await request;
  expect(controller.getSnapshot().status).toBe("ready");
  expect(old()).toBe(false);
  controller.dispose();
});
it.each([null, identity("b"), identity("a", "replacement")])(
  "reconciles revocation, A to B and same-user replacement without old session fallback: %j",
  async (next) => {
    const { deps, controller } = fixture();
    await controller.revalidate();
    const old = controller.lease(controller.getSnapshot().epoch);
    deps.httpSession.mockResolvedValue(next);
    deps.routeSession.mockResolvedValue(next);
    await controller.revalidate();
    expect(old()).toBe(false);
    expect(controller.getSnapshot().status).toBe(next ? "ready" : "guest");
    expect(deps.clearQueries).toHaveBeenCalledTimes(2);
    controller.dispose();
  },
);
it("fails closed for SDK failure and fresh RPC mismatch/error", async () => {
  const { deps, controller } = fixture();
  deps.httpSession.mockRejectedValueOnce(new Error("offline"));
  await controller.revalidate();
  expect(controller.getSnapshot().status).toBe("error");
  deps.routeSession.mockResolvedValueOnce(identity("b"));
  await controller.revalidate();
  expect(controller.getSnapshot().status).toBe("error");
  deps.routeSession.mockRejectedValueOnce(new Error("RPC failed"));
  await controller.revalidate();
  expect(controller.getSnapshot().status).toBe("error");
  controller.dispose();
});
it("ignores late session results after a newer identity or disposal", async () => {
  const { deps, controller } = fixture();
  const old = deferred<SessionIdentity | null>();
  deps.httpSession.mockReturnValueOnce(old.promise);
  const first = controller.revalidate();
  await Promise.resolve();
  deps.httpSession.mockResolvedValue(identity("b"));
  deps.routeSession.mockResolvedValue(identity("b"));
  await controller.revalidate();
  old.resolve(identity());
  await first;
  expect(controller.getSnapshot()).toMatchObject({
    status: "ready",
    identity: identity("b"),
  });
  controller.dispose();
  expect(controller.getSnapshot().status).toBe("pending");
});
it("cancels real QueryClient requests and prevents late A results repopulating B cache", async () => {
  const query = new QueryClient();
  const result = deferred<string>();
  const request = query
    .fetchQuery({
      queryKey: ["private", result.promise],
      queryFn: () => result.promise,
    })
    .catch(() => undefined);
  const { deps } = fixture();
  deps.clearQueries.mockImplementation(async () => {
    const cancelled = query.cancelQueries();
    query.clear();
    await cancelled;
  });
  const controller = createSessionController(deps);
  await controller.revalidate();
  result.resolve("private A result");
  await request;
  expect(query.getQueryData(["private", result.promise])).toBeUndefined();
  expect(query.getQueryCache().getAll()).toHaveLength(0);
  controller.dispose();
});
it("ambiguous logout hides immediately, revalidates, and reports uncertainty honestly", async () => {
  const { deps, controller } = fixture();
  await controller.revalidate();
  const old = controller.lease(controller.getSnapshot().epoch);
  deps.signOut.mockRejectedValueOnce(new Error("network"));
  const logout = controller.signOut();
  expect(old()).toBe(false);
  expect(controller.getSnapshot().status).toBe("pending");
  await logout;
  expect(controller.getSnapshot().status).toBe("ready");
  expect(controller.getSnapshot().message).toContain("could not be confirmed");
  deps.signOut.mockRejectedValueOnce(new Error("network"));
  deps.httpSession.mockRejectedValueOnce(new Error("offline"));
  await controller.signOut();
  expect(controller.getSnapshot().status).toBe("error");
  controller.dispose();
});
it("successful logout checks HTTP revocation and waits through concurrent focus", async () => {
  const { deps, controller } = fixture();
  await controller.revalidate();
  const wait = deferred<void>();
  deps.signOut.mockReturnValueOnce(wait.promise);
  deps.httpSession.mockResolvedValue(null);
  const logout = controller.signOut();
  await controller.revalidate();
  expect(controller.getSnapshot().status).toBe("pending");
  wait.resolve();
  await logout;
  expect(controller.getSnapshot().status).toBe("guest");
  controller.dispose();
});
