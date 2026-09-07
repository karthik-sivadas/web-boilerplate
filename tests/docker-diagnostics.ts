import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Page } from "playwright";

// Never persist bodies, query strings, headers, URLs, console text or stacks.
// Unknown paths/errors collapse to fixed labels rather than attempted redaction.
const paths = new Set([
  "/",
  "/sign-up",
  "/sign-in",
  "/projects",
  "/health/live",
  "/health/ready",
  "/api/auth/sign-up/email",
  "/api/auth/sign-in/email",
  "/api/auth/get-session",
  "/api/auth/sign-out",
  "/api/v1/session",
  "/api/v1/projects",
  "/api/v1/workspace",
]);
function safePath(url: string) {
  const path = new URL(url).pathname;
  return paths.has(path)
    ? path
    : path.startsWith("/assets/")
      ? "/assets/[asset]"
      : "[other]";
}
export function dockerDiagnostics() {
  const events: object[] = [];
  const record = (event: object) => {
    if (events.length === 200) events.shift();
    events.push(event);
  };
  return {
    record,
    attach(page: Page) {
      page.on("response", (response) =>
        record({
          kind: "response",
          method: response.request().method(),
          path: safePath(response.url()),
          status: response.status(),
        }),
      );
      page.on("requestfailed", (request) =>
        record({
          kind: "requestfailed",
          path: safePath(request.url()),
          error:
            [
              "net::ERR_ABORTED",
              "net::ERR_CONNECTION_REFUSED",
              "net::ERR_CONNECTION_RESET",
            ].find((code) => code === request.failure()?.errorText) ??
            "[other network error]",
        }),
      );
      page.on("pageerror", (error) =>
        record({
          kind: "pageerror",
          error: [
            "TypeError",
            "ReferenceError",
            "SyntaxError",
            "Error",
          ].includes(error.name)
            ? error.name
            : "[other error]",
        }),
      );
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          record({ kind: "console", level: message.type() });
      });
    },
    async save() {
      const text = JSON.stringify({ version: 1, events }, null, 2);
      // Print before any cleanup, even if artifact writing fails.
      console.error(
        `Owned Docker failure diagnostics (last 200 events):\n${text}`,
      );
      const file = "test-results/docker-smoke/diagnostics.json";
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text + "\n");
    },
  };
}
