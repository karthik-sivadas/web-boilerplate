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
# production proof
pnpm build && pnpm start
```

Open `http://localhost:3000` after `pnpm start`. No `.env` is required. Install Chromium before browser verification: `pnpm exec playwright install --with-deps chromium`.

## Commands

`pnpm verify` runs `format:check`, `lint`, `typecheck`, `test:coverage`, `build`, then `test:e2e`; Playwright starts the built Nitro Node artifact, never Vite preview. Other scripts are `dev`, `start`, `test`, `format`, and `agent`. Set `PLAYWRIGHT_BASE_URL` only when testing an already-running external artifact (the Docker CI job does this).

## What is included

- Responsive overview, projects, tasks, archive rules, reset controls, accessible Radix dialogs, 404/error states.
- Versioned and validated localStorage, recovery instead of silent deletion, and honest in-memory fallback.
- TanStack Start SSR routed through a pinned Nitro 3 beta Node-server artifact; `GET /api/health` is no-store and minimal.
- A small Pi orchestration CLI with bounded JSONL parsing and no automatic publication.

This is **not** authentication, cloud sync, server-side writes, collaboration, billing, or a production certification. See [production readiness](docs/production-readiness.md) and the [research landscape](docs/research.md).

## File map

- `src/routes` route composition and health endpoint
- `src/features/workspace` domain, persistence, UI
- `scripts/agents` executable runner; `agents` role instructions
- `tests` unit/component and Playwright coverage
- `docs` architecture, deployment, research, and agent guidance

## Agent runner

```sh
pnpm agent --dry-run "describe work"
pnpm agent --plan "describe work"
pnpm agent --apply .agent-runs/plans/<saved-plan>.json
```

It uses your already-installed `pi` and external authentication; it never copies credentials. Costs are charged by your selected provider. `--apply` is trusted local code execution, and role prompts/tool allowlists are not a sandbox. Bash-enabled Luna research needs explicit consent. No command commits, pushes, or publishes. See [agent workflow](docs/agent-workflow.md).

## Deployment

`Dockerfile` builds a non-root Node 24.13.1 image and runs `.output/server/index.mjs`. HSTS belongs at an HTTPS proxy, not local HTTP. Read [deployment](docs/deployment.md) before production use.

MIT © Karthik Sivadas.
