// @vitest-environment node
import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { proxyApi } from "../../server/api-transport";
import { readSessionIdentity } from "./server";
let server: ReturnType<typeof createServer>;
let origin: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/api/v1/session") {
        response.setHeader("Content-Type", "application/json");
        if (request.headers.cookie === "valid")
          response.end(
            JSON.stringify({
              sessionId: "session",
              user: { id: "user", name: "User", email: "user@example.test" },
            }),
          );
        else {
          response.statusCode = request.headers.cookie === "outage" ? 503 : 401;
          response.end("{}");
        }
        return;
      }
      response.setHeader("Set-Cookie", [
        "first=1; Path=/; HttpOnly",
        "second=2; Path=/; HttpOnly",
      ]);
      if (request.url === "/api/redirect") {
        response.statusCode = 302;
        response.setHeader("Location", "https://untrusted.example.test/");
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("API_INTERNAL_URL", origin);
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  vi.unstubAllEnvs();
});
it("uses one fixed destination, preserves session preconditions/Origin/body and distinct cookies, strips spoof/hop headers", async () => {
  const response = await proxyApi(
    new Request("https://attacker.test/api/echo?query=1", {
      method: "PATCH",
      headers: {
        origin: "https://public.test",
        cookie: "synthetic-cookie",
        "X-Expected-Session-Id": "captured-session",
        "If-Match": '"4"',
        "x-user-id": "spoof",
        "x-forwarded-for": "spoof",
        connection: "x-remove",
        "x-remove": "remove",
      },
      body: '{"value":1}',
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    url: "/api/echo?query=1",
    method: "PATCH",
    body: '{"value":1}',
    headers: {
      origin: "https://public.test",
      cookie: "synthetic-cookie",
      "x-expected-session-id": "captured-session",
      "if-match": '"4"',
    },
  });
  const stripped = await proxyApi(
    new Request("https://public.test/api/echo", {
      headers: {
        "x-user-id": "spoof",
        forwarded: "spoof",
        "x-forwarded-host": "spoof",
      },
    }),
  );
  expect(await stripped.text()).not.toContain("spoof");
});
it("does not follow redirects and bounds bodies", async () => {
  const response = await proxyApi(
    new Request("https://public.test/api/redirect"),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://untrusted.example.test/",
  );
  expect(
    (
      await proxyApi(
        new Request("https://public.test/api/echo", {
          method: "POST",
          body: "x".repeat(2 * 1024 * 1024 + 1),
        }),
      )
    ).status,
  ).toBe(413);
});
it("SSR forwards only the request cookie; failures do not become anonymous", async () => {
  expect(
    await readSessionIdentity(
      new Headers({ cookie: "valid", "x-user-id": "spoof" }),
    ),
  ).toMatchObject({ sessionId: "session", user: { id: "user" } });
  expect(await readSessionIdentity(new Headers())).toBeNull();
  await expect(
    readSessionIdentity(new Headers({ cookie: "outage" })),
  ).rejects.toThrow("unavailable");
  vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:1");
  expect(
    (await proxyApi(new Request("https://public.test/api/echo"))).status,
  ).toBe(503);
  vi.stubEnv("API_INTERNAL_URL", origin);
});
