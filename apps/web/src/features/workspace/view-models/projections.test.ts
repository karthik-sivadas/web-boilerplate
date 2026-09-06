import { expect, it } from "vitest";
import type { WorkspaceDto } from "@workspace/contracts/v1";
import { filterTasks, overview, statusLabel } from "./projections";
it("retains derived counts and intersecting case-insensitive task filters", () => {
  const workspace: WorkspaceDto = {
    revision: 0,
    projects: [
      { id: "p", name: "Active", description: "", archived: false },
      { id: "old", name: "Archived", description: "", archived: true },
    ],
    tasks: ["todo", "in_progress", "done"].map((status, index) => ({
      id: String(index),
      projectId: index === 2 ? "old" : "p",
      title: `Task ${index}`,
      description: "Findable detail",
      status: status as "todo" | "in_progress" | "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  expect(overview(workspace).map(([count]) => count)).toEqual([1, 3, 1, 1]);
  const all = { query: "", projectId: "", status: "" as const };
  expect(filterTasks(workspace, all)).toHaveLength(3);
  expect(filterTasks(workspace, { ...all, query: " FINDABLE " })).toHaveLength(
    3,
  );
  expect(
    filterTasks(workspace, {
      ...all,
      query: "task 1",
      projectId: "p",
      status: "in_progress",
    }).map((task) => task.id),
  ).toEqual(["1"]);
  expect(
    filterTasks(workspace, { ...all, projectId: "old", status: "todo" }),
  ).toEqual([]);
  expect(filterTasks(workspace, { ...all, query: "missing" })).toEqual([]);
  expect([
    statusLabel("todo"),
    statusLabel("in_progress"),
    statusLabel("done"),
  ]).toEqual(["To do", "In progress", "Done"]);
});
