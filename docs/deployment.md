# Deployment

Build with `pnpm build`; root `pnpm start` delegates to Nitro's `apps/web/.output/server/index.mjs`. Docker copies that output into `/app/.output` with no source/workspace marker required. Build requires no auth secret or database. At runtime production requires all of:

```sh
export NODE_ENV=production
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)" # provision once; retain across restarts
export BETTER_AUTH_URL=https://workbench.example.com
export AUTH_DATABASE_PATH=/app/data/auth.sqlite # existing writable parent directory
HOST=0.0.0.0 PORT=3000 pnpm start
```

`BETTER_AUTH_URL` is one HTTPS origin without a path/query/credentials. Literal loopback HTTP is permitted only for local artifact checks. Never supply these values through `VITE_*`. Development discovers the nearest ancestor `pnpm-workspace.yaml` from app cwd and reuses ignored repository-root `.data/auth.sqlite` plus a stable generated secret (directory 0700, secret file 0600) and binds strictly to `http://localhost:3000`.

Runtime startup validates config and runs idempotent Better Auth migrations before readiness. Nitro gates every request with 503/no-store until it finishes and exits nonzero on initialization failure or a 60-second timeout. `pnpm auth:setup` runs the same initialization for an explicit local check.

Production branches before workspace discovery and requires an absolute DB path; no source file or workspace marker is needed in an output-only runtime. Root start/auth setup delegate directly (uncached); Turbo dev/build use loose environment mode so runtime variables are not silently filtered. No `.env` autoloading is promised.

Docker excludes private data, env, dependencies and build artifacts recursively before copying context. It installs from root and workspace manifests with the frozen lockfile, builds app output, and uses a non-root app user and `/app/data` volume. Mount storage owned/writable by that UID (or let Docker create the named volume):

```sh
docker build -t workbench .
docker volume create workbench-data
docker run --rm -p 3000:3000 -v workbench-data:/app/data \
  -e BETTER_AUTH_SECRET \
  -e BETTER_AUTH_URL=https://workbench.example.com \
  -e AUTH_DATABASE_PATH=/app/data/auth.sqlite workbench
```

Retain the provisioned secret and volume across recreation. Hosted CI checks the same session cookie after restart with bounded readiness polling; local source verification is not hosted Docker evidence. Local auth phase-2 tests now pass ([mapping](auth-verification.md)); independent review and actual hosted results remain required.

SQLite is single-instance, local-disk persistence only: do not use network filesystems or multiple replicas; back up `/app/data/auth.sqlite` before upgrades. SMTP, email verification/recovery, and OAuth are intentionally deferred. Email/password accounts have **unverified email ownership**.

Rate limits are database-backed: 100 requests/60s globally, sign-in 3/10s, and sign-up 5/60s. This starter deliberately ignores `X-Forwarded-For` and uses a conservative shared per-path bucket, so forged forwarding headers cannot bypass it but users share those limits. Configure and test a trusted proxy/authoritative peer-IP bridge before replacing this behavior.

Workspace data is browser-local and keyed by account. This partitions normal views only; it does not protect against someone with access to that browser profile/devtools and it provides no cloud sync.
