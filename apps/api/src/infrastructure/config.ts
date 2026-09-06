export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET;
  if (
    !databaseUrl ||
    !secret ||
    secret.length < 32 ||
    /^(change|replace|example|your[-_ ]|secret)/i.test(secret)
  )
    throw new Error(
      "Explicit database configuration and non-placeholder auth secret required.",
    );
  let origin: URL;
  try {
    origin = new URL(env.BETTER_AUTH_URL ?? "");
    const database = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw new Error();
  } catch {
    throw new Error("Invalid runtime configuration.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !["http:", "https:"].includes(origin.protocol) ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  )
    throw new Error(
      "Public URL must be an HTTPS origin (loopback HTTP allowed).",
    );
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid API_PORT.");
  return {
    databaseUrl,
    secret,
    origin: origin.origin,
    port,
    hostname: env.API_HOST ?? "127.0.0.1",
  };
}
