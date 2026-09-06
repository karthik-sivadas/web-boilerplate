import "@tanstack/react-start/server-only";
import { sessionSchema } from "@workspace/contracts/v1";
import { proxyApi } from "../../server/api-transport";
import type { SessionIdentity } from "../../features/auth/identity";

/** Request-scoped cookie only, sent to one configured backend. No auth/DB runtime here. */
export async function readSessionIdentity(
  headers: Headers,
  signal?: AbortSignal,
): Promise<SessionIdentity | null> {
  const response = await proxyApi(
    new Request("http://web.internal/api/v1/session", {
      headers: { cookie: headers.get("cookie") ?? "" },
      signal: signal ?? null,
    }),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Authentication service unavailable.");
  return sessionSchema.parse(await response.json());
}
