import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authPost,
  credentials,
  paceRateWindow,
  signUpUI,
} from "./auth-fixtures";

test.beforeEach(() => {
  test.setTimeout(240_000);
});
async function axe(page: Page) {
  await expect(page.locator("[data-entering], [data-exiting]")).toHaveCount(0);
  // Loading-to-enabled opacity/color transitions are not Aria overlay entering markers.
  // Audit their settled state, without sleeping or disabling contrast checks.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
}
async function signedUp(page: Page) {
  await page.goto("/sign-up");
  const account = await signUpUI(page);
  await expect(
    page.getByRole("heading", { name: "A clearer way to move work forward" }),
  ).toBeVisible();
  return account;
}
async function signInUI(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  for (let n = 0; n < 3; n++) {
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/sign-in/email"),
    );
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .press("Enter");
    const result = await response;
    if (result.status() !== 429) return result;
    await paceRateWindow(result.headers());
  }
  throw new Error("Signin fixture exceeded bounded pacing");
}
test("real account forms validate, reject bad credentials, sign in with keyboard, and mobile/desktop logout revokes cookie", async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto("/sign-up");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .press("Enter");
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  expect(
    await page
      .getByLabel("Name", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
  ).toBe(true);
  await axe(page);
  const account = await signedUp(page);
  const cookie = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in$/);
  expect(
    await (
      await request.get(`${baseURL}/api/auth/get-session`, {
        headers: { Cookie: cookie },
      })
    ).json(),
  ).toBeNull();
  const password = credentials().password;
  expect((await signInUI(page, account.email, password)).status()).toBe(401);
  await expect(page.getByRole("alert")).toBeVisible();
  await axe(page);
  expect((await signInUI(page, account.email, account.password)).status()).toBe(
    200,
  );
  await expect(
    page.getByRole("heading", { name: "A clearer way to move work forward" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in$/);
  await axe(page);
});

test("two-tab A to B focus reconciliation, same-user session replacement and revocation discard private drafts", async ({
  page,
  context,
  baseURL,
}) => {
  await signedUp(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("A private task");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByText("A private task")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  const b = credentials();
  expect(
    (await authPost(context.request, baseURL!, "sign-up/email", b)).status(),
  ).toBe(200);
  await second.reload();
  await expect(second.getByText(b.email, { exact: true })).toBeAttached();
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  let observed!: () => void;
  const requested = new Promise<void>((r) => {
    observed = r;
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    observed();
    await hold;
    await route.continue();
  });
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await requested;
  await expect(
    page.getByRole("heading", { name: "Checking your session…" }),
  ).toBeVisible();
  await expect(page.getByText("A private task")).not.toBeVisible();
  release();
  await expect(page.getByText(b.email, { exact: true })).toBeAttached();
  await page.unroute("**/api/auth/get-session**");
  await expect(page.getByText("A private task")).not.toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("old B session draft");
  const before = (await (
    await context.request.get(`${baseURL}/api/auth/get-session`)
  ).json()) as { session: { id: string } };
  expect(
    (
      await authPost(context.request, baseURL!, "sign-in/email", {
        email: b.email,
        password: b.password,
      })
    ).status(),
  ).toBe(200);
  const after = (await (
    await context.request.get(`${baseURL}/api/auth/get-session`)
  ).json()) as { session: { id: string } };
  expect(after.session.id).not.toBe(before.session.id);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("dialog", { name: "New task" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await second.bringToFront();
  await expect(
    second.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Sign out", exact: true }).click();
  // No synthetic focus event here: the other tab's token-free channel invalidates this tab.
  await expect(page).toHaveURL(/sign-in$/);
  await expect(page.getByText(b.email, { exact: true })).not.toBeVisible();
  await second.close();
});

test("failed session reconciliation and ambiguous logout lock private content until fresh verification", async ({
  page,
}) => {
  await signedUp(page);
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Workspace locked" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace", exact: true }),
  ).not.toBeVisible();
  await page.unroute("**/api/auth/get-session**");
  await page.getByRole("button", { name: "Check session again" }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in$/);
});

test("actual generated protected RPC returns HTTP 401 and cache policy survives query suffixes and cookies", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const account = await signedUp(page);
  const endpoints = new Set<string>();
  page.on("request", (r) => {
    if (r.headers()["x-tsr-serverfn"] === "true") endpoints.add(r.url());
  });
  await page.getByRole("link", { name: "Demo settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(endpoints.size).toBeGreaterThan(0);
  let protectedURL = "";
  for (const url of endpoints) {
    const response = await request.get(url, {
      headers: { "x-tsr-serverFn": "true", Accept: "application/json" },
    });
    if (response.status() === 401) protectedURL = url;
  }
  expect(protectedURL).not.toBe("");
  for (const suffix of ["", "?probe=/api/health"]) {
    for (const headers of [
      {},
      { "x-tsr-serverFn": "true", Accept: "application/json" },
    ]) {
      const denied = await request.get(protectedURL.split("?")[0]! + suffix, {
        headers,
      });
      expect(denied.status()).toBe(401);
      expect(denied.headers()["cache-control"]).toBe("private, no-store");
      expect(await denied.text()).not.toContain(account.email);
    }
    for (const path of [
      "/",
      "/projects",
      "/projects/private-fixture",
      "/tasks",
      "/settings",
      "/api/auth/get-session",
      "/sign-in",
    ]) {
      const response = await request.get(`${baseURL}${path}${suffix}`, {
        maxRedirects: 0,
      });
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      if (path !== "/api/auth/get-session" && path !== "/sign-in")
        expect(response.status()).toBe(307);
    }
    const authed = await context.request.get(`${baseURL}/projects${suffix}`);
    expect(authed.status()).toBe(200);
    expect(authed.headers()["cache-control"]).toBe("private, no-store");
    const profile = await context.request.get(
      protectedURL.split("?")[0]! + suffix,
      { headers: { "x-tsr-serverFn": "true", Accept: "application/json" } },
    );
    expect(profile.status()).toBe(200);
    expect(profile.headers()["cache-control"]).toBe("private, no-store");
    expect(await profile.text()).not.toContain("session_token");
  }
  const response = await authPost(context.request, baseURL!, "sign-in/email", {
    email: account.email,
    password: account.password,
  });
  expect(response.status()).toBe(200);
  expect(
    response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie")
      .length,
  ).toBeGreaterThan(0);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});
