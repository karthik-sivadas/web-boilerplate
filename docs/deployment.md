# Deployment

Build with `pnpm build`; run `HOST=0.0.0.0 PORT=3000 pnpm start`. The output is Nitro's `.output/server/index.mjs`, generated after TanStack Start's Vite bundles. `GET /api/health` returns minimal no-store JSON.

Docker uses a multi-stage Node `24.13.1-bookworm-slim` build, frozen pnpm lockfile, production artifact only, and a non-root `app` user. On a Docker-capable host:

```sh
docker build -t workbench .
docker run --rm -p 3000:3000 workbench
node -e "fetch('http://127.0.0.1:3000/api/health').then(console.log)"
```

The local Docker daemon was unavailable during this delivery, so container execution is **not locally verified**. GitHub Actions builds the image, checks the Node health endpoint, and asserts the runtime UID is non-root. Terminate with SIGTERM through the container runtime; Nitro/Node receives the signal.

Put TLS, HSTS, compression policy, and any CDN in front of this service. Security headers include nosniff, deny framing, referrer and permissions policies, and a compatible (not strict) CSP. The current CSP uses `unsafe-inline` for Start hydration/styles; use nonce/hash hardening before sensitive production use.
