# Architecture

TanStack Start file routes SSR-render a deterministic loading shell. A new router is created by `getRouter`; the root creates a QueryClient for that render rather than a module-global client. `WorkspaceProvider` only touches `window.localStorage` in an effect, after hydration.

`domain.ts` owns Zod schemas and immutable transitions. `persistence.ts` owns a version-1 `{version, workspace}` envelope and validates every read. Invalid JSON, unknown versions, or invalid references show recovery; unavailable writes switch visibly to memory mode.

Vite builds Start client/server bundles. The approved `nitro@3.0.260903-beta` Node preset wraps Start's Fetch handler with H3 and copies client assets into `.output/public`; this is an actual Node server artifact, not Vite preview. Nitro 3 is intentionally a pinned beta, so target-container smoke testing is required before release claims.
