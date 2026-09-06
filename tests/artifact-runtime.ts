import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createPool } from "../apps/api/src/infrastructure/postgres";
export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 16000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}
export async function artifactRuntime(webPort?: number) {
  const adminUrl = process.env.PG_TEST_ADMIN_URL;
  if (!process.env.TEST_DATABASE_URL || !adminUrl)
    throw new Error(
      "Explicit TEST_DATABASE_URL and PG_TEST_ADMIN_URL are required.",
    );
  const target = new URL(adminUrl);
  if (!/test_admin$/.test(target.pathname) || /dev|prod/.test(target.pathname))
    throw new Error("Refusing non-test administrator target.");
  const admin = createPool(adminUrl, { max: 1 });
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "workspace-full-artifact-"));
  let owned = false;
  let api: ChildProcess | undefined, web: ChildProcess | undefined;
  const port = webPort ?? (await freePort()),
    apiPort = await freePort();
  const origin = `http://127.0.0.1:${port}`,
    apiOrigin = `http://127.0.0.1:${apiPort}`;
  const base = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    NODE_PATH: "",
  };
  const shutdown = async () => {
    await stop(web);
    await stop(api);
    try {
      if (owned) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    owned = true;
    target.pathname = `/${name}`;
    await Promise.all([
      cp(resolve("apps/api/dist"), join(directory, "api"), { recursive: true }),
      cp(resolve("apps/web/.output"), join(directory, "web"), {
        recursive: true,
      }),
    ]);
    const apiEnv = {
      ...base,
      DATABASE_URL: target.href,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      BETTER_AUTH_URL: origin,
      API_PORT: String(apiPort),
      API_HOST: "127.0.0.1",
    };
    const migrate = spawn(
      process.execPath,
      [join(directory, "api/migrate.mjs")],
      { cwd: directory, env: apiEnv, stdio: "ignore" },
    );
    const code = await new Promise<number | null>((resolveCode) =>
      migrate.once("exit", resolveCode),
    );
    if (code !== 0) throw new Error("Owned artifact migration failed.");
    const startApi = () => {
      api = spawn(process.execPath, [join(directory, "api/main.mjs")], {
        cwd: directory,
        env: apiEnv,
        stdio: "ignore",
      });
    };
    startApi();
    // Web receives no DATABASE_URL, auth secret, PostgreSQL variables or workspace source.
    web = spawn(process.execPath, [join(directory, "web/server/index.mjs")], {
      cwd: directory,
      env: {
        ...base,
        API_INTERNAL_URL: apiOrigin,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "ignore",
    });
    const ready = async () => {
      for (let n = 0; n < 100; n++) {
        try {
          if (
            (
              await fetch(`${origin}/health/ready`, {
                signal: AbortSignal.timeout(1000),
              })
            ).status === 200
          )
            return;
        } catch {
          /* startup */
        }
        await delay(100);
      }
      throw new Error("Owned artifacts did not become ready.");
    };
    await ready();
    return {
      directory,
      origin,
      apiOrigin,
      ready,
      close: shutdown,
      stopApi: async () => stop(api),
      startApi,
    };
  } catch (error) {
    await shutdown();
    throw error;
  }
}
