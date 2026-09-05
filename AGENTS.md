# Contributor and agent instructions

Use Node 24.13.1 and pnpm 11.7.0. Run `pnpm format`, then `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, and `pnpm test:e2e` before handing off; `pnpm verify` runs the full gate.

Keep routes thin. Put workspace rules and persistence in `src/features/workspace`; validate external data with Zod. Browser storage must not run during SSR or module initialization. Preserve accessible native controls and Radix dialog behavior. Do not add credentials, account UI, cloud-write endpoints, commits, pushes, or generated run evidence.

For a feature, copy `docs/tasks/feature-task-template.md`, write/adjust a focused test first, define acceptance and accessibility/error states, then update docs. Keep changes scoped and explain deferred production dependencies rather than faking them.

The `pnpm agent` runner is trusted local execution, not a sandbox. It never publishes automatically. Do not invoke it in CI.
