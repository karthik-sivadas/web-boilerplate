# PostgreSQL operations and preservation

This is the current runbook. Earlier SQLite deployment/auth documents describe historical milestones, not the current runtime. Publication remains supervisor-controlled.

## Local setup

Requires Node 24.13.1, pnpm 11.7.0, Docker Compose and PostgreSQL 16.15. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:migrate
pnpm dev
```

Setup exclusively creates `.data/development.env` with restrictive permissions, stable random auth secret/database password, host/container database URLs and test administrator URLs. It does not open old auth databases, migrate, reset, start services or overwrite existing files. Existing dotenv values load first; inherited environment takes precedence. Serialization uses a bounded literal-quoted format verified against both dotenv and Node's env-file parser, never JSON escaping. Backslashes, literal backslash-n, LF, hashes and spaces are preserved where representable. Values requiring unsupported quote/escape combinations, CR, NUL or invalid UTF-8 are rejected before new file creation. Selected files with different dotenv/Node interpretations are rejected unchanged; the tool never guesses their intended secret. An incomplete existing file fails rather than rotating a secret. `--config=/absolute/operator-selected.env` selects a different file for setup/dev/migrate/database commands. Do not run `db:up` over an existing service: configure the existing connection explicitly and skip service creation. Default PostgreSQL host port is 55432; choose `POSTGRES_PORT` before first setup if occupied. API defaults to 4000; web to 3000. Changing ports requires consistent public/internal URLs. This process supervisor targets POSIX systems; native Windows process-tree shutdown is not independently verified (use WSL).

Web receives only `API_INTERNAL_URL`; API receives `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `API_HOST`, and `API_PORT`. No server credential is `VITE_*`. Root dev starts both processes and bounds POSIX group shutdown, including descendants. Stopping the launcher never stops the PostgreSQL service or deletes volumes. `pnpm build` needs no database and does not migrate. `pnpm start` starts only the web artifact; run the API artifact separately with its own environment.

For local verification without shell-parsing dotenv:

```sh
pnpm exec playwright install --with-deps chromium
node --env-file=.data/development.env --run verify
pnpm test:docker
```

Alternatively supply inherited `TEST_DATABASE_URL` and `PG_TEST_ADMIN_URL` and run `pnpm verify`. They must select an explicit test administrator database; tests allocate only owned `test_<random>` schemas/databases. They never fall back to `DATABASE_URL`. Docker smoke generates a separate project, credentials, ports and volume, cleans only that project, and does not operate on an existing PostgreSQL service. The checked-in Compose init script creates the local test administrator database only during new-cluster initialization, not application tables.

## Separate deployment artifacts

`apps/web/.output` runs with `node server/index.mjs` from its artifact directory. `apps/api/dist` runs with `node main.mjs`; it includes bundled production dependencies, migration SQL and separate migration/auth-import entrypoints. Neither needs workspace source or source-linked node_modules. Docker targets `web` and `api` run as a non-root user. Web has no data volume or SQL/auth-runtime dependency. PostgreSQL owns durability.

For the generated local Compose configuration:

```sh
docker compose --env-file .data/development.env up -d --wait postgres
docker compose --env-file .data/development.env run --rm --build migrate
docker compose --env-file .data/development.env up -d --build web
```

These are operator actions, not automatic application startup migrations. Existing volumes are never reset by setup. Do not use `down --volumes` for a persistent deployment. The migration CLI checks reviewed SQL/checksums and uses a transaction/advisory lock; mismatched or missing migrations fail readiness. Follow release-specific backup/rehearsal before running migrations.

Production: put only web behind a fixed HTTPS reverse proxy, set API's public `BETTER_AUTH_URL` to that exact origin, and keep API/PostgreSQL on private networks. API's bind host must allow the private listener. Use stable managed secrets, TLS to remote PostgreSQL, least-privilege runtime roles, separate migration privileges, encrypted backups, monitoring and operator-owned retention. Compose's initial local database owner is deliberately suitable for test database creation, not a production least-privilege role recipe. Do not expose the local Compose database port publicly. HSTS belongs at the public HTTPS proxy.

The web proxy has one validated `API_INTERNAL_URL`, no client-selected host, manual redirects, bounded bodies/timeouts, hop-header/spoof stripping, distinct Set-Cookie propagation and private/no-store responses. `/health/live` reports process liveness independently of dependencies; `/health/ready` checks API/PostgreSQL/migration readiness. Readiness and subsequent SSR identity share a single 15-second dependency lifetime and the original client disconnect signal through Start's request context. Dependency outages/expiration produce sanitized private/no-store failures, never an anonymous/private-data fallback. Timeouts cannot prove rollback of already-dispatched SQL: reload canonical revision before further writes; never automatically replay a draft.

## Browser data and portable workspaces

New accounts are empty. Settings offers explicit version-1 file preview or reading the current verified user's old `web-boilerplate.workspace:<userId>` key. Neither is automatic. Anonymous and other-account keys are never discovered, read or altered. Corruption, unsupported versions, size limits, duplicate IDs and dangling references are rejected. Browser access denial remains visible; there is no local persistence fallback.

Download the preview before import. Imports require an empty target plus its current revision and explicit confirmation; server IDs are remapped transactionally. Canonical sorted-content fingerprints prevent duplicate application. The identical fingerprint remains rejected **even after rollback**: rollback removes the imported workspace, not the durable duplicate receipt, and does not authorize an identical reimport. Durable owner-scoped receipts survive refresh/lost responses through `/api/v1/workspace/import-receipt`. Rollback requires an unrolled receipt and the exact imported revision; any intervening edit prevents rollback. Export is a consistent version-1 envelope. Browser keys are never removed, even after successful import/rollback. Limits are 100 projects, 1000 tasks and a 2-MiB wire body, with a reserved serialized budget so valid workspaces can round-trip.

## Optional offline auth preservation

This utility is **not** part of normal startup. Stop old writers; have the operator make and verify a consistent offline SQLite backup/copy, including any WAL state through a proper SQLite backup procedure. Keep the original untouched. Preserve the original stable `BETTER_AUTH_SECRET` in the new API environment; the utility cannot cryptographically prove it matches the old installation. The confirmation flag is an operator assertion, not automatic discovery. Email ownership is still unverified; importing records does not verify email.

After explicitly migrating a new empty PostgreSQL target:

```sh
node apps/api/dist/import-auth.mjs \
  --source-copy=/absolute/operator-owned-offline-copy.sqlite \
  --confirm-offline --confirm-stable-secret --timestamp-unit=milliseconds
```

Choose `seconds` only for a source whose numeric units were verified by the operator. Ambiguous numeric timestamps without a unit fail closed. The utility reads only the selected copy in read-only mode, validates all tables/IDs/FKs/dates/booleans, preserves user/account/session/verification/rate-limit identity, hashes and timestamps, and imports in one bounded PostgreSQL transaction. Invalid calendar dates (including rollover/leap-day errors) and identities incompatible with the runtime user/session contracts are rejected before any target writes; auth IDs are never remapped. It rejects a nonempty target; an identical completed fingerprint is an idempotent receipt. It never deletes or modifies source bytes and never logs credentials. Tests use only temporary synthetic Better Auth SQLite fixtures and real isolated PostgreSQL, including password signin and the original cookie. Original per-user browser keys remain addressable because user IDs are preserved.

## Backup, restore and rollback

Use operator-managed `pg_dump --format=custom` or managed consistent snapshots, with connection credentials supplied securely (not command-line logs), encrypted storage and tested retention. Back up stable auth secrets separately. Rehearse `pg_restore` into a new isolated database, configure a matching API secret/public origin, run migration/readiness checks, and verify representative auth/workspace/export flows before switching traffic. Database backups contain sensitive sessions, password hashes and user content; never commit or attach them to diagnostics. Workspace export is not an auth backup.

Application rollback and import rollback are different. Import rollback is narrow and revision-guarded. A deployment rollback must use a schema-compatible prior artifact or restore an operator-approved backup into a separate database; never casually reverse migrations or reset the live volume. This implementation includes no automatic SQLite-to-PostgreSQL cutover, hosted TLS certification or disaster-recovery certification.
