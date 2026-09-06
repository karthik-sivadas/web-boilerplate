export function exitOnStartupFailure(reason: string): never {
  console.error(`[auth startup] ${reason}`);
  process.exit(1);
}

/** Synchronous installation; injectable dependencies are code-only test seams, not env switches. */
export function createStartupGate<T>(
  downstream: (request: T) => Response | Promise<Response>,
  initialize: () => Promise<unknown>,
  options: { timeoutMs?: number; onFailure?: (reason: string) => void } = {},
) {
  let state: "starting" | "ready" | "failed" = "starting";
  const fail = (reason: string) => {
    if (state !== "starting") return;
    state = "failed";
    clearTimeout(timer);
    (options.onFailure ?? exitOnStartupFailure)(reason);
  };
  const timer = setTimeout(
    () => fail("Initialization timed out."),
    options.timeoutMs ?? 60_000,
  );
  void Promise.resolve()
    .then(initialize)
    .then(
      () => {
        if (state !== "starting") return;
        clearTimeout(timer);
        state = "ready";
      },
      () =>
        fail(
          "Initialization failed; check auth configuration and database access.",
        ),
    );
  return {
    fetch(request: T) {
      if (state !== "ready")
        return new Response("Service unavailable", {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "1",
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      return downstream(request);
    },
    dispose() {
      clearTimeout(timer);
      state = "failed";
    },
  };
}
