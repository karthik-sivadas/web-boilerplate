import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TasksPage } from "../features/workspace/workspace";

const taskSearchSchema = z
  .object({ project: z.string().min(1).max(120).optional() })
  .strip();

export const Route = createFileRoute("/tasks")({
  validateSearch: taskSearchSchema,
  component: TasksRoute,
});
function TasksRoute() {
  return <TasksPage initialProjectId={Route.useSearch().project} />;
}
