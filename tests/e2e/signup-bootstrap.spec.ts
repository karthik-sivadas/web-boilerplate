import { expect, test as base, type Page } from "@playwright/test";
import { artifactRuntime } from "../artifact-runtime";
import { credentials, signUpUI } from "./auth-fixtures";

// Own the auth rate window as well as the database: this regression must not
// depend on earlier suite signups or need rate-window retries/console filtering.
const test = base.extend<{ ownedOrigin: string }>({
  ownedOrigin: async ({ browser }, provide) => {
    expect(browser.isConnected()).toBe(true);
    const runtime = await artifactRuntime();
    try {
      await provide(runtime.origin);
    } finally {
      await runtime.close();
    }
  },
});

async function holdBootstrap(page: Page, origin: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await held;
    await route.continue();
  });
  await page.goto(`${origin}/sign-up`, { waitUntil: "commit" });
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  return release;
}

test("SSR signup before bootstrap takes the native safety path, not SDK signup", async ({
  page,
  ownedOrigin,
}) => {
  const release = await holdBootstrap(page, ownedOrigin);
  const methods: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      methods.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  try {
    const account = credentials();
    await page.getByLabel("Name", { exact: true }).fill(account.name);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click({ noWaitAfter: true });
    const result = await response;
    console.log(
      `Delayed bootstrap: POST ${new URL(result.url()).pathname} ${result.status()}`,
    );
    expect(methods).toEqual(["POST /sign-up"]);
    expect(result.status()).toBe(200);
    expect(await page.context().cookies()).toEqual([]);
    await expect(
      page.getByRole("heading", { name: "A clearer way to move work forward" }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("signup fixture waits for interactive controls while bootstrap is held", async ({
  page,
  ownedOrigin,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console.error");
  });
  const release = await holdBootstrap(page, ownedOrigin);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      posts.push(new URL(request.url()).pathname);
  });
  const signup = signUpUI(page);
  void signup.catch(() => {});
  try {
    // Observe the fixture reaching the control without advancing bootstrap.
    await expect(
      page.getByRole("button", { name: "Create account", exact: true }),
    ).toBeFocused();
    expect(posts).toEqual([]);
    expect(await page.getByLabel("Email", { exact: true }).inputValue()).toBe(
      "",
    );
  } finally {
    release();
  }
  await signup;
  expect(posts).toEqual(["/api/auth/sign-up/email"]);
  expect(errors).toEqual([]);
});
