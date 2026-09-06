import {
  emptyWorkspace,
  workspaceSchema,
  WorkspaceFailure,
  type Values,
  type Workspace,
} from "../domain/workspace";
import type { Actor, WorkspaceTransactions } from "./workspace";
export interface ImportReceipt {
  fingerprint: string;
  importedRevision: number;
}
export interface WorkspacePreservation extends WorkspaceTransactions {
  receipt(actor: Actor): Promise<ImportReceipt | null>;
  importEmpty(
    actor: Actor,
    revision: number,
    fingerprint: string,
    apply: (state: Workspace) => Workspace,
  ): Promise<Workspace>;
  rollbackImport(
    actor: Actor,
    revision: number,
    fingerprint: string,
    apply: (state: Workspace) => Workspace,
  ): Promise<Workspace>;
}
export function preservationApplication(
  port: WorkspacePreservation,
  values: Values,
) {
  return {
    import: (
      actor: Actor,
      revision: number,
      fingerprint: string,
      source: Omit<Workspace, "revision">,
    ) => {
      const parsed = workspaceSchema.parse({ ...source, revision: 0 });
      return port.importEmpty(actor, revision, fingerprint, (state) => {
        if (state.projects.length || state.tasks.length)
          throw new WorkspaceFailure(
            "RULE_VIOLATION",
            "Import requires an empty workspace.",
          );
        const ids = new Map(
          parsed.projects.map((project) => [project.id, values.id()]),
        );
        return workspaceSchema.parse({
          revision: state.revision + 1,
          projects: parsed.projects.map((project) => ({
            ...project,
            id: ids.get(project.id)!,
          })),
          tasks: parsed.tasks.map((task) => ({
            ...task,
            id: values.id(),
            projectId: ids.get(task.projectId)!,
          })),
        });
      });
    },
    rollback: (actor: Actor, revision: number, fingerprint: string) =>
      port.rollbackImport(actor, revision, fingerprint, (state) => ({
        ...emptyWorkspace(),
        revision: state.revision + 1,
      })),
  };
}
