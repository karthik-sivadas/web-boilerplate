import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { artifactRuntime } from "./artifact-runtime";
import {
  sessionSchema,
  workspaceSchema,
} from "../packages/contracts/src/v1/index";
const runtime = await artifactRuntime();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${runtime.origin}/sign-up`);
  await page.getByLabel("Name", { exact: true }).fill("Artifact User");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-artifact-password-123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "A clearer way to move work forward" })
    .waitFor();
  const session = sessionSchema.parse(
    await (await page.request.get(`${runtime.origin}/api/v1/session`)).json(),
  );
  const response = await page.request.post(
    `${runtime.origin}/api/v1/projects`,
    {
      headers: {
        Origin: runtime.origin,
        "X-Expected-Session-Id": session.sessionId,
        "x-user-id": "spoof",
      },
      data: { name: "Artifact retained", description: "", expectedRevision: 0 },
    },
  );
  assert.equal(response.status(), 200);
  assert.equal(workspaceSchema.parse(await response.json()).revision, 1);
  await page.goto(`${runtime.origin}/projects`);
  await page.getByRole("heading", { name: "Artifact retained" }).waitFor();
  const currentCookie = (await page.context().cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const headers = {
    cookie: currentCookie,
    Origin: runtime.origin,
    "X-Expected-Session-Id": session.sessionId,
    "Content-Type": "application/json",
  };
  const oversized = await new Promise<number | undefined>(
    (resolveStatus, reject) => {
      const upload = httpRequest(
        `${runtime.origin}/api/v1/projects`,
        { method: "POST", headers },
        (response) => {
          response.resume();
          response.once("end", () => resolveStatus(response.statusCode));
        },
      );
      upload.once("error", reject);
      upload.write("x".repeat(1024 * 1024));
      upload.end("x".repeat(1024 * 1024 + 1));
    },
  );
  assert.equal(oversized, 413);
  await new Promise<void>((resolveClose) => {
    const partial = httpRequest(`${runtime.origin}/api/v1/projects`, {
      method: "POST",
      headers,
    });
    partial.on("error", () => {});
    partial.once("close", resolveClose);
    partial.write('{"expectedRevision":', () => partial.destroy());
  });
  assert.equal(
    workspaceSchema.parse(
      await (
        await page.request.get(`${runtime.origin}/api/v1/workspace`, {
          headers: { "X-Expected-Session-Id": session.sessionId },
        })
      ).json(),
    ).revision,
    1,
  );
  await runtime.stopApi();
  assert.equal((await fetch(`${runtime.origin}/health/live`)).status, 200);
  assert.equal((await fetch(`${runtime.origin}/health/ready`)).status, 503);
  const outage = await page.reload();
  assert.equal(outage?.status(), 503);
  assert.equal(outage?.headers()["cache-control"], "private, no-store");
  assert.ok(!(await page.textContent("body"))?.includes("Artifact retained"));
  runtime.startApi();
  await runtime.ready();
  await page.goto(`${runtime.origin}/projects`);
  await page.getByRole("heading", { name: "Artifact retained" }).waitFor();
  const oldCookie = (await page.context().cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(/sign-in$/);
  assert.equal(
    (
      await fetch(`${runtime.origin}/api/v1/session`, {
        headers: { cookie: oldCookie },
      })
    ).status,
    401,
  );
  assert.ok(!(await readdir(runtime.directory)).includes("node_modules"));
  assert.ok(!(await readdir(runtime.directory)).includes(".data"));
  // Artifact leakage check complements (does not substitute for) enforced import boundaries.
  for (const directory of [
    resolve("apps/web/.output/public/assets"),
    resolve("apps/web/.output/server"),
  ])
    for (const file of await readdir(directory, { recursive: true }))
      if (/\.(?:m?js)$/.test(file)) {
        const code = await readFile(join(directory, file), "utf8");
        for (const forbidden of [
          "node:sqlite",
          "AUTH_DATABASE_PATH",
          "better-auth-secret",
          "getMigrations",
          "PostgresDialect",
          "DATABASE_URL",
        ])
          assert.ok(
            !code.includes(forbidden),
            `Web artifact includes forbidden server dependency: ${forbidden}`,
          );
      }
  console.log(
    "Source-free web/API/PG artifact checks passed: browser CRUD, chunked body bound/client disconnect, independent web liveness, readiness/outage, API restart persistence, logout and runtime isolation.",
  );
} finally {
  await browser.close();
  await runtime.close();
}
