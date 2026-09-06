import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
export const credentials = () => ({
  name: "Browser User",
  email: `${randomUUID()}@example.test`,
  password: randomBytes(24).toString("base64url"),
});
export async function paceRateWindow(headers: Record<string, string>) {
  const seconds = Number(headers["retry-after"] ?? headers["x-retry-after"]);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(60);
  // Only real server-reported fixture rate windows are paced, never UI settling.
  await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
}
export async function signUpUI(page: Page) {
  const account = credentials();
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/sign-up/email"),
    );
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    const response = await pending;
    if (response.status() !== 429) {
      expect(response.status()).toBe(200);
      return account;
    }
    await paceRateWindow(response.headers());
  }
  throw new Error("Signup fixture exceeded bounded rate-window retries");
}
export async function authPost(
  request: APIRequestContext,
  origin: string,
  endpoint: string,
  body: object,
): Promise<APIResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request.post(`${origin}/api/auth/${endpoint}`, {
      data: body,
      headers: { Origin: origin },
    });
    if (response.status() !== 429) return response;
    await paceRateWindow(response.headers());
  }
  throw new Error("Auth fixture exceeded bounded rate-window retries");
}
