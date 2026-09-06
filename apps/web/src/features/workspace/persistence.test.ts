import { describe, expect, it } from "vitest";
import { demoWorkspace } from "./domain";
import {
  legacyWorkspaceStorageKey,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
  workspaceStorageKey,
  type StorageLike,
} from "./persistence";

const userA = "user-a";
const userB = "user-b";
function storage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("account-scoped workspace persistence", () => {
  it("round trips a validated versioned envelope only for its account", () => {
    const store = storage();
    expect(saveWorkspace(store, userA, demoWorkspace)).toEqual({
      kind: "local",
    });
    expect(loadWorkspace(store, userA)).toMatchObject({
      kind: "ready",
      workspace: demoWorkspace,
    });
    expect(loadWorkspace(store, userB)).toMatchObject({
      kind: "ready",
      workspace: demoWorkspace,
    });
    expect(store.values.has(workspaceStorageKey(userB))).toBe(false);
  });

  it("never imports, changes, or deletes the legacy anonymous key", () => {
    const store = storage();
    store.setItem(legacyWorkspaceStorageKey, "{bad legacy bytes");
    expect(loadWorkspace(store, userA)).toMatchObject({ kind: "ready" });
    expect(store.values.get(legacyWorkspaceStorageKey)).toBe(
      "{bad legacy bytes",
    );
    expect(saveWorkspace(store, userA, demoWorkspace)).toEqual({
      kind: "local",
    });
    expect(store.values.get(legacyWorkspaceStorageKey)).toBe(
      "{bad legacy bytes",
    );
  });

  it("requires recovery for corrupt or unknown-version account data without deleting it", () => {
    const store = storage();
    store.setItem(workspaceStorageKey(userA), "{bad");
    expect(loadWorkspace(store, userA)).toMatchObject({ kind: "recovery" });
    expect(store.values.get(workspaceStorageKey(userA))).toBe("{bad");
    store.setItem(
      workspaceStorageKey(userA),
      JSON.stringify({ version: 2, workspace: demoWorkspace }),
    );
    expect(loadWorkspace(store, userA)).toMatchObject({ kind: "recovery" });
  });

  it("requires an authenticated id for every storage operation", () => {
    expect(() => workspaceStorageKey("")).toThrow(/authenticated user id/i);
  });

  it("reports unavailable storage and preserves prior account bytes when reset fails", () => {
    const inaccessible: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadWorkspace(inaccessible, userA)).toMatchObject({
      kind: "unavailable",
    });
    expect(saveWorkspace(inaccessible, userA, demoWorkspace)).toMatchObject({
      kind: "failed",
    });
    expect(resetWorkspace(inaccessible, userA)).toMatchObject({
      kind: "failed",
    });
    expect(loadWorkspace(undefined, userA)).toMatchObject({
      kind: "unavailable",
    });

    const store = storage();
    const previous = JSON.stringify({
      version: 1,
      workspace: { projects: [], tasks: [] },
    });
    store.values.set(workspaceStorageKey(userA), previous);
    store.setItem = () => {
      throw new Error("quota");
    };
    expect(resetWorkspace(store, userA)).toMatchObject({ kind: "failed" });
    expect(store.values.get(workspaceStorageKey(userA))).toBe(previous);
  });
});
