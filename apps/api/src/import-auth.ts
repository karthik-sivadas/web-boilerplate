import { configuration } from "./infrastructure/config";
import { createPool } from "./infrastructure/postgres";
import { importLegacyAuth } from "./legacy-auth/import";
try {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) =>
        !["--confirm-offline", "--confirm-stable-secret"].includes(arg) &&
        !arg.startsWith("--source-copy=") &&
        !arg.startsWith("--timestamp-unit="),
    )
  )
    throw new Error("Unknown option.");
  const config = configuration();
  const pool = createPool(config.databaseUrl, { max: 1 });
  const unit = args
    .find((arg) => arg.startsWith("--timestamp-unit="))
    ?.split("=")[1];
  if (unit && unit !== "seconds" && unit !== "milliseconds")
    throw new Error("Invalid timestamp unit.");
  try {
    const result = await importLegacyAuth(pool, {
      sourceCopy:
        args
          .find((arg) => arg.startsWith("--source-copy="))
          ?.slice("--source-copy=".length) ?? "",
      confirmOffline: args.includes("--confirm-offline"),
      confirmStableSecret: args.includes("--confirm-stable-secret"),
      stableSecret: config.secret,
      ...(unit === "seconds" || unit === "milliseconds"
        ? { timestampUnit: unit }
        : {}),
    });
    console.log(
      JSON.stringify({ event: "legacy_auth_import_complete", ...result }),
    );
  } finally {
    await pool.end();
  }
} catch {
  console.error(JSON.stringify({ event: "legacy_auth_import_failed" }));
  process.exitCode = 1;
}
