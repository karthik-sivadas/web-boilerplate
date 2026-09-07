# Feature task: remove SQLite support

## Intent and acceptance criteria

- PostgreSQL is the sole supported application database; remove the offline auth importer and delivery entrypoint.
- Preserve published migration 004 exactly; migration 005 drops only its obsolete receipt table without CASCADE or a database reset.
- Keep workspace JSON import/export/receipts/rollback, browser preview, auth/session behavior, runtime/dependency pins, React/theme and runner unchanged.

## Agent profiles

Implementation uses Astra medium only; supervisor owns independent review, local legacy-data deletion, development migration and publication. No agents launched.

## Test first

- SQLite driver import fixtures fail before boundary enforcement.
- Real isolated PostgreSQL upgrade regression fails before migration 005.
- Actual rebuild regression seeds a stale importer and fails before build entry removal; copied artifact and Docker checks reject importer delivery.
- Full `pnpm verify` and owned Docker smoke provide unchanged application/session/PostgreSQL evidence. Executed counts and limitations belong in the handoff and current verification map.

## Owned paths

API importer/build/migrations/tests, root boundary and packaging regressions, current docs. No private stores, services, secrets or immutable migration changes.

## Route and data contract

No HTTP/DTO changes. `sqlite:` DATABASE_URL rejection remains. Browser storage is not SQLite.

## Production impact

- Authentication/authorization: existing PostgreSQL Better Auth behavior unchanged; offline auth import unsupported.
- Database or migration: supervisor must explicitly apply 005 after checks; tests use only explicit test URLs and owned random targets.
- Accessibility and error states: no UI change; existing failure, focus and browser gates remain.
- Telemetry/privacy: no new logging; no private data access. Actual authorized legacy SQLite data deletion remains a supervisor action.
- Documentation: historical ADRs/evidence remain clearly superseded; no active SQLite setup/import instructions. Better Auth optional peer lock metadata is not an installed SQLite dependency.
- Rollout/rollback: forward migration only; never reset PostgreSQL or rewrite 004. No feature flag or publication in this task.
