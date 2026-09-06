import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the same source-free output copied by Docker, not repository module resolution.
const directory = await mkdtemp(join(tmpdir(), "workbench-e2e-artifact-"));
try {
  await cp(
    resolve(import.meta.dirname, "../apps/web/.output"),
    join(directory, ".output"),
    { recursive: true },
  );
  const child = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: directory,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_PATH: "",
      PORT: "4173",
      HOST: "127.0.0.1",
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      BETTER_AUTH_URL: "http://127.0.0.1:4173",
      AUTH_DATABASE_PATH: join(directory, "auth.sqlite"),
    },
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve(code ?? (signal === "SIGTERM" ? 0 : 1)),
    );
  });
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  process.exitCode = exitCode;
} finally {
  await rm(directory, { recursive: true, force: true });
}
