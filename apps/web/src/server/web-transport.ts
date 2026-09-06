import { privateResponse } from "./response-policy";
import { proxyApi, unavailable } from "./api-transport";
/** One dependency lifetime for readiness, Start loaders/RPC identity and proxy IO.
 * The bounded Request reaches Start's getRequest(), including the original disconnect.
 * Native timeout/any signals also remain effective for work in a streamed response.
 */
export async function webTransport(
  request: Request,
  downstream: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/health/live")
    return Response.json(
      { status: "ok" },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  let aborted!: () => void;
  const expiration = new Promise<Response>((resolve) => {
    aborted = () => resolve(unavailable());
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
  const run = async () => {
    signal.throwIfAborted();
    // srvx's incoming Request is Fetch-compatible but not Undici-branded.
    const bounded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
      ...(!["GET", "HEAD"].includes(request.method)
        ? { body: request.body, duplex: "half" }
        : {}),
    });
    if (path === "/health/ready" || path.startsWith("/api/"))
      return proxyApi(bounded);
    const readiness = await proxyApi(
      new Request(new URL("/health/ready", bounded.url), { signal }),
    );
    signal.throwIfAborted();
    if (readiness.status !== 200) return readiness;
    const response = await downstream(bounded);
    signal.throwIfAborted();
    return privateResponse(bounded, response);
  };
  try {
    return await Promise.race([expiration, run()]);
  } catch {
    return unavailable();
  } finally {
    signal.removeEventListener("abort", aborted);
  }
}
