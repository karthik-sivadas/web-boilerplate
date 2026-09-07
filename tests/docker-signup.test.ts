// @vitest-environment node
import { setImmediate } from "node:timers/promises";
import type { Page, Response } from "playwright";
import { expect, test, vi } from "vitest";
import { submitDockerSignup } from "./docker-signup";

function fixture() {
  const response = Promise.withResolvers<Response>();
  const click = Promise.withResolvers<void>();
  const waitForResponse = vi.fn(() => response.promise);
  const press = vi.fn(() => click.promise);
  const getByRole = vi.fn(() => ({ click: press }));
  const page = { waitForResponse, getByRole } as unknown as Page;
  return { page, response, click, waitForResponse, getByRole, press };
}

test.each(["response", "click"] as const)(
  "observes %s failure immediately and the sibling rejection during cleanup",
  async (first) => {
    const f = fixture();
    const failure = new Error(`${first} failed`);
    // Handle the aggregate before rejecting either operation. Never leave a
    // rejected promise in the regression itself waiting for a later assertion.
    const outcome = submitDockerSignup(f.page).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );
    f[first].reject(failure);
    await setImmediate();
    const sibling = first === "response" ? "click" : "response";
    f[sibling].reject(new Error("browser closed during owned cleanup"));
    expect((await outcome).error).toBe(failure);
    await setImmediate(); // Cross the unhandled-rejection checkpoint for both.
    expect(f.waitForResponse).toHaveBeenCalledOnce();
    expect(f.press).toHaveBeenCalledOnce();
  },
);

test("waits for both operations and retains the actual SDK POST response", async () => {
  const f = fixture();
  const result = submitDockerSignup(f.page);
  // Attach an observer immediately, even though this case only resolves.
  const response = { status: () => 200 } as Response;
  let settled = false;
  const outcome = result.then(
    (actual) => {
      settled = true;
      return { actual, error: undefined };
    },
    (error: unknown) => ({ actual: undefined, error }),
  );
  f.response.resolve(response);
  await setImmediate();
  expect(settled).toBe(false);
  f.click.resolve();
  expect(await outcome).toEqual({ actual: response, error: undefined });
  expect(f.getByRole).toHaveBeenCalledWith("button", {
    name: "Create account",
    exact: true,
  });
  const predicate = f.waitForResponse.mock.calls[0] as unknown as [
    (response: Response) => boolean,
  ];
  for (const [path, method, expected] of [
    ["/api/auth/sign-up/email?ignored=1", "POST", true],
    ["/api/auth/sign-up/email", "GET", false],
    ["/sign-up", "POST", false],
  ] as const) {
    expect(
      predicate[0]({
        url: () => `http://owned.test${path}`,
        request: () => ({ method: () => method }),
      } as Response),
    ).toBe(expected);
  }
});
