import { expect, test } from "@playwright/test";
import { authPost, credentials } from "./auth-fixtures";

test.use({ javaScriptEnabled: false });

for (const path of ["/sign-up", "/sign-in"]) {
  test(`${path} native submission keeps credentials out of the URL without JavaScript`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const account = credentials();
    await page.goto(path);
    if (path === "/sign-up")
      await page.getByLabel("Name", { exact: true }).fill(account.name);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    const outgoing = page.waitForRequest((request) =>
      request.isNavigationRequest(),
    );
    const response = page.waitForResponse((response) =>
      response.request().isNavigationRequest(),
    );
    await page
      .getByRole("button", {
        name: path === "/sign-up" ? "Create account" : "Sign in",
        exact: true,
      })
      .click();
    const request = await outgoing;
    const fallback = await response;
    expect(request.method()).toBe("POST");
    expect(new URL(request.url()).pathname).toBe(path);
    expect(new URL(request.url()).search).toBe("");
    expect(new URLSearchParams(request.postData() ?? "").get("password")).toBe(
      account.password,
    );
    expect(new URL(page.url()).search).toBe("");
    // Start re-renders the HTML page with 200; that is not authentication success.
    expect(fallback.status()).toBe(200);
    expect(fallback.headers()["cache-control"]).toBe("private, no-store");
    expect(
      await (await context.request.get("/api/auth/get-session")).json(),
    ).toBeNull();
    const protectedPage = await context.request.get("/projects", {
      maxRedirects: 0,
    });
    expect(protectedPage.status()).toBe(307);
    if (path === "/sign-up") {
      // Native POST must not silently create a usable account either.
      const signin = await authPost(
        context.request,
        baseURL!,
        "sign-in/email",
        { email: account.email, password: account.password },
      );
      expect(signin.status()).toBe(401);
    }
  });
}
