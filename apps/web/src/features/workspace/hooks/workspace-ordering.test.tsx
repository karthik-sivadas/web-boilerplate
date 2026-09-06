import { useLayoutEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SessionActions } from "../../auth/session-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const old = {
  revision: 1,
  projects: [
    {
      id: "project",
      name: "Imported project",
      description: "",
      archived: false,
    },
  ],
  tasks: [],
};
const committed = { revision: 2, projects: [], tasks: [] };
afterEach(() => vi.unstubAllGlobals());
async function mount() {
  let actions!: ReturnType<typeof useWorkspace>;
  function Consumer() {
    const state = useWorkspace();
    useLayoutEffect(() => {
      actions = state;
    }, [state]);
    return (
      <output>
        {state.workspace.revision}:{state.workspace.projects.length}
      </output>
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionActions.Provider
        value={{
          identity: {
            sessionId: "session",
            user: { id: "user", name: "User", email: "user@example.test" },
          },
          epoch: 1,
          canAct: () => true,
          reconcile: async () => {},
          signOut: async () => {},
        }}
      >
        <WorkspaceProvider userId="user">
          <Consumer />
        </WorkspaceProvider>
      </SessionActions.Provider>
    </QueryClientProvider>,
  );
  await screen.findByText("1:1");
  return {
    get actions() {
      return actions;
    },
    client,
  };
}
it("a reload dispatched during rollback cannot regress its committed same-session snapshot", async () => {
  const write = deferred<Response>(),
    read = deferred<Response>();
  let reads = 0;
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) =>
    options.method === "POST"
      ? write.promise
      : ++reads === 1
        ? Promise.resolve(Response.json(old))
        : read.promise,
  );
  const view = await mount();
  let mutation!: Promise<boolean>, reload!: Promise<void>;
  act(() => {
    mutation = view.actions.rollback("a".repeat(64));
    reload = view.actions.reload();
  });
  await act(async () => {
    write.resolve(Response.json(committed));
    await mutation;
  });
  await act(async () => {
    read.resolve(Response.json(old));
    await reload;
  });
  await waitFor(() => expect(screen.getByText("2:0")).toBeVisible());
  expect(view.client.getQueryData(["workspace", "user", "session", 1])).toEqual(
    committed,
  );
  expect(reads).toBe(1);
});
it("even a later stale read cannot lower an already accepted revision", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) =>
    Promise.resolve(
      Response.json(options.method === "POST" ? committed : (++reads, old)),
    ),
  );
  const view = await mount();
  await act(async () => {
    await view.actions.rollback("a".repeat(64));
  });
  await act(async () => {
    await view.actions.reload();
  });
  expect(reads).toBe(2);
  expect(screen.getByText("2:0")).toBeVisible();
});
