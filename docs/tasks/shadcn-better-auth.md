# Feature task: shadcn/ui and Better Auth

**Historical milestone, superseded for storage/auth startup.** SQLite support and the later offline importer are removed. The requirements and counts below describe prior work, not current setup or acceptance. See [current PostgreSQL operations](../postgres-operations.md) and [verification](../postgres-verification.md).

## Intent and acceptance criteria

Add same-origin email/password authentication backed by Better Auth 1.7.3 and a local SQLite database. Protect all workspace routes while keeping workspace data partitioned in browser storage per authenticated user. Use the user-authoritative exact shadcn aria-lyra preset and apps/web + packages/ui monorepo layout (ADR 003), preserving pinned Nitro/auth integration and Astra high/medium/low profiles.

## Test first

- Unit tests cover account-scoped storage, legacy-key non-import, and failed-write atomicity.
- **Locally verified:** real handler/temp-SQLite tests for credential hashing, invalid login, logout/revocation, expiry, CSRF, rate limits, cookie/refresh behavior; the shared production startup helper has failure/timeout tests.
- Existing browser journeys sign up through the UI and verify workspace persistence and keyboard/axe. Phase 1 adds shared-provider RTL layout/selection/portal/focus checks, not auth isolation acceptance.
- **Locally verified:** mounted reconciliation, two-tab/same-user replacement, delayed/failed checks, mobile logout/replay, actual generated RPC401 and query/cache/cookie regressions. [Mapping and limitations](../auth-verification.md): 75 tests/14 browser executions; independent security and hosted deployment review remain.

## Route and data contract

- `/sign-in` and `/sign-up` are public.
- `/`, `/projects`, `/projects/$projectId`, `/tasks`, and `/settings` require a server-verified session.
- User DTOs expose only `id`, `name`, and `email`; reconciliation additionally returns a session ID, never its token. Protected functions infer identity from the session.

## Production impact

- **Authentication/authorization:** seven-day database-authoritative sessions; email ownership is unverified.
- **Database or migration:** startup runs idempotent Better Auth migrations against the configured SQLite path.
- **Accessibility and error states:** labelled forms, native validation, pending states, handler-safe errors, and visible logout/storage failures.
- **Telemetry/privacy:** no credentials, token, or session data is put in browser storage or route hydration.
- **Documentation:** document runtime env, single-instance SQLite operations, backups, reverse proxy IP behavior, and deferred email/OAuth features.
- **Rollout, rollback, and feature flag:** deploy a single instance with a persistent volume; back up SQLite before upgrades. No feature flag.
