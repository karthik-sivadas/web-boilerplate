import type { SessionIdentity } from "./identity";

export type SessionState =
  | { status: "pending"; epoch: number; message: string }
  | { status: "guest" | "error"; epoch: number; message: string }
  | {
      status: "ready";
      epoch: number;
      identity: SessionIdentity;
      message: string;
    };
type Dependencies = {
  httpSession(signal: AbortSignal): Promise<SessionIdentity | null>;
  routeSession(signal: AbortSignal): Promise<SessionIdentity | null>;
  clearQueries(): Promise<void>;
  signOut(): Promise<void>;
  broadcast(): void;
};

/** Per-mounted boundary, never a process-global/SSR session cache. */
export function createSessionController(deps: Dependencies) {
  let state: SessionState = { status: "pending", epoch: 0, message: "" };
  let generation = 0;
  let signingOut = false;
  let abort: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SessionState) => {
    state = next;
    listeners.forEach((notify) => notify());
  };
  const invalidate = () => {
    abort?.abort();
    const epoch = ++generation;
    publish({ status: "pending", epoch, message: "" });
    return epoch;
  };
  const revalidate = async (message = "") => {
    if (signingOut) return;
    const epoch = invalidate();
    const request = new AbortController();
    abort = request;
    try {
      await deps.clearQueries();
      if (generation !== epoch) return;
      // HTTP request refreshes cookies; subsequent fresh RPC independently verifies that identity.
      const http = await deps.httpSession(request.signal);
      if (generation !== epoch) return;
      if (!http) {
        publish({ status: "guest", epoch, message });
        return;
      }
      const route = await deps.routeSession(request.signal);
      if (generation !== epoch) return;
      if (
        !route ||
        http.sessionId !== route.sessionId ||
        http.user.id !== route.user.id
      ) {
        publish({
          status: "error",
          epoch,
          message:
            "Your session changed while checking. Please check your session again.",
        });
        return;
      }
      publish({ status: "ready", epoch, identity: route, message });
    } catch {
      if (generation === epoch)
        publish({
          status: "error",
          epoch,
          message:
            message ||
            "We could not verify your session. Private workspace data is hidden. Please retry.",
        });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    revalidate,
    lease: (epoch: number) => () =>
      state.status === "ready" && generation === epoch,
    async signOut() {
      if (signingOut) return;
      signingOut = true;
      const epoch = invalidate();
      deps.broadcast();
      try {
        await deps.clearQueries();
        await deps.signOut();
        signingOut = false;
        deps.broadcast();
        if (generation === epoch) await revalidate();
      } catch {
        signingOut = false;
        deps.broadcast();
        if (generation === epoch)
          await revalidate(
            "Sign out could not be confirmed. We checked the current session; please try again if still signed in.",
          );
      }
    },
    dispose() {
      invalidate();
      listeners.clear();
    },
  };
}
