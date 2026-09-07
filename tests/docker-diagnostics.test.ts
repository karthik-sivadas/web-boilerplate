// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { dockerDiagnostics } from "./docker-diagnostics";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

test("failure diagnostics are bounded and never retain arbitrary browser text or URL data", async () => {
  const print = vi.spyOn(console, "error").mockImplementation(() => {});
  const page = new EventEmitter();
  const diagnostics = dockerDiagnostics();
  diagnostics.attach(page as unknown as Page);
  const secret = "synthetic-private-value";
  for (let n = 0; n < 250; n++) {
    page.emit("response", {
      request: () => ({ method: () => "POST" }),
      url: () =>
        `https://${secret}@example.test/api/auth/sign-up/email?password=${secret}`,
      status: () => 422,
    });
  }
  page.emit("response", {
    request: () => ({ method: () => "GET" }),
    url: () => `https://example.test/${secret}`,
    status: () => 404,
  });
  page.emit("pageerror", { name: secret, message: secret, stack: secret });
  page.emit("console", { type: () => "error", text: () => secret });
  page.emit("requestfailed", {
    url: () => `https://example.test/assets/${secret}.js`,
    failure: () => ({ errorText: secret }),
  });
  await diagnostics.save();
  const text = vi.mocked(writeFile).mock.calls.at(-1)![1] as string;
  expect(text).not.toContain(secret);
  const result = JSON.parse(text) as { events: unknown[] };
  expect(result.events).toHaveLength(200);
  expect(result.events[0]).toEqual({
    kind: "response",
    method: "POST",
    path: "/api/auth/sign-up/email",
    status: 422,
  });
  expect(result.events.slice(-4)).toEqual([
    { kind: "response", method: "GET", path: "[other]", status: 404 },
    { kind: "pageerror", error: "[other error]" },
    { kind: "console", level: "error" },
    {
      kind: "requestfailed",
      path: "/assets/[asset]",
      error: "[other network error]",
    },
  ]);
  expect(print.mock.calls[0]![0]).not.toContain(secret);
  expect(vi.mocked(writeFile).mock.calls.at(-1)![0]).toBe(
    "test-results/docker-smoke/diagnostics.json",
  );
});
