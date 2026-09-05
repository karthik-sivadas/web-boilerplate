import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import "../styles/global.css";
import {
  NotFound,
  RouteError,
  WorkspaceProvider,
  WorkspaceShell,
} from "../features/workspace/workspace";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Workbench — local-first workspace" },
      {
        name: "description",
        content: "A polished local-first workspace foundation.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError error={error} />,
  notFoundComponent: NotFound,
  component: Root,
});
function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </QueryClientProvider>
  );
}
function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Providers>
          <WorkspaceShell>
            <Outlet />
          </WorkspaceShell>
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
