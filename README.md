# Workbench

A TanStack Start web application with a standalone Hono API and PostgreSQL-backed, account-scoped workspaces.

## Quick start

Create a new repository from this template in GitHub with **Use this template**, or from the CLI:

```sh
gh repo create my-workbench --template karthik-sivadas/web-boilerplate --private
# Clone the newly created repository, then enter it.
git clone https://github.com/<your-account>/my-workbench.git
cd my-workbench
```

Requires Node `24.13.1` and pnpm `11.7.0`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup:local       # missing-only private configuration; never migrates
pnpm db:up             # owned Compose PostgreSQL, unless using an existing configured server
pnpm db:migrate        # explicit reviewed migrations
pnpm dev               # web + API with separate environments
# configuration-free build; configure runtime before starting artifacts
pnpm build
```

Open `http://localhost:3000`. Setup creates `.data/development.env` with mode 0600 only when absent; inherited environment wins over dotenv values. Existing files/secrets are never overwritten. Use `--config=/absolute/selected.env` for a different operator-selected configuration. The application is PostgreSQL-only; SQLite and offline auth import are unsupported. Browser workspace preview/JSON import remains explicit. See [PostgreSQL operations and preservation](docs/postgres-operations.md). Install Chromium with `pnpm exec playwright install --with-deps chromium`.

## Commands

`pnpm verify` includes formatting, enforced import boundaries, types, root coverage, real-PG API tests, both builds, source-free artifact/browser outage checks, and desktop/mobile Playwright. Supply inherited `TEST_DATABASE_URL` and `PG_TEST_ADMIN_URL` pointing at an explicit test administrator database; tests allocate only random owned schemas/databases. `pnpm test:docker` separately creates and cleans its own Compose project/volume and proves real PostgreSQL/API restart and outage behavior. The standalone RTL Vite entry uses synthetic DTO fixtures, never production seeding. See [verification mapping](docs/postgres-verification.md).

## What is included

- Same-origin Better Auth email/password accounts with database-authoritative seven-day sessions; email ownership is unverified and SMTP, recovery, verification, and OAuth are deferred.
- Responsive overview, projects, tasks, archive rules, name-confirmed cascade deletion, official shadcn React Aria Lyra controls, and authoritative SSR guest redirects.
- PostgreSQL owner-scoped CRUD with revision and expected-session preconditions; failed writes retain drafts and require explicit reconciliation, never local fallback.
- Versioned export, explicit empty-account import, durable duplicate receipts and revision-guarded rollback; legacy browser bytes are previewed only on request and never changed.
- Fixed same-origin web proxy. Independent `/health/live`, dependency-aware `/health/ready`, bounded operations and explicit migrations; runtime/build never migrate.
- A small Pi orchestration CLI with bounded JSONL parsing and no automatic publication.

This is **not** collaboration, billing, email verification/recovery, OAuth, or a production certification. See [production readiness](docs/production-readiness.md) and the [research landscape](docs/research.md).

## File map

- `apps/web/src/routes` thin route composition; workspace API/hooks/view-models/components/pages below `features/workspace`
- `apps/web/src/server` fixed proxy/SSR identity adapters, with no database or auth secret
- `apps/api` standalone HTTP/auth composition, PostgreSQL adapters and explicit migrations
- `packages/workspace-core` pure rules and semantic application ports; `packages/contracts` independent wire DTOs
- `scripts/local.ts` integrated setup/development/migration commands
- `packages/ui/src` official Aria controls, hooks, utility, shared CSS/fonts
- `scripts/agents` executable runner; `agents` Astra profile instructions
- `tests` root orchestration/Playwright/RTL harness; unit tests colocated with source
- `docs` architecture, deployment, research, and agent guidance

## Exact UI preset

```sh
pnpm dlx shadcn@latest init --preset b5rR41Mtnc --base aria --template start --monorepo --rtl --pointer
```

This command generated an isolated reference, not an overwrite of the working repository. CLI 4.21.0, upstream template HEAD `7c9eaba1c0a6404c990c144a654792e3313c650d`; merged structure retains our exact toolchain pins and Nitro integration. Shared UI uses stone/orange, Outfit/Oxanium, Hugeicons, menu default/subtle, radius token 0.625rem and Lyra square controls. Default language/direction is English/LTR; the shared Aria locale path is RTL-ready, not an Arabic translation. See [ADR 003](docs/adr-003-aria-monorepo.md).

Releases require the documented verification gates, review and a separately authorized publication action. Local test results do not imply review approval or hosted CI/deployment acceptance. See [verification and evidence limits](docs/postgres-verification.md).

## Agent runner

```sh
pnpm agent --dry-run "describe work"
pnpm agent --plan "describe work"
pnpm agent --apply .agent-runs/plans/<saved-plan>.json
```

It uses your already-installed `pi` and external authentication; it never copies credentials. All profiles use `openai-codex/gpt-6-astra`: high reasoning for planning/review/hard problems, medium for implementation/repairs, and low for research. Reasoning is explicit on every invocation; nonmatching provider/model overrides fail closed. Provider usage incurs costs. `--apply` is trusted local code execution, and role prompts/tool allowlists are not a sandbox. Bash-enabled Astra low research needs explicit consent. No command commits, pushes, or publishes. See [agent workflow](docs/agent-workflow.md).

## Deployment

`Dockerfile` builds separate non-root Node 24.13.1 `web` and `api` targets containing only built artifacts. Compose supplies PostgreSQL; web receives only `API_INTERNAL_URL`, while API receives database/auth configuration. HSTS and public TLS belong at the HTTPS proxy. Read [PostgreSQL operations](docs/postgres-operations.md) before deployment.

MIT © Karthik Sivadas.
