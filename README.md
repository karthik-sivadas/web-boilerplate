# Workbench

A polished, local-first TanStack Start foundation. It deliberately ships a useful browser-only workspace instead of pretend SaaS infrastructure.

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
pnpm dev
# configuration-free build; configure runtime before pnpm start (see deployment)
pnpm build
```

Open `http://localhost:3000` after `pnpm dev`. Development needs no `.env`: it reuses repository-root `.data` for local SQLite and a stable development secret, discovered from the nearest `pnpm-workspace.yaml` ancestor even when running in `apps/web`. Production requires runtime-only `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and absolute `AUTH_DATABASE_PATH`; see [deployment](docs/deployment.md). Install Chromium before browser verification: `pnpm exec playwright install --with-deps chromium`.

## Commands

`pnpm verify` runs `format:check`, `lint`, `typecheck`, `test:coverage`, `build`, `test:artifact`, then `test:e2e`; Playwright starts the built Nitro Node artifact for workspace journeys, never Vite preview. A separate test-only Vite entry exercises the same app locale/controls in RTL; it is not a production route. Other scripts are `dev`, `start`, `test`, `format`, and `agent`. Set `PLAYWRIGHT_BASE_URL` only when testing an already-running external artifact (the Docker CI job does this).

## What is included

- Same-origin Better Auth email/password accounts with database-authoritative seven-day sessions; email ownership is unverified and SMTP, recovery, verification, and OAuth are deferred.
- Responsive overview, projects, tasks, archive rules, reset controls, official shadcn React Aria Lyra controls, and SSR guest redirects.
- Account-partitioned, versioned localStorage with recovery and honest in-memory fallback. It is local UI partitioning, not cloud sync or protection from browser-profile/devtools access.
- TanStack Start SSR routed through a pinned Nitro 3 beta Node-server artifact; startup migrations gate every request until ready and `GET /api/health` is no-store.
- A small Pi orchestration CLI with bounded JSONL parsing and no automatic publication.

This is **not** cloud workspace persistence, collaboration, billing, email verification/recovery, OAuth, or a production certification. See [production readiness](docs/production-readiness.md) and the [research landscape](docs/research.md).

## File map

- `apps/web/src/routes` route composition and health endpoint
- `apps/web/src/features/{workspace,auth}` domain, persistence, account UI
- `apps/web/src/lib/auth`, `apps/web/src/server/plugins/auth.ts` server-only auth and startup gate
- `apps/web/scripts/auth-setup.ts`, `apps/web/vite.config.ts` app tooling
- `packages/ui/src` official Aria controls, hooks, utility, shared CSS/fonts
- `scripts/agents` executable runner; `agents` Astra profile instructions
- `tests` root orchestration/Playwright/RTL harness; unit tests colocated with source
- `docs` architecture, deployment, research, and agent guidance

## Exact UI preset

```sh
pnpm dlx shadcn@latest init --preset b5rR41Mtnc --base aria --template start --monorepo --rtl --pointer
```

This command generated an isolated reference, not an overwrite of the working repository. CLI 4.21.0, upstream template HEAD `7c9eaba1c0a6404c990c144a654792e3313c650d`; merged structure retains our exact toolchain pins and Nitro integration. Shared UI uses stone/orange, Outfit/Oxanium, Hugeicons, menu default/subtle, radius token 0.625rem and Lyra square controls. Default language/direction is English/LTR; the shared Aria locale path is RTL-ready, not an Arabic translation. See [ADR 003](docs/adr-003-aria-monorepo.md).

**Auth phase-2 local gates pass:** mounted session reconciliation, real SQLite/auth/startup tests and production-artifact browser/cache/401 regressions are covered by 75 tests and 14 browser executions. Independent review and hosted Docker/deployment acceptance still block release. See [test mapping and limits](docs/auth-verification.md).

## Agent runner

```sh
pnpm agent --dry-run "describe work"
pnpm agent --plan "describe work"
pnpm agent --apply .agent-runs/plans/<saved-plan>.json
```

It uses your already-installed `pi` and external authentication; it never copies credentials. All profiles use `openai-codex/gpt-6-astra`: high reasoning for planning/review/hard problems, medium for implementation/repairs, and low for research. Reasoning is explicit on every invocation; nonmatching provider/model overrides fail closed. Provider usage incurs costs. `--apply` is trusted local code execution, and role prompts/tool allowlists are not a sandbox. Bash-enabled Astra low research needs explicit consent. No command commits, pushes, or publishes. See [agent workflow](docs/agent-workflow.md).

## Deployment

`Dockerfile` builds a non-root Node 24.13.1 image and copies `apps/web/.output` into runtime `/app/.output` and runs `.output/server/index.mjs`. HSTS belongs at an HTTPS proxy, not local HTTP. Read [deployment](docs/deployment.md) before production use.

MIT © Karthik Sivadas.
