# ADR 001: approved pinned Nitro prerelease

TanStack Start's maintained Node/Docker integration uses the actively developed `nitro/vite` plugin. Astra approved exact `nitro@3.0.260903-beta` rather than a custom adapter or a platform-specific alternative. `vite.config.ts` uses `tanstackStart(), nitro(), viteReact()` and `pnpm build` produces `.output/server/index.mjs`.

This is a conscious infrastructure risk. Pinning, frozen installs, native production tests, browser tests, and Docker CI are mandatory mitigations; upgrades require the full gate. See the upstream hosting guide and `docs/research.md`.
