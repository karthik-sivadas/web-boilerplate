import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  transition,
  workspaceSchema,
  WorkspaceFailure,
} from "./workspace";
import { workspaceApplication } from "../application/workspace";
const values = { id: () => "generated", now: () => "2026-09-05T00:00:00.000Z" };
const project = { id: "p1", name: "Project", description: "", archived: false };
const input = {
  projectId: "p1",
  title: "Task",
  description: "",
  status: "todo" as const,
};
describe("authoritative workspace", () => {
  it("starts empty and injects IDs/time without mutating input", () => {
    const state = { ...emptyWorkspace(), projects: [project] };
    const next = transition(state, { type: "createTask", input }, values);
    expect(next.tasks[0]).toMatchObject({
      id: "generated",
      createdAt: values.now(),
      updatedAt: values.now(),
    });
    expect(state.tasks).toEqual([]);
    expect(next.revision).toBe(1);
  });
  it("rejects archived task creation but permits existing task edits", () => {
    const state = transition(
      { ...emptyWorkspace(), projects: [project] },
      { type: "createTask", input },
      values,
    );
    state.projects[0]!.archived = true;
    expect(() =>
      transition(state, { type: "createTask", input }, values),
    ).toThrow(WorkspaceFailure);
    expect(
      transition(
        state,
        {
          type: "updateTask",
          id: "generated",
          input: { ...input, status: "done" },
        },
        values,
      ).tasks[0]?.status,
    ).toBe("done");
    expect(() =>
      transition(
        state,
        {
          type: "updateTask",
          id: "generated",
          input: { ...input, projectId: "foreign" },
        },
        values,
      ),
    ).toThrow("cannot move");
  });
  it("requires project-name confirmation and cascades tasks", () => {
    const state = transition(
      { ...emptyWorkspace(), projects: [project] },
      { type: "createTask", input },
      values,
    );
    expect(() =>
      transition(
        state,
        { type: "deleteProject", id: "p1", confirm: "wrong" },
        values,
      ),
    ).toThrow("Confirm");
    expect(
      transition(
        state,
        { type: "deleteProject", id: "p1", confirm: "Project" },
        values,
      ),
    ).toEqual({ revision: 2, projects: [], tasks: [] });
  });
  it("validates references, unknown IDs and strict inputs", () => {
    expect(() =>
      workspaceSchema.parse({
        ...emptyWorkspace(),
        tasks: [
          {
            ...input,
            id: "t",
            createdAt: values.now(),
            updatedAt: values.now(),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      transition(
        emptyWorkspace(),
        { type: "deleteTask", id: "missing" },
        values,
      ),
    ).toThrow("not found");
    expect(() =>
      transition(
        emptyWorkspace(),
        { type: "createProject", input: { name: "x", description: "" } },
        values,
      ),
    ).toThrow();
  });
  it("bounds escaped UTF-8 exports as well as entity counts", () => {
    const projects = Array.from({ length: 100 }, (_, i) => ({
      ...project,
      id: `p${i}`,
    }));
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      ...input,
      id: `t${i}`,
      description: "\u0001".repeat(500),
      createdAt: values.now(),
      updatedAt: values.now(),
    }));
    expect(() =>
      workspaceSchema.parse({ revision: 0, projects, tasks }),
    ).toThrow("byte limit");
    expect(() =>
      workspaceSchema.parse({
        ...emptyWorkspace(),
        projects: [...projects, project],
      }),
    ).toThrow();
  });
  it("creates and updates projects, validates missing targets and deletes existing tasks", () => {
    const created = transition(
      emptyWorkspace(),
      {
        type: "createProject",
        input: { name: " Name ", description: "Résumé 日本語 😀" },
      },
      values,
    );
    expect(created.projects[0]).toEqual({
      id: "generated",
      name: "Name",
      description: "Résumé 日本語 😀",
      archived: false,
    });
    const updated = transition(
      created,
      {
        type: "updateProject",
        id: "generated",
        input: { name: "Renamed", description: "", archived: true },
      },
      values,
    );
    expect(updated.projects[0]?.archived).toBe(true);
    expect(() =>
      transition(
        emptyWorkspace(),
        {
          type: "createProject",
          input: { name: "Name", description: "bad\u0000text" },
        },
        values,
      ),
    ).toThrow("NUL");
    for (const command of [
      {
        type: "updateProject" as const,
        id: "missing",
        input: { name: "Name", description: "", archived: false },
      },
      { type: "deleteProject" as const, id: "missing", confirm: "Name" },
      { type: "createTask" as const, input },
      { type: "updateTask" as const, id: "missing", input },
    ])
      expect(() => transition(emptyWorkspace(), command, values)).toThrow(
        "not found",
      );
    const withTask = transition(
      { ...emptyWorkspace(), projects: [project] },
      { type: "createTask", input },
      values,
    );
    expect(
      transition(withTask, { type: "deleteTask", id: "generated" }, values)
        .tasks,
    ).toEqual([]);
    expect(() =>
      workspaceSchema.parse({
        ...created,
        projects: [created.projects[0], created.projects[0]],
      }),
    ).toThrow();
    expect(() =>
      workspaceSchema.parse({
        ...withTask,
        tasks: [...withTask.tasks, ...withTask.tasks],
      }),
    ).toThrow();
  });
  it("passes explicit actor and revision through the semantic transaction port", async () => {
    const actor = { userId: "verified" };
    const application = workspaceApplication(
      {
        read: (received) => {
          expect(received).toEqual(actor);
          return Promise.resolve(emptyWorkspace());
        },
        change: (received, revision, apply) => {
          expect(received).toEqual(actor);
          expect(revision).toBe(0);
          return Promise.resolve(apply(emptyWorkspace()));
        },
      },
      values,
    );
    expect(await application.read(actor)).toEqual(emptyWorkspace());
    expect(
      (
        await application.execute(actor, 0, {
          type: "createProject",
          input: { name: "Name", description: "" },
        })
      ).revision,
    ).toBe(1);
  });
});
