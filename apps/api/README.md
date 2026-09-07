# Workspace API

Current operations: [PostgreSQL runbook](../../docs/postgres-operations.md). Verification mapping: [PostgreSQL verification](../../docs/postgres-verification.md).

Node **24.13.1**, pnpm **11.7.0**, PostgreSQL **16.15**. See [ADR 004](../../docs/adr-004-layered-postgres.md) for routes, limits, boundaries and transaction/security policy.

## Commands

From repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter api build        # no database or auth secret required
pnpm --filter api typecheck
pnpm test:api                  # builds, then uses explicit isolated test targets
```

Tests require `TEST_DATABASE_URL` whose database name contains `test` (not `dev` or `prod`), different from the development target. They create random `test_<uuid>` schemas and use that search_path on every normal/read-only/planner pool. Artifact tests additionally require `PG_TEST_ADMIN_URL` targeting a database whose name ends in `test_admin`, with create-database privilege; they create and drop only a random owned test database. Never point these at a real user database. No test silently skips or falls back when configuration is missing. Do not print URLs or store credentials in tracked files.

## Explicit runtime deployment

Supply server-only `DATABASE_URL`, `BETTER_AUTH_SECRET` (non-placeholder, at least 32 characters), and `BETTER_AUTH_URL` (public HTTPS origin; literal loopback HTTP allowed). Optional `API_HOST` defaults to `127.0.0.1`; `API_PORT` defaults to `4000`. The API Docker target binds its private listener explicitly; Compose connects it to the fixed web proxy and PostgreSQL. No variable is `VITE_*`.

Copy **only** `apps/api/dist/` to the deployment directory. Production dependencies are bundled, with no source-loader or node_modules/workspace link dependency:

```sh
node migrate.mjs              # explicit operator action against selected database
node main.mjs
```

Do not run migrations on a user/development target during implementation. Runtime never migrates automatically: pending, drifted or unavailable schema gives sanitized 503 on dependency-bearing routes. `/health/live` is deliberately independent process liveness; `/health/ready` is schema/dependency-gated. Building does not require or inspect database credentials. Stop with SIGTERM; requests drain before bounded pool cleanup.

`pnpm --filter api migrate` runs the equivalent source command for an operator. Review and back up before production migration. There is no destructive down command; use reviewed forward repair or a verified backup restore. Never repurpose the test helper as a reset command.

## Required workspace session precondition

Discover identity using `GET /api/v1/session`. Capture its session ID in the calling action/query lease, and send `X-Expected-Session-Id` on **every** workspace request (including reads and imports/exports/rollback), independently of `expectedRevision`/`If-Match`. Contracts export the header name, bounded schema and `WorkspaceSessionHeaders` type. A missing/invalid binding is `400 SESSION_BINDING_REQUIRED`; a verified-cookie session different from the captured ID is `409 SESSION_CHANGED`, including same-user session replacement. No identity is taken from the header. Clients must hide/invalidate/reconcile on mismatch without silently replaying a draft. The web forwards the captured header through its fixed proxy and keeps both pre/post lease checks; fetching a fresh ID immediately before every call would hide the very intent mismatch this prevents.

Sign-out success is confirmed using the original request cookie and the read-only Better Auth guard. If PostgreSQL deletion failed or revocation cannot be verified, the API returns 503 without forwarding misleading expiration cookies. Keep the original cookie and retry after recovery; do not report successful logout on this error.

Builds use fresh script-owned staging and replace only `dist`, preventing removed migration SQL from surviving a rebuild. The 12s HTTP deadline includes readiness; already-dispatched database work still has its own bounds and uncertain writes require reconciliation.

## Current scope

Web now uses the remote API exclusively. Implemented preservation routes are GET `/api/v1/workspace/export`, POST `/api/v1/workspace/import`, GET `/api/v1/workspace/import-receipt`, and POST `/api/v1/workspace/rollback`. All require the captured session header; writes also require revision/Origin. Receipts are durable and owner-scoped, duplicate fingerprints are rejected, IDs are remapped, and rollback is allowed only at the unchanged imported revision. The API is PostgreSQL-only; the offline SQLite auth importer has been retired. Workspace JSON preservation is unchanged. See the runbook for the required forward migration and preservation limitations. Independent release review remains required.
