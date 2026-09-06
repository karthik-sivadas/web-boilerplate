import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { authClient } from "./client";
import { getSessionIdentity } from "./server-functions";
import {
  createSessionController,
  type SessionState,
} from "./session-controller";
import type { SessionIdentity } from "./identity";

import {
  SessionActions,
  notifySessionChange,
  sessionChannelName,
  sessionSender,
} from "./session-context";
const serverSnapshot: SessionState = {
  status: "pending",
  epoch: 0,
  message: "",
};

export function SessionBoundary({
  children,
}: {
  children(identity: SessionIdentity): ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [controller] = useState(() =>
    createSessionController({
      async httpSession(signal) {
        const result = await authClient.getSession({
          fetchOptions: {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            cache: "no-store",
          },
        });
        if (result.error) throw new Error("Session request failed");
        return result.data
          ? {
              sessionId: result.data.session.id,
              user: {
                id: result.data.user.id,
                name: result.data.user.name,
                email: result.data.user.email,
              },
            }
          : null;
      },
      routeSession: (signal) =>
        getSessionIdentity({
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        }),
      async clearQueries() {
        const cancelled = queryClient.cancelQueries();
        queryClient.clear();
        await cancelled;
      },
      async signOut() {
        const result = await authClient.signOut({
          fetchOptions: { signal: AbortSignal.timeout(15_000) },
        });
        if (result.error) throw new Error("Sign out not confirmed");
      },
      broadcast: notifySessionChange,
    }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => serverSnapshot,
  );
  useEffect(() => {
    const revalidate = () => {
      void controller.revalidate();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    revalidate();
    window.addEventListener("focus", revalidate);
    window.addEventListener("storage", revalidate);
    document.addEventListener("visibilitychange", visibility);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(sessionChannelName)
        : null;
    channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        "source" in data &&
        data.source !== sessionSender()
      )
        revalidate();
    });
    const timer = setInterval(visibility, 60_000);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("storage", revalidate);
      document.removeEventListener("visibilitychange", visibility);
      channel?.close();
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (state.status === "guest")
      void router.navigate({ to: "/sign-in", replace: true });
  }, [state.status, router]);
  if (state.status !== "ready")
    return (
      <main className="p-8" aria-busy={state.status === "pending"}>
        <h1>
          {state.status === "pending"
            ? "Checking your session…"
            : "Workspace locked"}
        </h1>
        {state.message ? <p role="alert">{state.message}</p> : null}
        {state.status !== "pending" ? (
          <>
            <Button onPress={() => void controller.revalidate()}>
              Check session again
            </Button>{" "}
            <Link to="/sign-in">Sign in</Link>
          </>
        ) : null}
      </main>
    );
  return (
    <SessionActions.Provider
      key={`${state.identity.sessionId}:${state.epoch}`}
      value={{
        canAct: controller.lease(state.epoch),
        signOut: controller.signOut,
      }}
    >
      {state.message ? <p role="alert">{state.message}</p> : null}
      {children(state.identity)}
    </SessionActions.Provider>
  );
}
