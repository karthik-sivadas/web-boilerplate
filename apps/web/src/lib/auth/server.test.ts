// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  stat,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.NODE_ENV = "production";
  process.env.TEST = "false";
});
import {
  authHandler,
  closeAuth,
  initializeAuth,
  readSessionIdentity,
} from "./server";

let directory: string;
let origin: string;
let password: string;
let email: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "real-auth-test-"));
  origin = "http://127.0.0.1:3987";
  password = randomBytes(24).toString("base64url");
  email = `${randomUUID()}@example.test`;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("hex"));
  vi.stubEnv("AUTH_DATABASE_PATH", join(directory, "auth.sqlite"));
});
afterEach(async () => {
  await closeAuth();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
async function request(
  path: string,
  body?: object,
  cookie = "",
  headers: Record<string, string> = {},
) {
  return authHandler(
    new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function signup() {
  const r = await request("/sign-up/email", {
    name: "Test User",
    email,
    password,
  });
  expect(r.status).toBe(200);
  return cookieOf(r);
}
it("real signup hashes passwords, validates signin, and emits minimal read-only identity", async () => {
  const cookie = await signup();
  const { database } = await initializeAuth();
  const row = database
    .prepare('SELECT password FROM account WHERE "providerId" = ?')
    .get("credential");
  expect(row?.password).toBeTypeOf("string");
  expect(row?.password).not.toContain(password);
  expect(
    (
      await request("/sign-in/email", {
        email,
        password: randomBytes(20).toString("hex"),
      })
    ).status,
  ).toBe(401);
  expect((await request("/sign-in/email", { email, password })).status).toBe(
    200,
  );
  const identity = await readSessionIdentity(new Headers({ cookie }));
  expect(Object.keys(identity!).sort()).toEqual(["sessionId", "user"]);
  expect(Object.keys(identity!.user).sort()).toEqual(["email", "id", "name"]);
  expect(JSON.stringify(identity)).not.toContain("token");
});
it("real logout revokes the old cookie and database-expired sessions are rejected", async () => {
  const cookie = await signup();
  expect(await readSessionIdentity(new Headers({ cookie }))).not.toBeNull();
  expect((await request("/sign-out", {}, cookie)).status).toBe(200);
  expect(await readSessionIdentity(new Headers({ cookie }))).toBeNull();
  expect(
    await (await request("/get-session", undefined, cookie)).json(),
  ).toBeNull();
  const signin = await request("/sign-in/email", { email, password });
  const fresh = cookieOf(signin);
  (await initializeAuth()).database
    .prepare('UPDATE session SET "expiresAt" = ?')
    .run(Date.now() - 1000);
  expect(await readSessionIdentity(new Headers({ cookie: fresh }))).toBeNull();
});
it("rejects hostile Origin and cross-site CSRF without creating an account", async () => {
  const body = { name: "Hostile", email, password };
  expect(
    (
      await request("/sign-up/email", body, "", {
        Origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
  const r = await authHandler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify(body),
    }),
  );
  expect(r.status).toBe(403);
  expect(
    (await initializeAuth()).database
      .prepare("SELECT count(*) AS count FROM user")
      .get()?.count,
  ).toBe(0);
});
it("enforces real database 429 limits despite rotating forged forwarding headers", async () => {
  for (let index = 0; index < 3; index++)
    expect(
      (
        await request("/sign-in/email", { email, password }, "", {
          "X-Forwarded-For": `203.0.113.${index + 1}`,
          "X-Real-IP": `192.0.2.${index + 1}`,
        })
      ).status,
    ).toBe(401);
  const denied = await request("/sign-in/email", { email, password }, "", {
    "X-Forwarded-For": "198.51.100.99",
  });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("x-retry-after"))).toBeGreaterThan(0);
  const runtime = await initializeAuth();
  expect(
    runtime.database.prepare('SELECT count(*) AS count FROM "rateLimit"').get()
      ?.count,
  ).toBeGreaterThan(0);
});
it.each(["http://127.0.0.1:3987", "https://workbench.example.test"])(
  "sets usable HttpOnly cookie protocol flags for %s",
  async (url) => {
    origin = url;
    vi.stubEnv("BETTER_AUTH_URL", url);
    const r = await request("/sign-up/email", {
      name: "Cookie User",
      email,
      password,
    });
    expect(r.status).toBe(200);
    const cookies = r.headers.getSetCookie().join(";");
    expect(cookies).toMatch(/httponly/i);
    expect(cookies).toMatch(/samesite=lax/i);
    expect(/; secure/i.test(cookies)).toBe(url.startsWith("https:"));
    expect(
      await readSessionIdentity(new Headers({ cookie: cookieOf(r) })),
    ).not.toBeNull();
  },
);
it("read-only guards preserve expiry while HTTP get-session rolls expiry and emits Set-Cookie", async () => {
  const cookie = await signup();
  const { database } = await initializeAuth();
  const expires = Date.now() + 5 * 86_400_000;
  database
    .prepare('UPDATE session SET "expiresAt" = ?, "updatedAt" = ?')
    .run(expires, Date.now() - 2 * 86_400_000);
  expect(await readSessionIdentity(new Headers({ cookie }))).not.toBeNull();
  expect(
    database.prepare('SELECT "expiresAt" FROM session').get()?.expiresAt,
  ).toBe(expires);
  const response = await request("/get-session", undefined, cookie);
  expect(response.status).toBe(200);
  expect(
    response.headers.getSetCookie().some((c) => c.includes("session_token")),
  ).toBe(true);
  expect(
    new Date(
      String(
        database.prepare('SELECT "expiresAt" FROM session').get()?.expiresAt,
      ),
    ).getTime(),
  ).toBeGreaterThan(expires);
});
it("repeated startup migrations retain existing account and session", async () => {
  const cookie = await signup();
  const before = await readSessionIdentity(new Headers({ cookie }));
  await closeAuth();
  await initializeAuth();
  expect(await readSessionIdentity(new Headers({ cookie }))).toEqual(before);
  expect(
    (await initializeAuth()).database
      .prepare("SELECT count(*) AS count FROM user")
      .get()?.count,
  ).toBe(1);
});
it.each([
  ["BETTER_AUTH_SECRET", ""],
  ["BETTER_AUTH_SECRET", "short"],
  ["BETTER_AUTH_SECRET", `replace-${"x".repeat(80)}`],
  ["BETTER_AUTH_SECRET", `your-secret-${"x".repeat(80)}`],
  ["BETTER_AUTH_URL", ""],
  ["BETTER_AUTH_URL", "not-a-url"],
  ["BETTER_AUTH_URL", "http://public.example"],
  ["BETTER_AUTH_URL", "https://example.test/path"],
  ["BETTER_AUTH_URL", "https://example.test?query=x"],
  ["BETTER_AUTH_URL", "https://user:pass@example.test"],
  ["AUTH_DATABASE_PATH", ""],
  ["AUTH_DATABASE_PATH", "relative.sqlite"],
])(
  "rejects invalid production %s configuration (%s) before database access",
  async (key, value) => {
    vi.stubEnv(key, value);
    await expect(initializeAuth()).rejects.toThrow();
    await expect(stat(join(directory, "auth.sqlite"))).rejects.toThrow();
  },
);
it("clean development fixture boot reuses only the fake workspace secret/database", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PORT", "3000");
  await writeFile(join(directory, "pnpm-workspace.yaml"), "packages: []\n");
  const app = join(directory, "apps/web");
  await mkdir(app, { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(app);
  await initializeAuth();
  const secretFile = join(directory, ".data/better-auth-secret");
  const before = await readFile(secretFile);
  expect((await stat(secretFile)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, ".data"))).mode & 0o777).toBe(0o700);
  await closeAuth();
  await initializeAuth();
  expect(await readFile(secretFile)).toEqual(before);
  await expect(stat(join(app, ".data"))).rejects.toThrow();
});
