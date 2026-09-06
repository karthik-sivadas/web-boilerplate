import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // Aria's bundled CJS external-store shim retains a runtime require("react").
    // Trace that exact installed dependency into the source-free Node artifact.
    nitro({ plugins: ["src/server/plugins/auth.ts"], traceDeps: ["react"] }),
    viteReact(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { host: "localhost", port: 3000, strictPort: true },
});
