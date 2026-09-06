import { expect, it, vi } from "vitest";
import {
  parseWorkspaceExport,
  previewLegacy,
  workspaceStorageKey,
  downloadWorkspace,
} from "./reader";
const fixture = {
  version: 1,
  workspace: {
    projects: [
      { id: "old-project", name: "Legacy", description: "", archived: false },
    ],
    tasks: [],
  },
};
it("reads only the explicitly selected account key and never alters old data", () => {
  const keys: string[] = [];
  const raw = JSON.stringify(fixture);
  expect(
    previewLegacy(
      {
        getItem: (key) => {
          keys.push(key);
          return raw;
        },
      },
      "account",
    ),
  ).toEqual(fixture);
  expect(keys).toEqual(["web-boilerplate.workspace:account"]);
  expect(() => workspaceStorageKey("")).toThrow();
  expect(previewLegacy({ getItem: () => null }, "account")).toBeNull();
});
it("downloads an explicit portable envelope and releases the temporary URL", () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  const create = vi.fn(() => "blob:synthetic-export");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    downloadWorkspace(
      parseWorkspaceExport(JSON.stringify(fixture)),
      "synthetic.json",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-export");
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    click.mockRestore();
  }
});
it("rejects malformed, unversioned, oversized and broken-reference legacy input", () => {
  for (const raw of [
    "not json",
    JSON.stringify({ ...fixture, version: 2 }),
    JSON.stringify({
      ...fixture,
      workspace: {
        projects: [
          ...fixture.workspace.projects,
          ...fixture.workspace.projects,
        ],
        tasks: [],
      },
    }),
    JSON.stringify({
      version: 1,
      workspace: {
        projects: [],
        tasks: [
          {
            id: "orphan",
            projectId: "absent",
            title: "Orphan task",
            description: "",
            status: "todo",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    }),
    "x".repeat(2 * 1024 * 1024 + 1),
  ])
    expect(() => parseWorkspaceExport(raw)).toThrow();
  expect(() =>
    previewLegacy(
      {
        getItem: () => {
          throw new Error("Storage denied");
        },
      },
      "account",
    ),
  ).toThrow("denied");
});
