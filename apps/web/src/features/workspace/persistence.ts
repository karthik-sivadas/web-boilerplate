import { demoWorkspace, type Workspace, workspaceSchema } from "./domain";
import { z } from "zod";

/** Historic anonymous data is deliberately never read, altered, or imported. */
export const legacyWorkspaceStorageKey = "web-boilerplate.workspace";
const envelopeSchema = z
  .object({ version: z.literal(1), workspace: workspaceSchema })
  .strict();
export type LoadResult =
  | { kind: "ready"; workspace: Workspace; persistence: "local" }
  | { kind: "recovery"; reason: string }
  | { kind: "unavailable"; workspace: Workspace };
export type WriteResult =
  | { kind: "local" }
  | { kind: "failed"; reason: string };
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function workspaceStorageKey(userId: string): string {
  if (!userId)
    throw new Error(
      "An authenticated user id is required for workspace storage.",
    );
  return `web-boilerplate.workspace:${userId}`;
}

/** Accessing the browser storage getter can itself be denied. */
export function getBrowserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadWorkspace(
  storage: StorageLike | undefined,
  userId: string,
): LoadResult {
  if (!storage) return { kind: "unavailable", workspace: demoWorkspace };
  let raw: string | null;
  try {
    raw = storage.getItem(workspaceStorageKey(userId));
  } catch {
    return { kind: "unavailable", workspace: demoWorkspace };
  }
  if (!raw)
    return { kind: "ready", workspace: demoWorkspace, persistence: "local" };
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? {
          kind: "ready",
          workspace: parsed.data.workspace,
          persistence: "local",
        }
      : {
          kind: "recovery",
          reason: "Saved data has an unknown format or version.",
        };
  } catch {
    return {
      kind: "recovery",
      reason: "Saved data could not be parsed safely.",
    };
  }
}

function failureReason(storage: StorageLike | undefined): WriteResult {
  return storage
    ? {
        kind: "failed",
        reason: "The browser did not allow this change to be saved.",
      }
    : { kind: "failed", reason: "Browser storage is unavailable." };
}

export function saveWorkspace(
  storage: StorageLike | undefined,
  userId: string,
  workspace: Workspace,
): WriteResult {
  workspaceSchema.parse(workspace);
  if (!storage) return failureReason(storage);
  try {
    storage.setItem(
      workspaceStorageKey(userId),
      JSON.stringify({ version: 1, workspace }),
    );
    return { kind: "local" };
  } catch {
    return failureReason(storage);
  }
}

/** A single replacement write preserves prior bytes if the browser rejects it. */
export function resetWorkspace(
  storage: StorageLike | undefined,
  userId: string,
): WriteResult {
  if (!storage) return failureReason(storage);
  try {
    storage.setItem(
      workspaceStorageKey(userId),
      JSON.stringify({ version: 1, workspace: demoWorkspace }),
    );
    return { kind: "local" };
  } catch {
    return failureReason(storage);
  }
}
