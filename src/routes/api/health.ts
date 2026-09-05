import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ status: "ok" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "permissions-policy": "camera=(), microphone=(), geolocation=()",
          },
        }),
    },
  },
});
