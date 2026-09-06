import "@tanstack/react-start/server-only";

import { mkdir, open, chmod } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { developmentDataDirectory } from "./development-path";
import type { SessionIdentity } from "@/features/auth/identity";

type AuthRuntime = {
  auth: ReturnType<typeof betterAuth>;
  database: DatabaseSync;
  origin: string;
};

let runtime: AuthRuntime | undefined;
let initialization: Promise<AuthRuntime> | undefined;

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function validOrigin(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute origin.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (production && url.protocol !== "https:" && !isLoopback(url.hostname))
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an HTTPS origin (except literal loopback HTTP) without a path, query, fragment, or credentials.",
    );
  }
  return url.origin;
}

function validProductionSecret(value: string | undefined): string {
  const secret = value?.trim();
  const placeholder =
    /^(?:change[-_ ]?me.*|replace.*|example.*|your[-_ ]?(?:better[-_ ]?auth[-_ ]?)?secret.*|secret[-_ ]?(?:key|value).*)$/i;
  if (!secret || secret.length < 32 || placeholder.test(secret)) {
    throw new Error(
      "BETTER_AUTH_SECRET must be a non-placeholder value of at least 32 characters.",
    );
  }
  return secret;
}

async function developmentSecret(dataDirectory: string): Promise<string> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700);
  const secretPath = join(dataDirectory, "better-auth-secret");
  try {
    const file = await open(secretPath, "wx", 0o600);
    try {
      const secret = randomBytes(32).toString("hex");
      await file.writeFile(`${secret}\n`, "utf8");
      return secret;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    const file = await open(secretPath, "r", 0o600);
    try {
      const secret = (await file.readFile("utf8")).trim();
      if (secret.length < 32)
        throw new Error("Development auth secret is invalid.");
      return secret;
    } finally {
      await file.close();
    }
  }
}

async function loadConfiguration() {
  const production = process.env.NODE_ENV === "production";
  if (production) {
    const path = process.env.AUTH_DATABASE_PATH;
    if (!path || !isAbsolute(path))
      throw new Error(
        "AUTH_DATABASE_PATH must be an absolute persistent path in production.",
      );
    return {
      secret: validProductionSecret(process.env.BETTER_AUTH_SECRET),
      origin: validOrigin(process.env.BETTER_AUTH_URL ?? "", true),
      databasePath: path,
    };
  }
  if (process.env.PORT && process.env.PORT !== "3000") {
    throw new Error(
      "Development authentication requires PORT=3000 to match BETTER_AUTH_URL.",
    );
  }
  const dataDirectory = await developmentDataDirectory(process.cwd());
  return {
    secret: await developmentSecret(dataDirectory),
    origin: "http://localhost:3000",
    databasePath: join(dataDirectory, "auth.sqlite"),
  };
}

async function createRuntime(): Promise<AuthRuntime> {
  const config = await loadConfiguration();
  const database = new DatabaseSync(config.databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const options: BetterAuthOptions = {
    database,
    secret: config.secret,
    baseURL: config.origin,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    // An empty supported header list deliberately selects Better Auth's
    // conservative shared bucket. This starter has no verified proxy-to-peer
    // bridge, so it never accepts a browser-provided forwarding header.
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: [] },
    },
  };
  const auth = betterAuth(options);
  try {
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    return { auth, database, origin: config.origin };
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Single-flight runtime initialization. Never call this from build tooling. */
export async function initializeAuth(): Promise<AuthRuntime> {
  if (runtime) return runtime;
  initialization ??= createRuntime().then((created) => {
    runtime = created;
    return created;
  });
  return initialization;
}

export async function getAuth(): Promise<ReturnType<typeof betterAuth>> {
  return (await initializeAuth()).auth;
}

export function closeAuth(): Promise<void> {
  if (runtime) runtime.database.close();
  runtime = undefined;
  initialization = undefined;
  return Promise.resolve();
}

/** Database-authoritative guard: HTTP session endpoint alone owns rolling refresh. */
export async function readSessionIdentity(
  headers: Headers,
): Promise<SessionIdentity | null> {
  const session = await (
    await getAuth()
  ).api.getSession({ headers, query: { disableRefresh: true } });
  return session
    ? {
        sessionId: session.session.id,
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        },
      }
    : null;
}

export async function authHandler(request: Request): Promise<Response> {
  return (await getAuth()).handler(request);
}
