import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";

export interface AuthConfig {
  origin: string;
  secret: string;
}
export function authOptions(
  database: Pool,
  config: AuthConfig,
  guard = false,
): BetterAuthOptions {
  return {
    database,
    secret: config.secret,
    baseURL: config.origin,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
      ...(guard ? { deferSessionRefresh: true } : {}),
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
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: [] },
    },
    logger: { disabled: true },
  };
}
export function createAuth(
  database: Pool,
  readOnlyDatabase: Pool,
  config: AuthConfig,
) {
  const auth = betterAuth(authOptions(database, config));
  const guard = betterAuth(authOptions(readOnlyDatabase, config, true));
  return {
    auth,
    guard,
    async identity(headers: Headers) {
      // GET + deferSessionRefresh prevents expired-session deletion; PG enforces it.
      const value = await guard.api.getSession({
        headers,
        query: { disableRefresh: true, disableCookieCache: true },
      });
      return value
        ? {
            sessionId: value.session.id,
            user: {
              id: value.user.id,
              name: value.user.name,
              email: value.user.email,
            },
          }
        : null;
    },
  };
}
