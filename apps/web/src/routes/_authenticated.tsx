import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  WorkspaceProvider,
  WorkspaceShell,
} from "@/features/workspace/workspace";
import { getCurrentUser } from "@/features/auth/server-functions";
import { SessionBoundary } from "@/features/auth/session-boundary";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    // TanStack Router redirects are intentional non-Error control flow.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!user) throw redirect({ to: "/sign-in" });
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <SessionBoundary>
      {({ user, sessionId }) => (
        <WorkspaceProvider key={sessionId} userId={user.id}>
          <WorkspaceShell user={user}>
            <Outlet />
          </WorkspaceShell>
        </WorkspaceProvider>
      )}
    </SessionBoundary>
  );
}
