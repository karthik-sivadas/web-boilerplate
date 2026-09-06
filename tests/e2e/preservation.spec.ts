import { readFile } from "node:fs/promises";
import { expect, test, request as isolatedRequest } from "@playwright/test";
import { signUpUI, authPost, credentials } from "./auth-fixtures";
import {
  sessionSchema,
  workspaceSchema,
  exportSchema,
} from "../../packages/contracts/src/v1/index";
test.beforeEach(() => test.setTimeout(240000));
async function prepareAccount(origin: string, privateProject = false) {
  const request = await isolatedRequest.newContext({ baseURL: origin });
  try {
    const account = credentials();
    expect(
      (await authPost(request, origin, "sign-up/email", account)).status(),
    ).toBe(200);
    const session = sessionSchema.parse(
      await (await request.get("/api/v1/session")).json(),
    );
    if (privateProject)
      expect(
        (
          await request.post("/api/v1/projects", {
            headers: {
              Origin: origin,
              "X-Expected-Session-Id": session.sessionId,
            },
            data: {
              expectedRevision: 0,
              name: "C private project",
              description: "",
            },
          })
        ).status(),
      ).toBe(200);
    return {
      account,
      session,
      cookies: (await request.storageState()).cookies,
    };
  } finally {
    await request.dispose();
  }
}
test("empty accounts explicitly preview, export, import and roll back without altering legacy keys", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/sign-up");
  await signUpUI(page);
  await expect(
    page.getByRole("heading", { name: "Welcome to your empty workspace" }),
  ).toBeVisible();
  const session = sessionSchema.parse(
    await (await context.request.get("/api/v1/session")).json(),
  );
  const source = {
    version: 1,
    workspace: {
      projects: [
        {
          id: "legacy-project",
          name: "Preserved browser project",
          description: "Synthetic fixture",
          archived: false,
        },
      ],
      tasks: [],
    },
  };
  const key = `web-boilerplate.workspace:${session.user.id}`;
  const raw = JSON.stringify(source);
  await page.evaluate(
    ({ key, raw }) => {
      localStorage.setItem(key, raw);
      localStorage.setItem("web-boilerplate.workspace", "anonymous untouched");
    },
    { key, raw },
  );
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Preview this account's legacy data" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import preview" }),
  ).toBeVisible();
  const previewDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download preview" }).click();
  expect(
    JSON.parse(await readFile(await (await previewDownload).path(), "utf8")),
  ).toEqual(source);
  await page.getByRole("button", { name: "Review import" }).click();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import receipt" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Import receipt" }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const data = exportSchema.parse(
    JSON.parse(await readFile(await (await exported).path(), "utf8")),
  );
  expect(data.workspace.projects[0]?.id).not.toBe("legacy-project");
  await page.getByRole("button", { name: "Roll back this import" }).click();
  await expect(
    page.getByRole("heading", { name: "Import receipt" }),
  ).not.toBeVisible();
  expect(
    await page.evaluate(
      (key) => [
        localStorage.getItem(key),
        localStorage.getItem("web-boilerplate.workspace"),
      ],
      key,
    ),
  ).toEqual([raw, "anonymous untouched"]);
  const remote = await context.request.get(`${baseURL}/api/v1/workspace`, {
    headers: { "X-Expected-Session-Id": session.sessionId },
  });
  expect(workspaceSchema.parse(await remote.json())).toEqual({
    revision: 2,
    projects: [],
    tasks: [],
  });
});
test("a shared-cookie switch before reconciliation cannot bind old-tab drafts or reads to the new account", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/sign-up");
  const a = await signUpUI(page);
  const sessionA = sessionSchema.parse(
    await (await context.request.get("/api/v1/session")).json(),
  );
  // Finish real signup rate windows before opening a draft/resetting the tab's poll timer.
  const preparedB = await prepareAccount(baseURL!);
  const b = preparedB.account,
    sessionB = preparedB.session;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("A draft must not reach B");
  await context.addCookies(preparedB.cookies);
  // Switch genuine server-issued cookies without broadcasting/focusing/reloading the tab.
  await expect(page.getByText(a.email, { exact: true })).toBeAttached();
  await expect(page.getByLabel("Project name")).toHaveValue(
    "A draft must not reach B",
  );
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save project" }).click();
  const result = await rejected;
  expect(result.request().headers()["x-expected-session-id"]).toBe(
    sessionA.sessionId,
  );
  expect(result.status()).toBe(409);
  expect(await result.json()).toMatchObject({
    error: { code: "SESSION_CHANGED" },
  });
  await expect(page.getByText(b.email, { exact: true })).toBeAttached();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    workspaceSchema.parse(
      await (
        await context.request.get("/api/v1/workspace", {
          headers: { "X-Expected-Session-Id": sessionB.sessionId },
        })
      ).json(),
    ).projects,
  ).toEqual([]);
  const preparedC = await prepareAccount(baseURL!, true);
  const c = preparedC.account;
  const receiptReady = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/workspace/import-receipt"),
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await receiptReady;
  await context.addCookies(preparedC.cookies);
  await expect(page.getByText(b.email, { exact: true })).toBeAttached();
  const read = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/workspace") &&
      response.request().headers()["x-expected-session-id"] ===
        sessionB.sessionId,
  );
  await page
    .getByRole("button", { name: "Reload workspace", exact: true })
    .click();
  const staleRead = await read;
  expect(staleRead.status()).toBe(409);
  expect(await staleRead.text()).not.toContain("C private project");
  await expect(page.getByText(c.email, { exact: true })).toBeAttached();
});
