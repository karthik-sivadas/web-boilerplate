import {
  transition,
  type Command,
  type Values,
  type Workspace,
} from "../domain/workspace";

/** Created only after server authentication. Never deserialize an actor from a DTO. */
export interface Actor {
  readonly userId: string;
}
/** Adapter must lock the owner, compare revision, and commit the callback atomically. */
export interface WorkspaceTransactions {
  read(actor: Actor): Promise<Workspace>;
  change(
    actor: Actor,
    expectedRevision: number,
    apply: (state: Workspace) => Workspace,
  ): Promise<Workspace>;
}
export function workspaceApplication(
  port: WorkspaceTransactions,
  values: Values,
) {
  return {
    read: (actor: Actor) => port.read(actor),
    execute: (actor: Actor, expectedRevision: number, command: Command) =>
      port.change(actor, expectedRevision, (state) =>
        transition(state, command, values),
      ),
  };
}
