import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "auth-artifact-proof-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  NODE_PATH: "",
  HOST: "127.0.0.1",
  PORT: "4186",
};
delete env.BETTER_AUTH_SECRET;
delete env.BETTER_AUTH_URL;
delete env.AUTH_DATABASE_PATH;
async function run(variables: NodeJS.ProcessEnv, ready: boolean) {
  const child = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: directory,
    env: variables,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (data: Buffer) => {
    log += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    log += data.toString();
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    if (!ready) {
      assert.equal(await exit, 1);
      assert.match(log, /Initialization failed/);
      return;
    }
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch("http://127.0.0.1:4186/api/health", {
          signal: AbortSignal.timeout(1000),
        });
        if (r.ok) {
          assert.equal(r.headers.get("cache-control"), "no-store");
          healthy = true;
          break;
        }
      } catch {
        /* bounded boot polling */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(healthy, "source-free artifact must become ready");
    const response = await fetch("http://127.0.0.1:4186/sign-in", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<html lang="en" dir="ltr"/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    child.kill("SIGTERM");
    await exit;
    clearTimeout(timeout);
  }
}
try {
  await cp(resolve("apps/web/.output"), join(directory, ".output"), {
    recursive: true,
  });
  await run(env, false);
  await run(
    {
      ...env,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      BETTER_AUTH_URL: "http://127.0.0.1:4186",
      AUTH_DATABASE_PATH: join(directory, "auth.sqlite"),
    },
    true,
  );
  assert.equal((await readdir(directory)).includes(".data"), false);
  assert.equal(
    (await readdir(directory)).includes("pnpm-workspace.yaml"),
    false,
  );
  const assets = resolve("apps/web/.output/public/assets");
  for (const file of await readdir(assets))
    if (file.endsWith(".js")) {
      const source = await readFile(join(assets, file), "utf8");
      for (const forbidden of [
        "node:sqlite",
        "AUTH_DATABASE_PATH",
        "better-auth-secret",
        "getMigrations",
        "PRAGMA foreign_keys",
        "rtl-fixture",
      ])
        assert.ok(
          !source.includes(forbidden),
          `client leaked server code: ${file} ${forbidden}`,
        );
    }
  console.log(
    "Artifact checks passed: missing config exits 1; source-free ready/SSR; no dev store; no client auth-runtime leakage.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
