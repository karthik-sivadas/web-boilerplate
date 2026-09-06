import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  AppLocaleProvider,
  useAppLocale,
} from "../../apps/web/src/components/app-locale";
import {
  SettingsPage,
  TasksPage,
  WorkspaceProvider,
  WorkspaceShell,
} from "../../apps/web/src/features/workspace/workspace";
import "@workspace/ui/globals.css";
import "../../apps/web/src/styles/global.css";

// Separate Vite test entry: never included in Start's production route tree.
const client = new QueryClient();
function Layout() {
  const { lang, dir } = useAppLocale();
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  return (
    <WorkspaceProvider userId="rtl-fixture">
      <WorkspaceShell
        user={{
          id: "rtl-fixture",
          name: "RTL fixture",
          email: "rtl@example.test",
        }}
      >
        <Outlet />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
const root = createRootRoute({ component: Layout });
const tasks = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: TasksPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: SettingsPage,
});
const router = createRouter({ routeTree: root.addChildren([tasks, settings]) });
createRoot(document.getElementById("root")!).render(
  <AppLocaleProvider direction="rtl">
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </AppLocaleProvider>,
);
