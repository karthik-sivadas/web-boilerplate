# ADR 003: exact shadcn Aria preset and workspace layout

The user-authoritative command supersedes the prior flat/Radix design:

```sh
pnpm dlx shadcn@latest init --preset b5rR41Mtnc --base aria --template start --monorepo --rtl --pointer
```

An isolated official reference used CLI **4.21.0** with upstream GitHub template HEAD **7c9eaba1c0a6404c990c144a654792e3313c650d** observed before/after generation. Templates follow upstream main independently of CLI versions. Structure was merged into the dirty repository, never initialized over it. Working Node 24.13.1, pnpm 11.7.0, TS 6.0.3, React 19.2.8, Vite 8.2.2, Start 1.168.49, Router 1.170.32, Query 5.102.8, Nitro 3.0.260903-beta and Better Auth 1.7.3 pins remain; no floating template versions or template devtools were adopted.

## Ownership

- `apps/web`: existing application, server-only auth/startup plugin, colocation tests, Vite config, auth setup script.
- `packages/ui/src`: official registry Button/LinkButton, Input, Label, Card, Dialog, AlertDialog, Badge, Select, Textarea, InputGroup dependency, DirectionProvider, utility and shared globals.css. Source exports are consumed through `@workspace/ui`.
- Root: pnpm/Turbo, strict TS/ESLint configuration, `tests`, `scripts/agents`, `agents`, CI/Docker and docs. Existing fixed Astra high/medium/low profiles, lock/fingerprint/ownership rules, and root agent/verify commands remain intact.

Both components.json files use aria-lyra, hugeicons, RTL true, menu default/subtle, stone metadata and canonical aliases. Upstream monorepo init forces neutral metadata even though the exact endpoint returns stone; only that metadata was corrected. Shared CSS retains the exact orange/stone light/dark/chart tokens, Outfit/Oxanium imports, pointer rule and radius **0.625rem** token. Lyra controls intentionally remain **rounded-none**. CSS Modules use logical layout and existing preset tokens, not old palettes/fonts/radii. The reset launcher uses outline; destructive confirmation text uses the foreground token over the official destructive tint for AA contrast (the reference's small red text on its tint fails axe). No shared palette was altered.

Minimal generated-source compatibility changes retain composition/styles: strict optional props are omitted or normalized instead of explicitly passing undefined; InputGroup leaf types use actual Aria Input/Textarea props; an unused import is removed. Local lint annotations explain the official addon pointer-focus forwarding and search/least-destructive dialog autofocus; application checks and coverage thresholds remain enabled.

## Interaction and direction

Buttons use onPress/isDisabled, leaf Input/Textarea native change events/disabled, Select key value/onChange and item id. Native forms receive Aria's hidden select values. Dialog is the actual overlay/content wrapper, not a Radix root plus DialogContent. Destructive save/reset uses controlled non-close-slot Buttons so persistence failure retains the dialog and consent controls. Contextual Label is distinct from SelectLabel (section header).

`apps/web/src/components/app-locale.tsx` composes deterministic I18nProvider(en-US) then the official DirectionProvider(direction), without passing an explicit locale that would defeat the direction script adapter. The same context supplies root lang/dir. Production defaults English/LTR. `tests/rtl` is a separate browser entry using this same provider and workspace UI under RTL; it is not a Start route or production flag. Tests cover mirrored sidebar, keyboard select/form values, portal direction/centering, focus trap/return, Escape, overlay dismissal, destructive cancellation and axe.

## Runtime and acceptance boundary

Dev-only nearest workspace-marker lookup preserves repository-root data when app cwd moves. Production validates explicit absolute DB path/origin/secret before any workspace lookup. Output-only Docker copies `apps/web/.output` to `/app/.output`; root/manifests support frozen installation, private data/env are recursively excluded. Startup gate and same-volume/session recreation CI remain, with bounded fatal polling.

An output-only test exposed Aria's CJS external-store shim retaining `require("react")` in Vite's intermediate SSR chunk. Nitro `traceDeps: ["react"]` now includes the exact installed React runtime in `.output`; no pin changes or source/runtime workspace copies. Partially bundling React in SSR was rejected because it created duplicate React dispatchers. `tests/start-artifact.ts` copies only built output into a fresh temporary directory, supplies fresh fixture configuration, and launches the real Node server for all existing local browser journeys. This prevents repository node_modules from hiding packaging regressions.

**Historical auth milestone (SQLite support is now removed; see [current verification](postgres-verification.md)). Phase 1 was not auth acceptance.** The subsequent phase-2 implementation added mounted session reconciliation, real auth/SQLite/startup tests and generated-RPC/cache/artifact browser regressions; see [mapping and remaining limits](auth-verification.md). These local gates do not replace independent Astra high review or hosted deployment proof. No publication before that review.
