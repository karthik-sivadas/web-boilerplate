import type { TaskStatus, WorkspaceDto } from "@workspace/contracts/v1";
export const statusLabel = (status: TaskStatus) =>
  status === "in_progress"
    ? "In progress"
    : status === "todo"
      ? "To do"
      : "Done";
export function filterTasks(
  workspace: WorkspaceDto,
  filters: { query: string; projectId: string; status: TaskStatus | "" },
) {
  const query = filters.query.trim().toLowerCase();
  return workspace.tasks.filter(
    (task) =>
      (!query ||
        `${task.title} ${task.description}`.toLowerCase().includes(query)) &&
      (!filters.projectId || task.projectId === filters.projectId) &&
      (!filters.status || task.status === filters.status),
  );
}
export function overview(workspace: WorkspaceDto) {
  return [
    [
      workspace.projects.filter((project) => !project.archived).length,
      "Active projects",
    ],
    [workspace.tasks.length, "Total tasks"],
    [
      workspace.tasks.filter((task) => task.status === "in_progress").length,
      "In progress",
    ],
    [
      workspace.tasks.filter((task) => task.status === "done").length,
      "Completed",
    ],
  ] as const;
}
