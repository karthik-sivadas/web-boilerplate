# Layered PostgreSQL implementation acceptance

Latest user instruction authorizes full PostgreSQL implementation; only the supervisor commits/publishes after review. Checked items refer to implementation/functional evidence, not independent release acceptance or publication.

## M1 foundation

- [x] Preserve runtime/frontend/theme/runner pins and existing web behavior during transition.
- [x] Record architecture/database research, dated sources, decisions and supersession of SQLite recommendation.
- [x] Core rules, explicit actor, semantic transaction port, injected clock/IDs and strict v1 DTOs.
- [x] Standalone Hono/Node API, real PostgreSQL auth/business persistence, bounded pools and sanitized errors.
- [x] Reviewed actual Better Auth-generated SQL, version/checksum ledger, one-client advisory lock/transaction, explicit migrations and fail-closed readiness.
- [x] CRUD, empty accounts, revisions, owner-scoped constraints, archive/task immobility, project-name confirmation/cascade and byte/count limits.
- [x] Real isolated PostgreSQL HTTP tests: auth cookies/hashes/login/logout, actor spoofing, CSRF, ownership, concurrent revisions, rollback, guards, rate limits and outages.
- [x] Copied source-free artifact test with explicit migrations, real HTTP and process restart retaining cookie/workspace.
- [x] Foundation review repairs: confirm sign-out revocation before forwarding success/cookies, require expected-session binding before workspace access, include readiness in the handler deadline, and build fresh artifacts without stale migrations.
- [x] Additional real-PG evidence: HTTPS-origin Secure cookies, independent-client archive/create race, combined SQL readiness/downstream delays and client cleanup, active-transaction SIGTERM drain and restart persistence.
- [ ] Supervisor independent review and final M1 acceptance. See handoff for exact executed gates, not a claim of full `pnpm verify`.

## M2 required before release

- [x] Fixed same-origin API proxy preserving methods/status/query/cookies/Origin, distinct Set-Cookie, no-store and forwarding-header stripping.
- [x] UI/hooks/projections/forms/pages split with desktop/mobile, keyboard, RTL and serious/critical axe checks retained; shared preset/theme unchanged.
- [x] Request-scoped SSR identity, session/epoch query keys and action leases; captured expected-session header; actual-cookie stale mutation/read browser proof; no replay/local fallback and retained failed drafts.
- [x] Empty-only import/export, ID/reference remapping, durable duplicate receipts recoverable after refresh, revision-guarded rollback and maximum-byte roundtrip tests.
- [x] Explicit browser preview/download/import; anonymous/old keys unchanged.
- [x] Optional offline auth CLI: explicit read-only SQLite copy, stable-secret assertion, preserved IDs/hashes/sessions, synthetic fixtures only.
- [x] Resolved-import ESLint boundaries, relative/root-tooling/dependency bypass and CommonJS consumer failures; transitional web domain/persistence removed.
- [x] Compose, integrated setup/dev/migrate, CI real PostgreSQL, current deployment/backup/preservation runbooks.
- [x] Real-PG deadline/security/drain regressions plus actual copied-artifact HTTP/browser and owned Docker PostgreSQL restart/API+PG outage/recovery proof. Supervisor's existing service untouched.
- [ ] Independent high review, final acceptance and supervisor-only main publication. Full executed gate counts/limits belong in the handoff; [capability mapping](../postgres-verification.md) explains intentionally retired local writes/reset/memory mode.

## Safety / ownership

Tests require explicit test URLs and generate owned random schemas (all normal/guard/planner pools share the same search_path); artifact tests additionally require an explicitly named test-admin URL and create/drop only their random database. Test helpers refuse development/non-test targets. No existing `.data`, `.env`, browser stores or user databases are read, copied, deleted or migrated by implementation tests. Synthetic config/SQLite/browser fixtures and random owned PostgreSQL targets are the only preservation test inputs. The existing PostgreSQL service/volume belongs to the supervisor. Never stop/reconfigure it or launch agents.
