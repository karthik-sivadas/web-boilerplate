import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPage } from "@/features/auth/auth-page";
import { getCurrentUser } from "@/features/auth/server-functions";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (await getCurrentUser()) throw redirect({ to: "/" });
  },
  component: () => <AuthPage mode="sign-in" />,
});
