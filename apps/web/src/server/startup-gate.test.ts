// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createStartupGate, exitOnStartupFailure } from "./startup-gate";
const paths = [
  "/api/health",
  "/assets/app.js",
  "/sign-in",
  "/projects",
  "/api/auth/get-session",
  "/_serverFn/real-id",
];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("gates every endpoint class while pending and delegates only after initialization", async () => {
  let ready!: () => void;
  const downstream = vi.fn(() => new Response("ready"));
  const gate = createStartupGate(
    downstream,
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  try {
    await Promise.resolve();
    for (const path of paths) {
      const r = await gate.fetch(new Request(`http://localhost${path}`));
      expect(r.status).toBe(503);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(downstream).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(downstream).not.toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect((await gate.fetch(new Request("http://localhost"))).status).toBe(
      200,
    );
  } finally {
    gate.dispose();
  }
});
it.each(["reject", "timeout"])(
  "fails closed for %s and ignores late initializer success",
  async (mode) => {
    vi.useFakeTimers();
    let ready!: () => void;
    const failure = vi.fn();
    const gate = createStartupGate(
      () => new Response("bad"),
      () =>
        mode === "reject"
          ? Promise.reject(new Error("private detail"))
          : new Promise<void>((resolve) => {
              ready = resolve;
            }),
      { timeoutMs: 10, onFailure: failure },
    );
    await vi.advanceTimersByTimeAsync(11);
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0]).not.toContain("private detail");
    if (ready) {
      ready();
      await vi.advanceTimersByTimeAsync(1);
    }
    for (const path of paths)
      expect(
        (await gate.fetch(new Request(`http://localhost${path}`))).status,
      ).toBe(503);
    gate.dispose();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("production failure policy exits nonzero", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("terminated");
  });
  expect(() => exitOnStartupFailure("failed")).toThrow("terminated");
  expect(exit).toHaveBeenCalledWith(1);
});
