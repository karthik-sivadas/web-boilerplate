# Research landscape: reusable TanStack web boilerplate

**Accessed:** 2026-09-05 UTC. This is a comparison of public sources and their documented maintenance signals, not an endorsement of copying their stacks or vendor integrations. Repository `pushed_at` dates are maintenance signals, not quality rankings.

## Decisions in this repository

The starter adopts a small, credential-free browser demo, deterministic checks, typed routing, and a portable Node artifact. It deliberately does **not** preselect authentication, a database, cloud sync, telemetry, queues, email, billing, or a hosting vendor. Those need product-specific threat modelling, ownership, and tests.

| Source                                                                                      | What the source demonstrates                                                                                                       | Adopt / reject decision                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [thoughtbot/suspenders](https://github.com/thoughtbot/suspenders)                           | A mature generator with explicit prerequisites and CI that creates and boots a fresh application.                                  | **Adopt** the generated-app/fresh-clone verification mindset; do not adopt its Ruby/Postgres/Redis/Heroku choices.                           |
| [Rootstrap Node TypeScript API base](https://github.com/rootstrap/node-ts-api-base)         | Express, TypeORM, OpenAPI, Docker, migrations, Jest, linting and Sonar conventions; its README still names Node 14.16.             | **Reject** its runtime baseline and framework-specific defaults. Use it as a warning that an active repository can retain stale assumptions. |
| [Vinta Django React boilerplate](https://github.com/vintasoftware/django-react-boilerplate) | CSP, Permissions Policy, OpenAPI generation, background jobs, Redis and monitoring are useful operational concerns.                | **Adopt selectively** as a release-capability checklist, not Django/Webpack infrastructure.                                                  |
| [BigBinary Wheel](https://github.com/bigbinary/wheel)                                       | Opinionated Rails defaults and review/deployment tooling; its README says it is archived and unsupported.                          | **Reject** as a dependency foundation. It is historical research only; no dependencies, credentials, or defaults are inherited.              |
| [Infinite Red Ignite](https://github.com/infinitered/ignite)                                | Generator/CLI design, documentation, dependency-cruiser, tests, formatting and release automation.                                 | **Adopt** its generator and documentation mindset only. It is React Native/Expo, not a web base.                                             |
| [T3 create-t3-app](https://github.com/t3-oss/create-t3-app)                                 | Explicitly modular composition rather than an all-inclusive stack.                                                                 | **Adopt** the modularity principle: add vendors and services when a product needs them.                                                      |
| [Ixartz Next.js Boilerplate](https://github.com/ixartz/Next-js-Boilerplate)                 | A broad inventory: testing, Storybook, i18n, authentication, database, monitoring, rate limiting and delivery tooling.             | **Use as a checklist**, not an architecture: it is Next.js- and vendor-specific (for example Clerk, Neon, Sentry, Arcjet).                   |
| [TanStack Router / Start](https://github.com/TanStack/router)                               | Maintained official Start packages and the `start-basic` example, with typed routes, Vite integration and a Node deployment shape. | **Adopt** the official Start route/build model, while pinning exact tested versions and documenting the Nitro beta risk.                     |

The requested name **“Celoon”** could not be confidently matched to a public repository during this research. A source URL or corrected spelling is required; this document does not guess a replacement.

## TanStack and SSR evidence

The official [TanStack Start build-from-scratch guide](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch) places `tanstackStart()` before the React Vite plugin. The official [start-basic example](https://github.com/TanStack/router/tree/main/examples/react/start-basic) and [hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) show the portable Node shape:

```text
build: vite build
start: node .output/server/index.mjs
```

The hosting guide describes the Nitro/Vite integration as under active development. This project therefore uses the explicitly approved `nitro@3.0.260903-beta`, pins it through the lockfile, and does not describe that choice as stable or provider-certified.

The [TanStack Query advanced SSR guide](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr) requires a new `QueryClient` per server request, a reused browser client, dehydration/hydration, and a nonzero SSR `staleTime` where applicable. A process-global server query cache can cross user boundaries; any future server data feature must test request isolation.

## Compatibility position

The table records compatibility evidence retrieved on the access date. “Current” is research context, not a request to float versions.

| Package / decision  | Selected or observed version | Compatibility / consequence                                                                                     |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Node / pnpm         | `24.13.1` / `11.7.0`         | Explicit project runtime and package manager; CI installs pnpm before setup-node’s pnpm cache.                  |
| React / React DOM   | `19.2.8` / `19.2.8`          | Keep identical; React DOM peers on React `^19.2.8`.                                                             |
| TanStack Start      | observed `1.168.49`          | Requires Node `>=22.12`, React 18 or 19, and Vite `>=7`.                                                        |
| TanStack Router     | observed `1.170.32`          | Requires Node `>=20.19`, React 18 or 19.                                                                        |
| TanStack Query      | observed `5.102.8`           | Supports React 18 or 19.                                                                                        |
| Vite / React plugin | `8.2.2` / `6.1.1`            | Vite 8 requires Node `^20.19` or `>=22.12`; plugin-react 6 peers with Vite 8.                                   |
| Nitro               | `3.0.260903-beta`            | Approved prerelease; Node `^20.19` or `>=22.12`. Hosted container verification, not an assumption, is required. |
| Vitest / coverage   | `5.0.0` / `5.0.0`            | Versions must match; Vitest 5 supports Node `^22.12`, `^24`, or newer and Vite 6–8.                             |
| TypeScript          | `6.0.3`                      | Chosen below the observed `typescript-eslint` upper peer bound.                                                 |
| typescript-eslint   | `8.69.0`                     | Declares TypeScript `>=4.8.4 <6.1.0`; TypeScript 7 was an observed peer conflict.                               |

The project tests the selected coherent set rather than independently floating related TanStack, Vite, or test packages.

## Production capability matrix

| Priority | Capability                     | Baseline in a reusable starter                                    | Product/release requirement                                                               |
| -------- | ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P0       | Reproducible setup             | Exact Node/pnpm, lockfile, documented scripts                     | Fresh clone works without manual repair.                                                  |
| P0       | Type safety and quality        | Strict TypeScript, lint and formatting                            | CI must typecheck, lint, and format-check deterministically.                              |
| P0       | Testing                        | Unit/component tests and Playwright critical-path checks          | Tests run without credentials, paid model calls, or uncontrolled APIs.                    |
| P0       | Delivery                       | Build, Node start command, health endpoint, Dockerfile            | Clean artifact/container smoke must pass in the target environment.                       |
| P0       | Documentation                  | Setup, scripts, architecture, extension points and upgrade policy | A new contributor can make a small feature without hidden setup.                          |
| P0       | SSR data safety                | Typed routes and request-scoped future QueryClient policy         | Test hydration and cross-user isolation before server data.                               |
| P1       | Configuration                  | Safe defaults and documented environment contract                 | Validate required production configuration and secrets at startup.                        |
| P1       | Security                       | Minimal health response and baseline headers                      | Deployment threat model, CSP/proxy review, input validation and safe errors.              |
| P1       | Accessibility                  | Semantic UI and automated checks                                  | Keyboard and assistive-technology review of critical product journeys.                    |
| P1       | Auth/data/operations           | None selected by default                                          | Add server-side authZ, migrations, backups, observability and ownership with the product. |
| P2       | Product extensions             | i18n, flags, uploads, jobs, email, billing                        | Add only for an actual feature, with provider contract and failure tests.                 |
| P2       | Performance/release operations | No claimed budgets or CDN policy                                  | Define budgets, previews, rollback, monitoring and incident process.                      |

## Sources

- [thoughtbot Suspenders README](https://raw.githubusercontent.com/thoughtbot/suspenders/main/README.md) and [features](https://raw.githubusercontent.com/thoughtbot/suspenders/main/FEATURES.md)
- [Rootstrap Node base README](https://raw.githubusercontent.com/rootstrap/node-ts-api-base/master/README.md)
- [Vinta Django React boilerplate README](https://raw.githubusercontent.com/vintasoftware/django-react-boilerplate/main/README.md)
- [BigBinary Wheel README](https://raw.githubusercontent.com/bigbinary/wheel/main/README.md)
- [Infinite Red Ignite README](https://raw.githubusercontent.com/infinitered/ignite/master/README.md)
- [T3 create-t3-app README](https://raw.githubusercontent.com/t3-oss/create-t3-app/main/README.md)
- [Ixartz Next.js Boilerplate README](https://raw.githubusercontent.com/ixartz/Next-js-Boilerplate/main/README.md)
- [TanStack Router repository and Start example](https://github.com/TanStack/router/tree/main/examples/react/start-basic)
- [TanStack Start build guide](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch), [hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting), and [Query SSR guide](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
