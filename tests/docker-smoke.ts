import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { developmentConfiguration } from "../scripts/development-config";
import { freePort } from "./artifact-runtime";
import { sessionSchema } from "../packages/contracts/src/v1/index";
import { waitForAuthInteractive } from "./auth-readiness";
import { dockerDiagnostics } from "./docker-diagnostics";
import { submitDockerSignup } from "./docker-signup";
const diagnostics = dockerDiagnostics();
const directory = await mkdtemp(join(tmpdir(), "workspace-docker-owned-"));
const project = `workspace-smoke-${randomUUID().replaceAll("-", "")}`;
const file = join(directory, "config.env");
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
let browser: Browser | undefined;
try {
  const config = await developmentConfiguration(file, {
    POSTGRES_PORT: String(await freePort()),
    POSTGRES_DB: "workspace_smoke",
    BETTER_AUTH_URL: origin,
  });
  const run = async (...args: string[]) => {
    // Only fixed operation/service labels, never command arguments or config.
    const operation = args[0];
    const service = args.find((arg) =>
      ["postgres", "api", "web", "migrate"].includes(arg),
    );
    diagnostics.record({ kind: "compose-start", operation, service });
    const child = spawn(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--file",
        resolve("compose.yaml"),
        "--env-file",
        file,
        ...args,
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_HOST: process.env.DOCKER_HOST,
          DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
          ...config,
          WEB_PORT: String(port),
        },
        stdio: "ignore",
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 600000);
    try {
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once("error", reject);
        child.once("exit", resolveCode);
      });
      diagnostics.record({ kind: "compose-exit", operation, service, code });
      if (code !== 0)
        throw new Error(
          "Owned Docker step failed (diagnostics intentionally do not print configuration).",
        );
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await run("up", "-d", "--wait", "postgres");
    console.log("Owned Docker PostgreSQL ready.");
    await run("run", "--rm", "--build", "migrate");
    await run("up", "-d", "--build", "web");
    const ready = async () => {
      for (let n = 0; n < 90; n++) {
        try {
          if (
            (
              await fetch(`${origin}/health/ready`, {
                signal: AbortSignal.timeout(4000),
              })
            ).ok
          )
            return;
        } catch {
          /* restarting */
        }
        await delay(500);
      }
      throw new Error("Owned Docker stack unavailable.");
    };
    await ready();
    browser = await chromium.launch();
    const page = await browser.newPage();
    diagnostics.attach(page);
    await page.goto(`${origin}/sign-up`);
    await waitForAuthInteractive(page);
    await page.getByLabel("Name", { exact: true }).fill("Docker fixture");
    await page
      .getByLabel("Email", { exact: true })
      .fill(`${randomUUID()}@example.test`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-container-password-123!");
    const signupResponse = await submitDockerSignup(page);
    assert.equal(signupResponse.status(), 200);
    await page
      .getByRole("heading", { name: "A clearer way to move work forward" })
      .waitFor();
    const session = sessionSchema.parse(
      await (await page.request.get(`${origin}/api/v1/session`)).json(),
    );
    assert.equal(
      (
        await page.request.post(`${origin}/api/v1/projects`, {
          headers: {
            Origin: origin,
            "X-Expected-Session-Id": session.sessionId,
          },
          data: {
            expectedRevision: 0,
            name: "Docker persistence",
            description: "",
          },
        })
      ).status(),
      200,
    );
    await page.goto(`${origin}/projects`);
    await page.getByRole("heading", { name: "Docker persistence" }).waitFor();
    await run("restart", "postgres");
    await ready();
    await page.reload();
    await page.getByRole("heading", { name: "Docker persistence" }).waitFor();
    for (const service of ["postgres", "api"]) {
      await run("stop", service);
      assert.equal((await fetch(`${origin}/health/live`)).status, 200);
      assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
      assert.equal((await page.reload())?.status(), 503);
      assert.ok(
        !(await page.textContent("body"))?.includes("Docker persistence"),
      );
      await run("start", service);
      await ready();
      await page.goto(`${origin}/projects`);
      await page.getByRole("heading", { name: "Docker persistence" }).waitFor();
    }
    await run(
      "exec",
      "-T",
      "web",
      "node",
      "-e",
      "if(process.env.DATABASE_URL||process.env.BETTER_AUTH_SECRET||require('node:fs').existsSync('/app/apps')||require('node:fs').existsSync('/app/node_modules'))process.exit(1)",
    );
    await run(
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "const fs=require('node:fs');if(JSON.stringify(fs.readdirSync('/app/dist').sort())!==JSON.stringify(['main.mjs','migrate.mjs','migrations','package.json']))process.exit(1);for(const entry of ['main.mjs','migrate.mjs'])if(/importLegacyAuth|confirm-offline|source-copy/.test(fs.readFileSync('/app/dist/'+entry,'utf8')))process.exit(1)",
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/sign-in$/);
    console.log(
      "Owned Docker smoke passed: real browser/proxy CRUD, PostgreSQL restart persistence, PostgreSQL/API outages, recovery, secret/source isolation and logout.",
    );
  } catch (error) {
    for (const path of ["/health/live", "/health/ready", "/api/v1/session"]) {
      try {
        const response = await fetch(`${origin}${path}`, {
          signal: AbortSignal.timeout(2000),
        });
        diagnostics.record({
          kind: "failure-probe",
          path,
          status: response.status,
        });
        await response.body?.cancel();
      } catch {
        diagnostics.record({
          kind: "failure-probe",
          path,
          error: "unavailable",
        });
      }
    }
    await diagnostics.save();
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await run("down", "--volumes", "--remove-orphans");
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
