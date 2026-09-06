import { randomUUID } from "node:crypto";
const maxBytes = 2 * 1024 * 1024;
const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);
export function apiOrigin(value = process.env.API_INTERNAL_URL): string {
  if (!value) throw new Error("API_INTERNAL_URL is required.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid API_INTERNAL_URL.");
  return url.origin;
}
function transportHeaders(source: Headers, request: boolean) {
  const headers = new Headers(source);
  const forbidden = new Set([
    ...hop,
    ...(source.get("connection") ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase()),
  ]);
  for (const key of [...headers.keys()])
    if (
      forbidden.has(key) ||
      (request &&
        (key === "forwarded" ||
          key === "x-user-id" ||
          key === "x-real-ip" ||
          key.startsWith("x-forwarded-"))) ||
      (!request && key === "content-encoding")
    )
      headers.delete(key);
  return headers;
}
export async function boundedBody(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RangeError("Body too large.");
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function unavailable(status = 503) {
  return Response.json(
    {
      error: {
        code: status === 413 ? "BODY_TOO_LARGE" : "UNAVAILABLE",
        message:
          status === 413 ? "Request body too large." : "Service unavailable.",
        requestId: randomUUID(),
      },
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function proxyApi(request: Request): Promise<Response> {
  try {
    const source = new URL(request.url);
    if (
      !source.pathname.startsWith("/api/") &&
      source.pathname !== "/health/ready"
    )
      return unavailable();
    const destination = new URL(apiOrigin());
    destination.pathname = source.pathname;
    destination.search = source.search;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(15000),
    ]);
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await boundedBody(request.body, signal);
    const response = await fetch(destination, {
      method: request.method,
      headers: transportHeaders(request.headers, true),
      ...(body === undefined ? {} : { body: body as BodyInit }),
      signal,
      redirect: "manual",
      cache: "no-store",
    });
    const headers = transportHeaders(response.headers, false);
    headers.delete("set-cookie");
    for (const cookie of response.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    headers.set("Cache-Control", "private, no-store");
    const result = await boundedBody(response.body, signal);
    return new Response(
      request.method === "HEAD" || [204, 205, 304].includes(response.status)
        ? null
        : (result as BodyInit),
      { status: response.status, headers },
    );
  } catch (error) {
    return unavailable(error instanceof RangeError ? 413 : 503);
  }
}
