# Contributor and agent instructions

Use Node 24.13.1 and pnpm 11.7.0. Run `pnpm format`, then `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, and `pnpm test:e2e` before handing off; `pnpm verify` runs the full gate.

Keep routes thin. Put workspace rules and persistence in `apps/web/src/features/workspace`; validate external data with Zod. Browser storage must not run during SSR or module initialization. `packages/ui/src` owns official shadcn aria-lyra controls and exact stone/orange Outfit/Oxanium theme; app CSS Modules own logical layout, not palette/radius overrides. Preserve Aria onPress/isDisabled, native leaf input validation, Select key/onChange composition, dialog focus return, and failed-write consent. Default English/LTR and tests share `apps/web/src/components/app-locale.tsx`; no production test switches. The authoritative preset is `pnpm dlx shadcn@latest init --preset b5rR41Mtnc --base aria --template start --monorepo --rtl --pointer`; do not initialize over a dirty repository.

The approved phase-1 monorepo/preset migration preserves all Better Auth and Astra changes; auth security acceptance remains pending phase 2. Keep `scripts/agents` and `tests` orchestration at root, root `pnpm agent`/`pnpm verify` intact, and exact runtime pins. Development app cwd must resolve repository-root `.data` via nearest workspace marker; production branches first and needs only explicit runtime configuration and built output. Never read, copy, delete or overwrite private stores during migration. Do not commit credentials, add cloud-write endpoints, commits, pushes, or generated run evidence.

For a feature, copy `docs/tasks/feature-task-template.md`, write/adjust a focused test first, define acceptance and accessibility/error states, then update docs. Keep changes scoped and explain deferred production dependencies rather than faking them.

Use only `openai-codex/gpt-6-astra`: high reasoning for planning, review, and hard problems; medium for all implementation and repairs; low for research. Runner legacy keys `astra`/`terra`/`luna` map to these high/medium/low profiles, not different models. Every execution must pass explicit `--thinking`; mismatched provider/model overrides fail closed.

The `pnpm agent` runner is trusted local execution, not a sandbox. It never publishes automatically. Do not invoke it in CI.
