// @vitest-environment node
import { expect, it } from "vitest";
import { privateResponse } from "./response-policy";
it("adds private no-store to redirects/query-suffixed routes without losing distinct cookies", async () => {
  const headers = new Headers({ Location: "/sign-in" });
  headers.append("Set-Cookie", "one=value; HttpOnly; SameSite=Lax");
  headers.append("Set-Cookie", "two=value; HttpOnly; SameSite=Lax");
  const response = privateResponse(
    new Request("http://localhost/projects?probe=/health/live"),
    new Response(null, { status: 307, headers }),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("Location")).toBe("/sign-in");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(await response.text()).toBe("");
});
it("preserves exact health endpoint no-store and response stream", async () => {
  const original = new Response("ok", {
    headers: { "Cache-Control": "no-store" },
  });
  const response = privateResponse(
    new Request("http://localhost/health/live?probe=x"),
    original,
  );
  expect(response).toBe(original);
  expect(await response.text()).toBe("ok");
});
