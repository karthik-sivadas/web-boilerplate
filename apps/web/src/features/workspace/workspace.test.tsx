import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SessionActions } from "../auth/session-context";
import { WorkspaceProvider, TasksPage } from "./workspace";
const identity = {
  sessionId: "test-session",
  user: { id: "test-user", name: "Test", email: "test@example.test" },
};
const state = {
  revision: 0,
  projects: [
    { id: "project", name: "Project", description: "", archived: false },
  ],
  tasks: [],
};
afterEach(() => vi.unstubAllGlobals());
function mount(strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (
    <QueryClientProvider client={client}>
      <SessionActions.Provider
        value={{
          identity,
          epoch: 1,
          canAct: () => true,
          reconcile: () => Promise.resolve(),
          signOut: () => Promise.resolve(),
        }}
      >
        <WorkspaceProvider userId="test-user">
          <TasksPage />
        </WorkspaceProvider>
      </SessionActions.Provider>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return client;
}
it("loads empty remote data without a demo or browser persistence fallback", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(Response.json({ revision: 0, projects: [], tasks: [] })),
  );
  vi.stubGlobal("fetch", fetcher);
  mount();
  expect(await screen.findByText("No tasks here yet")).toBeVisible();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(screen.queryByText("Continue in memory")).not.toBeInTheDocument();
});
it("StrictMode effect replay does not reuse an aborted request scope", async () => {
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) =>
    Promise.resolve(
      Response.json(
        options.method === "POST"
          ? {
              ...state,
              revision: 1,
              tasks: [
                {
                  id: "created",
                  projectId: "project",
                  title: "StrictMode task",
                  description: "",
                  status: "todo",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            }
          : state,
      ),
    ),
  );
  mount(true);
  await screen.findByText("No tasks here yet");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New task" }));
  await user.type(screen.getByLabelText("Task title"), "StrictMode task");
  await user.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("StrictMode task")).toBeVisible();
});
it("an API outage offers retry and never shows seeded private data", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "Service unavailable.",
            requestId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      ),
    ),
  );
  mount();
  expect(await screen.findByText("Workspace unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry workspace" })).toBeVisible();
  expect(
    screen.queryByText("Review the implementation brief"),
  ).not.toBeInTheDocument();
});
it("a failed task write retains the dialog and draft rather than closing or persisting locally", async () => {
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) =>
    Promise.resolve(
      options.method === "POST"
        ? Response.json(
            {
              error: {
                code: "REVISION_CONFLICT",
                message: "Workspace changed.",
                requestId: crypto.randomUUID(),
              },
            },
            { status: 409 },
          )
        : Response.json(state),
    ),
  );
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New task" }));
  await user.type(screen.getByLabelText("Task title"), "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Reload and review" }),
    ).toBeVisible(),
  );
  expect(screen.getByLabelText("Task title")).toHaveValue("Keep my draft");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
});
