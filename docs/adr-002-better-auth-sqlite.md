# ADR 002: Better Auth with controlled local SQLite startup

**Superseded historical record — not setup instructions.** [ADR 004](adr-004-layered-postgres.md) replaced this runtime with PostgreSQL. SQLite support and the later offline auth importer are now removed. Use [current operations](postgres-operations.md); the paths, commands and requirements below describe only the former implementation.

Workbench uses `better-auth@1.7.3` with its built-in Kysely adapter and Node 24.13.1's experimental `node:sqlite` `DatabaseSync`. This avoids an ORM, native addon, and external service. The Node pin and artifact/Docker checks are mandatory because `node:sqlite` remains experimental on this pinned release.

A single-flight runtime initializer validates configuration, opens SQLite with foreign keys and a bounded busy timeout, builds Better Auth, and runs `getMigrations(auth.options).runMigrations()`. It is shared by `pnpm auth:setup` and runtime startup; migrations never run during the build.

Nitro 3 invokes runtime plugins synchronously without awaiting returned promises. The plugin therefore synchronously wraps public `nitroApp.fetch`, returning `503` with `Cache-Control: no-store` for **every** request until initialization succeeds. It exits nonzero on failure or after 60 seconds. Listener binding during this gate is accepted because no health, static, SSR, or auth request can become healthy.

The implementation lives in `apps/web/src/lib/auth/server.ts` and `apps/web/src/server/plugins/auth.ts`; `apps/web/scripts/auth-setup.ts` is delegated by root `pnpm auth:setup`. Development discovers the nearest workspace marker and reuses repository-root `.data`; production branches first, validates explicit absolute DB path and needs no workspace sources. Phase-2 local session/backend/startup/artifact browser regressions now pass; independent security review and hosted deployment acceptance remain pending. See [test mapping and limits](auth-verification.md).

Phase-1 investigation identified Better Auth's IP helpers calling `z.validate`, absent from bundled Zod 4.3.6. The approved root/app Zod-only upgrade to 4.5.4 removes the missing-export warning. Empty ipAddressHeaders still deliberately distrust forwarding headers and retain conservative shared rate buckets, now tested with real 429 responses while rotating forged headers. Enabling trusted proxy/IP resolution still requires deployment review; no warning was suppressed.

SQLite is for one application instance with a local persistent volume. Do not use shared/network filesystem SQLite or multi-replica deployment. Back up the database before upgrades and test restore procedures.
