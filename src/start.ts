import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

const securityHeaders = createMiddleware().server(async ({ next }) => {
  const response = await next();
  setResponseHeader("X-Content-Type-Options", "nosniff");
  setResponseHeader("X-Frame-Options", "DENY");
  setResponseHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  setResponseHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  setResponseHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );
  return response;
});
export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}));
