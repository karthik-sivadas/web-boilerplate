import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { developmentConfiguration } from "./development-config";
const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] ?? "setup";
const configArgument = process.argv
  .find((value) => value.startsWith("--config="))
  ?.slice(9);
try {
  const config = await developmentConfiguration(
    configArgument
      ? resolve(configArgument)
      : resolve(root, ".data/development.env"),
    process.env,
  );
  if (mode === "setup")
    console.log(
      "Local configuration ready. No database was migrated or reset.",
    );
  else {
    const base = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
    };
    const apiEnv = {
      ...base,
      DATABASE_URL: config.DATABASE_URL,
      BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: config.BETTER_AUTH_URL,
      API_PORT: config.API_PORT ?? "4000",
      API_HOST: "127.0.0.1",
    };
    const children: ChildProcess[] = [];
    const launch = (
      args: string[],
      env: NodeJS.ProcessEnv,
      command = "pnpm",
    ) => {
      const child = spawn(command, args, {
        cwd: root,
        env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      });
      children.push(child);
      return child;
    };
    let closing = false;
    let shutdown: Promise<void> | undefined;
    const stop = () => {
      if (closing) return;
      closing = true;
      for (const child of children)
        if (child.pid) {
          try {
            if (process.platform === "win32") child.kill("SIGTERM");
            else process.kill(-child.pid, "SIGTERM");
          } catch {
            /* already exited */
          }
        }
      shutdown = (async () => {
        const deadline = Date.now() + 16000;
        while (Date.now() < deadline) {
          const alive = children.some((child) => {
            if (!child.pid) return false;
            try {
              process.kill(
                process.platform === "win32" ? child.pid : -child.pid,
                0,
              );
              return true;
            } catch {
              return false;
            }
          });
          if (!alive) return;
          await delay(50);
        }
        for (const child of children)
          if (child.pid) {
            try {
              if (process.platform === "win32") child.kill("SIGKILL");
              else process.kill(-child.pid, "SIGKILL");
            } catch {
              /* exited */
            }
          }
      })();
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    if (mode === "migrate") launch(["--filter", "api", "migrate"], apiEnv);
    else if (mode === "database")
      launch(
        [
          "compose",
          "--env-file",
          configArgument
            ? resolve(configArgument)
            : resolve(root, ".data/development.env"),
          "up",
          "-d",
          "--wait",
          "postgres",
        ],
        { ...base, ...config },
        "docker",
      );
    else if (mode === "dev") {
      launch(["--filter", "api", "exec", "tsx", "src/main.ts"], apiEnv);
      launch(["--filter", "web", "dev"], {
        ...base,
        API_INTERNAL_URL: config.API_INTERNAL_URL,
      });
    } else throw new Error("Unknown local command.");
    for (const child of children)
      child.on("exit", () => {
        if (mode === "dev") stop();
      });
    const codes = await Promise.all(
      children.map(
        (child) =>
          new Promise<number>((resolveCode) => {
            child.once("error", () => {
              stop();
              resolveCode(1);
            });
            child.once("exit", (code) => resolveCode(code ?? 0));
          }),
      ),
    );
    await shutdown;
    process.exitCode = codes.some((code) => code !== 0) ? 1 : 0;
  }
} catch {
  console.error(
    "Local command failed. Check explicit configuration; no credentials were printed.",
  );
  process.exitCode = 1;
}
