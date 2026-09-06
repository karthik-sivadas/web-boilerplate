import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/workspace/workspace";
import { getProtectedProfile } from "@/features/auth/server-functions";
export const Route = createFileRoute("/_authenticated/settings")({
  loader: () => getProtectedProfile(),
  component: SettingsPage,
});
