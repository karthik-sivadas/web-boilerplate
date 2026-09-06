import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../../apps/web/src") },
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    fs: { allow: [path.resolve(import.meta.dirname, "../..")] },
  },
});
