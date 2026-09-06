import { configuration } from "./infrastructure/config";
import { createPool } from "./infrastructure/postgres";
import { migrate, migrations } from "./infrastructure/migrations";

try {
  const config = configuration();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const directory = new URL(
      import.meta.url.endsWith(".ts") ? "../migrations/" : "./migrations/",
      import.meta.url,
    );
    await migrate(pool, await migrations(directory));
    console.log(JSON.stringify({ event: "migrations_complete" }));
  } finally {
    await pool.end();
  }
} catch {
  console.error(JSON.stringify({ event: "migration_failed" }));
  process.exitCode = 1;
}
