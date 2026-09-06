# Production readiness matrix

The layered PostgreSQL implementation is not production certification. Independent review and supervisor-controlled publication remain required. See [operations](postgres-operations.md) and [verification mapping](postgres-verification.md).

| Area                      | Current boundary                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                      | Better Auth email/password, PostgreSQL sessions, authoritative read-only guards, confirmed logout; email ownership unverified                                                                            |
| Workspace                 | Server-authorized owner-scoped CRUD, revisions, session intent, atomic imports/receipts/guarded rollback; bounded small aggregate, no pagination/collaboration                                           |
| Browser preservation      | Explicit selected-account preview/download/import; no automatic migration or deletion of legacy bytes                                                                                                    |
| Offline auth preservation | Optional confirmed offline SQLite-copy utility with stable-secret assertion; synthetic tests, not a claim about an operator's unknown database                                                           |
| Packaging                 | Separate source-free web/API artifacts and non-root Docker targets; PostgreSQL persists separately                                                                                                       |
| Security tests            | Real PG and browser/proxy tests, bounded pools/requests, CSRF/spoof/cache/session regressions; independent audit/review still required                                                                   |
| Operations                | Explicit migration CLI, local Compose and CI smoke, liveness/readiness, documented backups and restore rehearsal; production permissions, TLS, monitoring and retention remain operator responsibilities |
| Mail/recovery             | SMTP, ownership verification, password recovery and OAuth are not implemented                                                                                                                            |
| Deployment                | Local Docker/Chromium evidence does not certify hosted TLS, physical mobile devices, every browser, HA, disaster recovery or native Windows process shutdown                                             |

Never reuse CI fixtures for deployment, print secrets, silently replay uncertain writes, auto-migrate on startup or run destructive volume commands on existing services.
