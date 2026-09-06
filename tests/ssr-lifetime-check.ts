import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { freePort } from "./artifact-runtime";
const directory = await mkdtemp(join(tmpdir(), "ssr-lifetime-owned-"));
let child: ChildProcess | undefined;
let mode: "deadline" | "disconnect" = "deadline";
let identitySeen = () => {},
  identityClosed = () => {};
let readinessHits = 0,
  identityHits = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
const backend = createServer((request, response) => {
  const identity = request.url === "/api/v1/session";
  if (request.url === "/health/ready") readinessHits++;
  if (identity) {
    identityHits++;
    const onClose = identityClosed;
    identitySeen();
    response.once("close", () => {
      if (!response.writableEnded) onClose();
    });
  }
  const timer = setTimeout(
    () => {
      timers.delete(timer);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          identity
            ? {
                sessionId: "fixture-session",
                user: {
                  id: "fixture-user",
                  name: "Synthetic private identity",
                  email: "fixture@example.test",
                },
              }
            : { status: "ok" },
        ),
      );
    },
    mode === "deadline" || identity ? 8000 : 0,
  );
  timers.add(timer);
  response.once("close", () => {
    clearTimeout(timer);
    timers.delete(timer);
  });
});
let failures = 0;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("No owned port");
  await cp(resolve("apps/web/.output"), join(directory, "web"), {
    recursive: true,
  });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(directory, "web/server/index.mjs")], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NODE_PATH: "",
      HOST: "127.0.0.1",
      PORT: String(port),
      API_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`${origin}/health/live`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /*starting*/
    }
    await delay(100);
  }
  assert.ok(ready);
  try {
    const start = Date.now();
    const response = await fetch(`${origin}/projects`, {
      headers: { cookie: "synthetic-fixture" },
      signal: AbortSignal.timeout(20000),
    });
    const elapsed = Date.now() - start;
    assert.ok(readinessHits > 0 && identityHits > 0);
    assert.equal(response.status, 503);
    assert.ok(elapsed < 17000);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.text();
    assert.ok(!body.includes("Synthetic private identity"));
    assert.ok(body.includes("UNAVAILABLE"));
    console.log(`PASS shared SSR readiness+identity lifetime (${elapsed}ms)`);
  } catch (error) {
    failures++;
    console.error(
      "FAIL shared SSR readiness+identity lifetime/status/privacy",
      error,
    );
  }
  mode = "disconnect";
  try {
    const seen = new Promise<void>((done) => {
      identitySeen = done;
    });
    const closed = new Promise<boolean>((done) => {
      identityClosed = () => done(true);
    });
    const controller = new AbortController();
    const request = fetch(`${origin}/projects`, {
      headers: { cookie: "synthetic-fixture" },
      signal: controller.signal,
    }).catch(() => undefined);
    assert.ok(await Promise.race([seen.then(() => true), delay(5000, false)]));
    controller.abort();
    await request;
    assert.equal(await Promise.race([closed, delay(1500, false)]), true);
    console.log(
      "PASS post-readiness client disconnect cancels real SSR identity HTTP",
    );
  } catch (error) {
    failures++;
    console.error("FAIL post-readiness disconnect propagation", error);
  }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const hard = setTimeout(() => child?.kill("SIGKILL"), 16000);
    await exited;
    clearTimeout(hard);
  }
  for (const timer of timers) clearTimeout(timer);
  await new Promise<void>((done) => {
    backend.close(() => done());
    backend.closeAllConnections();
  });
  await rm(directory, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
