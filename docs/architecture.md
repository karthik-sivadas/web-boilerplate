# Architecture

See [ADR 004](adr-004-layered-postgres.md) for decisions/diagram and [research](architecture-research.md) for their sources. PostgreSQL supersedes historical SQLite recommendations.

```text
Browser: route → page/component → session-scoped query/action → contracts
                                 ↓ same-origin HTTP
Web: Start SSR + fixed Nitro proxy (no SQL/auth secret)
                                 ↓ private fixed API URL
API: Hono/auth/HTTP → core application ports → core rules
                       ↑ PostgreSQL semantic transaction adapter
                       ↓
              PostgreSQL auth/workspace/receipts/revisions
```

`packages/workspace-core` owns pure immutable rules and application orchestration with injected actor, time and IDs. It has no React/HTTP/SQL/browser/environment imports. `packages/contracts` owns strict independent wire DTOs. API adapters translate these to core operations and implement owner-scoped transactions. `packages/ui` remains presentation-only and preserves the exact Aria stone/orange Outfit/Oxanium/Hugeicons preset. ESLint resolves imports, exports and dynamic imports to their actual files, including relative bypasses; executable consumer failure fixtures exercise the rule.

Web workspace code is split into API client, request/query coordination, view-model projections, components, pages and an explicit read-only legacy preview adapter. Thin route files compose these. New accounts are empty; no demo/local-storage write fallback exists. Failed mutations keep drafts open, make uncertainty visible and require canonical reload before another write.

Start creates request-specific router/query state rather than a shared SSR client. Server identity uses only the incoming Cookie against `/api/v1/session`; a dependency outage is not treated as guest. Mounted `SessionBoundary` reconciles Better Auth's public HTTP session with a fresh read-only RPC identity. Pending/error/mismatch removes private UI, revokes leases and cancels/clears queries. User/session/epoch cache keys isolate replacements, including same-user sessions. Every workspace read/write sends the session ID captured by its initiating lease. The API verifies the cookie first, compares intent before business access, and returns `SESSION_CHANGED` on mismatch. Pre/post lease checks reject late responses without replaying drafts.

Vite/Start build separate client/server bundles; the pinned Nitro 3 Node target emits `apps/web/.output`. The API bundles into `apps/api/dist`, including migration SQL and separate operator CLIs. Neither runtime needs workspace source. Builds/startup never migrate. Web and API liveness are independent of dependencies; readiness fails closed on database/migration errors. Timeouts do not prove SQL rollback.

Root pnpm/Turbo orchestrate both applications and the three packages. Root agent runner remains unchanged. See [operations](postgres-operations.md), [verification mapping](postgres-verification.md), and [release checklist](tasks/layered-postgres.md). Independent review/publication remains supervisor-owned.
