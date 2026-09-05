import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultErrorComponent: ({ error }) => <p role="alert">{error.message}</p>,
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
