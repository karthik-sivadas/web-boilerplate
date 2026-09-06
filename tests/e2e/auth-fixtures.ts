import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import {
  sessionSchema,
  importResultSchema,
} from "../../packages/contracts/src/v1/index";
export async function seedWorkspace(
  request: APIRequestContext,
  origin: string,
) {
  const session = sessionSchema.parse(
    await (await request.get(`${origin}/api/v1/session`)).json(),
  );
  const stamp = "2026-01-15T09:00:00.000Z";
  const projects = [
    {
      id: "p-foundation",
      name: "Foundation refresh",
      description: "A dependable place to start.",
      archived: false,
    },
    {
      id: "p-research",
      name: "Customer research",
      description: "Discovery calls.",
      archived: false,
    },
    {
      id: "p-archive",
      name: "Completed experiments",
      description: "Earlier work.",
      archived: true,
    },
  ];
  const tasks = [
    {
      id: "t-brief",
      projectId: "p-foundation",
      title: "Review the implementation brief",
      description: "Align the scope.",
      status: "done",
    },
    {
      id: "t-shell",
      projectId: "p-foundation",
      title: "Shape the workspace shell",
      description: "Clear navigation.",
      status: "in_progress",
    },
    {
      id: "t-interviews",
      projectId: "p-research",
      title: "Synthesize five interview notes",
      description: "Capture themes.",
      status: "todo",
    },
  ].map((task) => ({ ...task, createdAt: stamp, updatedAt: stamp }));
  const response = await request.post(`${origin}/api/v1/workspace/import`, {
    headers: { Origin: origin, "X-Expected-Session-Id": session.sessionId },
    data: {
      expectedRevision: 0,
      data: { version: 1, workspace: { projects, tasks } },
    },
  });
  expect(response.status()).toBe(200);
  return importResultSchema.parse(await response.json()).workspace;
}
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
      // A response (or the destination URL) can precede Router navigation and
      // mounted session reconciliation. Do not let callers unload that work.
      await expect(
        page.getByRole("heading", {
          name: "A clearer way to move work forward",
        }),
      ).toBeVisible();
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
