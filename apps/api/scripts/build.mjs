import { build } from "esbuild";
import { cp, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Resolve ownership from this script, never from an arbitrary caller's cwd.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist");
const staging = await mkdtemp(join(root, ".api-build-"));
try {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/main.ts", "src/migrate.ts", "src/import-auth.ts"],
    outdir: staging,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: false,
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
  await cp(join(root, "migrations"), join(staging, "migrations"), {
    recursive: true,
  });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      engines: { node: "24.13.1" },
    }),
  );
  // Publish only a complete fresh artifact; removed source migrations cannot survive.
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
} finally {
  await rm(staging, { recursive: true, force: true });
}
