import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useQuery,
  useQueryClient,
  replaceEqualDeep,
} from "@tanstack/react-query";
import {
  workspaceSchema,
  exportSchema,
  importResultSchema,
  type ExportDto,
  type ImportResultDto,
  type WorkspaceDto,
  type ProjectInput,
  type Project,
  type TaskInput,
  type Task,
} from "@workspace/contracts/v1";
import { Button } from "@workspace/ui/components/button";
import { useSessionActions } from "../../auth/session-context";
import { workspaceRequest, type ActionLease } from "../api/client";
import styles from "../workspace.module.css";
import { useRequestScope } from "./request-scope";
interface WorkspaceActions {
  workspace: WorkspaceDto;
  busy: boolean;
  error: string;
  needsReload: boolean;
  reload(): Promise<void>;
  project(input: ProjectInput, existing?: Project): Promise<boolean>;
  task(input: TaskInput, existing?: Task): Promise<boolean>;
  deleteTask(id: string): Promise<boolean>;
  deleteProject(id: string, confirm: string): Promise<boolean>;
  export(): Promise<ExportDto>;
  import(data: ExportDto): Promise<ImportResultDto | null>;
  rollback(fingerprint: string): Promise<boolean>;
}
const Context = createContext<WorkspaceActions | null>(null);
export function useWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error("Workspace provider required.");
  return state;
}
export function WorkspaceProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const session = useSessionActions();
  if (!session || session.identity.user.id !== userId)
    throw new Error("Verified session required.");
  return (
    <RemoteWorkspace
      key={`${session.identity.sessionId}:${session.epoch}`}
      userId={userId}
      sessionId={session.identity.sessionId}
      epoch={session.epoch}
      lease={{
        sessionId: session.identity.sessionId,
        canAct: session.canAct,
        reconcile: session.reconcile,
      }}
    >
      {children}
    </RemoteWorkspace>
  );
}
function RemoteWorkspace({
  children,
  userId,
  sessionId,
  epoch,
  lease,
}: {
  children: ReactNode;
  userId: string;
  sessionId: string;
  epoch: number;
  lease: ActionLease;
}) {
  const client = useQueryClient();
  const key = ["workspace", userId, sessionId, epoch] as const;
  const scope = useRequestScope();
  const capturedLease = {
    ...lease,
    canAct: () => scope.isActive() && lease.canAct(),
  };
  // The key contains all serializable identity: lease callbacks are guards, not cache input.
  const query = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: key,
    queryFn: ({ signal }) =>
      workspaceRequest(capturedLease, "workspace", workspaceSchema, { signal }),
    // Every cache write here is a validated WorkspaceDto. Query completion must
    // not replace a newer mutation snapshot, even within the same session epoch.
    structuralSharing: (previous, next) => {
      const prior = previous as WorkspaceDto | undefined;
      const incoming = next as WorkspaceDto;
      return prior && prior.revision > incoming.revision
        ? prior
        : replaceEqualDeep(previous, next);
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const reload = async () => {
    // Synchronous exclusion also covers multiple actions in one React event.
    if (lock.current || !capturedLease.canAct()) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await query.refetch();
      if (capturedLease.canAct() && !result.error) {
        setError("");
        setNeedsReload(false);
      }
    } finally {
      lock.current = false;
      if (scope.isActive()) setBusy(false);
    }
  };
  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    importing = false,
  ): Promise<WorkspaceDto | ImportResultDto | null> {
    if (lock.current || needsReload || !capturedLease.canAct()) return null;
    lock.current = true;
    setBusy(true);
    const request = scope.start();
    try {
      await client.cancelQueries({ queryKey: key });
      const current = client.getQueryData<WorkspaceDto>(key);
      if (!current) throw new Error("Reload your workspace first.");
      const options = {
        method,
        body:
          method === "DELETE"
            ? body
            : { ...(body as object), expectedRevision: current.revision },
        revision: current.revision,
        signal: request.signal,
      };
      const result = importing
        ? await workspaceRequest(
            capturedLease,
            path,
            importResultSchema,
            options,
          )
        : await workspaceRequest(capturedLease, path, workspaceSchema, options);
      if (!capturedLease.canAct() || request.signal.aborted) return null;
      client.setQueryData(
        key,
        "workspace" in result ? result.workspace : result,
      );
      setError("");
      return result;
    } catch (cause) {
      if (capturedLease.canAct() && !request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Request failed.");
        setNeedsReload(true);
      }
      return null;
    } finally {
      scope.finish(request);
      lock.current = false;
      if (scope.isActive()) setBusy(false);
    }
  }
  if (!query.data)
    return (
      <main className={styles.loading}>
        <h1>
          {query.isPending
            ? "Loading your workspace…"
            : "Workspace unavailable"}
        </h1>
        {query.error ? (
          <>
            <p role="alert">{query.error.message}</p>
            <Button onPress={() => void reload()}>Retry workspace</Button>
          </>
        ) : null}
      </main>
    );
  return (
    <Context.Provider
      value={{
        workspace: query.data,
        busy,
        error,
        needsReload,
        reload,
        project: async (input, existing) =>
          Boolean(
            await mutate(
              existing
                ? `projects/${encodeURIComponent(existing.id)}`
                : "projects",
              existing ? "PATCH" : "POST",
              existing ? { ...input, archived: existing.archived } : input,
            ),
          ),
        task: async (input, existing) =>
          Boolean(
            await mutate(
              existing ? `tasks/${encodeURIComponent(existing.id)}` : "tasks",
              existing ? "PATCH" : "POST",
              input,
            ),
          ),
        deleteTask: async (id) =>
          Boolean(await mutate(`tasks/${encodeURIComponent(id)}`, "DELETE")),
        deleteProject: async (id, confirm) =>
          Boolean(
            await mutate(`projects/${encodeURIComponent(id)}`, "DELETE", {
              confirm,
            }),
          ),
        export: async () => {
          const request = scope.start();
          try {
            return await workspaceRequest(
              capturedLease,
              "workspace/export",
              exportSchema,
              { signal: request.signal },
            );
          } finally {
            scope.finish(request);
          }
        },
        import: async (data) => {
          const result = await mutate(
            "workspace/import",
            "POST",
            { data },
            true,
          );
          return result && "workspace" in result ? result : null;
        },
        rollback: async (fingerprint) =>
          Boolean(await mutate("workspace/rollback", "POST", { fingerprint })),
      }}
    >
      {error ? (
        <section className={styles.notice} role="alert">
          <p>
            {error} No success is assumed. Your draft remains open. Reload and
            review before deliberately retrying.
          </p>
          <Button onPress={() => void reload()} isDisabled={busy}>
            Reload workspace
          </Button>
        </section>
      ) : null}
      {children}
    </Context.Provider>
  );
}
