import { describe, expect, it } from "vitest";
import { demoWorkspace } from "./domain";
import {
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
  workspaceStorageKey,
  type StorageLike,
} from "./persistence";
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
describe("workspace persistence", () => {
  it("round trips a validated versioned envelope", () => {
    const store = storage();
    expect(saveWorkspace(store, demoWorkspace)).toEqual({ kind: "local" });
    expect(loadWorkspace(store)).toMatchObject({
      kind: "ready",
      workspace: demoWorkspace,
    });
  });
  it("requires recovery for corrupt and unknown-version data without deleting it", () => {
    const store = storage();
    store.setItem(workspaceStorageKey, "{bad");
    expect(loadWorkspace(store)).toMatchObject({ kind: "recovery" });
    expect(store.values.get(workspaceStorageKey)).toBe("{bad");
    store.setItem(
      workspaceStorageKey,
      JSON.stringify({ version: 2, workspace: demoWorkspace }),
    );
    expect(loadWorkspace(store)).toMatchObject({ kind: "recovery" });
  });
  it("reports unavailable storage and preserves previous bytes when reset fails", () => {
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
    expect(loadWorkspace(inaccessible)).toMatchObject({ kind: "unavailable" });
    expect(saveWorkspace(inaccessible, demoWorkspace)).toMatchObject({
      kind: "failed",
    });
    expect(resetWorkspace(inaccessible)).toMatchObject({ kind: "failed" });
    expect(loadWorkspace(undefined)).toMatchObject({ kind: "unavailable" });
    expect(saveWorkspace(undefined, demoWorkspace)).toMatchObject({
      kind: "failed",
    });

    const store = storage();
    const previous = JSON.stringify({
      version: 1,
      workspace: { projects: [], tasks: [] },
    });
    store.values.set(workspaceStorageKey, previous);
    store.setItem = () => {
      throw new Error("quota");
    };
    expect(resetWorkspace(store)).toMatchObject({ kind: "failed" });
    expect(store.values.get(workspaceStorageKey)).toBe(previous);
  });
});
