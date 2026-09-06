import { createApp } from "./app";
import { configuration } from "./infrastructure/config";
import { createPool } from "./infrastructure/postgres";
import { migrations } from "./infrastructure/migrations";
import { listen } from "./server";

try {
  const config = configuration();
  const pool = createPool(config.databaseUrl);
  const readOnly = createPool(config.databaseUrl, { readOnly: true });
  const plan = await migrations(
    new URL(
      import.meta.url.endsWith(".ts") ? "../migrations/" : "./migrations/",
      import.meta.url,
    ),
  );
  const { app } = createApp(pool, readOnly, config, plan);
  const server = listen(app, config.port, config.hostname);
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.setTimeout(15000);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 15000);
    deadline.unref();
    server.close(() => {
      void Promise.all([pool.end(), readOnly.end()]).then(
        () => {
          clearTimeout(deadline);
          process.exit(0);
        },
        () => {
          clearTimeout(deadline);
          console.error(JSON.stringify({ event: "shutdown_failed" }));
          process.exit(1);
        },
      );
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
} catch {
  console.error(JSON.stringify({ event: "startup_failed" }));
  process.exitCode = 1;
}
