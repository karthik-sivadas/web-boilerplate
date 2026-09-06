import { createFileRoute } from "@tanstack/react-router";
import { authHandler } from "@/lib/auth/server";

// Better Auth is configured with an explicitly empty supported IP-header list.
// Therefore X-Forwarded-For and other browser-controlled headers cannot alter
// its database-backed rate-limit key; requests use one conservative bucket.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authHandler(request),
      POST: ({ request }) => authHandler(request),
    },
  },
});
