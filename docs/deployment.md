# Deployment

The current layered PostgreSQL deployment, local setup, process environments, explicit migrations, Docker targets, backup/restore and preservation runbook is [PostgreSQL operations](postgres-operations.md).

Web runs the copied `apps/web/.output` artifact with only `API_INTERNAL_URL` and listener configuration. API runs the copied `apps/api/dist` artifact with PostgreSQL and stable Better Auth configuration. PostgreSQL owns durability. Builds/runtime never migrate, web has no SQLite/data volume, and old SQLite deployment instructions are superseded. SQLite support and the offline auth-import utility are removed. Apply forward migration 005 explicitly before deploying the new API; retain immutable migration 004.

See [verification and limits](postgres-verification.md) and [production readiness](production-readiness.md). Successful local/Docker tests do not authorize publication or certify a hosted deployment.
