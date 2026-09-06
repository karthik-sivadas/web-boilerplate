import { describe, expect, it, vi } from "vitest";
import {
  createProject,
  createTask,
  demoWorkspace,
  deleteTask,
  filterTasks,
  getOverview,
  renameProject,
  setProjectArchived,
  updateTask,
  workspaceSchema,
} from "./domain";

const input = {
  projectId: "p-foundation",
  title: "Useful task",
  description: "",
  status: "todo" as const,
};
describe("workspace domain", () => {
  it("derives counts and filters task records", () => {
    expect(getOverview(demoWorkspace)).toEqual({
      projects: 2,
      tasks: 3,
      done: 1,
      inProgress: 1,
    });
    expect(
      filterTasks(demoWorkspace, { status: "todo" }).map((task) => task.id),
    ).toEqual(["t-interviews"]);
    expect(filterTasks(demoWorkspace, { query: "shell" })[0]?.id).toBe(
      "t-shell",
    );
    expect(
      filterTasks(demoWorkspace, { projectId: "p-foundation", status: "done" }),
    ).toHaveLength(1);
    expect(filterTasks(demoWorkspace, { query: "missing" })).toEqual([]);
  });
  it("creates valid projects and tasks without accepting caller IDs", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "fixed" });
    const withProject = createProject(demoWorkspace, {
      name: "Release work",
      description: "",
    });
    expect(withProject.projects.at(-1)?.id).toBe("project-fixed");
    const withTask = createTask(
      withProject,
      { ...input, projectId: "project-fixed", title: "Ship it" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(withTask.tasks.at(-1)).toMatchObject({
      id: "task-fixed",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(() =>
      createProject(demoWorkspace, { name: "x", description: "" }),
    ).toThrow();
    vi.unstubAllGlobals();
  });
  it("protects archive, references, immutable identity, and missing records", () => {
    const archived = setProjectArchived(demoWorkspace, "p-foundation", true);
    expect(() => createTask(archived, input)).toThrow("Archived");
    expect(() =>
      createTask(demoWorkspace, { ...input, projectId: "missing" }),
    ).toThrow("Choose an existing");
    expect(() => updateTask(demoWorkspace, "missing", input)).toThrow(
      "not found",
    );
    expect(() =>
      updateTask(demoWorkspace, "t-shell", {
        ...input,
        projectId: "p-research",
      }),
    ).toThrow("cannot move");
    expect(() =>
      renameProject(demoWorkspace, "missing", {
        name: "Known",
        description: "",
      }),
    ).toThrow("not found");
    expect(() => setProjectArchived(demoWorkspace, "missing", true)).toThrow(
      "not found",
    );
    const changed = updateTask(
      demoWorkspace,
      "t-shell",
      { ...input, title: "Changed title", status: "done" },
      "2026-02-01T00:00:00.000Z",
    );
    expect(changed.tasks.find((task) => task.id === "t-shell")).toMatchObject({
      id: "t-shell",
      createdAt: "2026-01-15T09:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(deleteTask(changed, "t-shell").tasks).toHaveLength(2);
  });
  it("rejects duplicate IDs and invalid project references in external workspace data", () => {
    expect(() =>
      workspaceSchema.parse({
        projects: [demoWorkspace.projects[0], demoWorkspace.projects[0]],
        tasks: [],
      }),
    ).toThrow();
    expect(() =>
      workspaceSchema.parse({ projects: [], tasks: [demoWorkspace.tasks[0]] }),
    ).toThrow();
  });
});
