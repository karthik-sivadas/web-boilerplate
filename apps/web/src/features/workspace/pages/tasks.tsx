import { useEffect, useState } from "react";
import { Card } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { taskStatuses, type TaskStatus } from "@workspace/contracts/v1";
import { useWorkspace } from "../hooks/workspace-context";
import { PageHeader } from "../components/frame";
import { TaskDialog } from "../components/forms";
import { TaskList } from "../components/task-list";
import { filterTasks, statusLabel } from "../view-models/projections";
import styles from "../workspace.module.css";
export function TasksPage({
  initialProjectId,
}: {
  initialProjectId?: string | undefined;
}) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [projectId, setProjectId] = useState(initialProjectId ?? ""),
    [status, setStatus] = useState<TaskStatus | "">("");
  useEffect(() => setProjectId(initialProjectId ?? ""), [initialProjectId]);
  const selected = workspace.projects.some(
    (project) => project.id === projectId,
  )
    ? projectId
    : "";
  const tasks = filterTasks(workspace, { query, projectId: selected, status });
  return (
    <>
      <PageHeader eyebrow="Track" title="Tasks">
        <Button data-new-task onPress={() => setOpen(true)}>
          New task
        </Button>
      </PageHeader>
      <section className={styles.filters} aria-label="Task filters">
        <div className={styles.search}>
          <Label htmlFor="task-search" className="sr-only">
            Search tasks
          </Label>
          <Input
            id="task-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
          />
        </div>
        <Select
          aria-label="Filter by project"
          value={selected || "all"}
          onChange={(key) =>
            setProjectId(key === "all" ? "" : String(key ?? ""))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="all">All projects</SelectItem>
            {workspace.projects.map((project) => (
              <SelectItem id={project.id} key={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          aria-label="Filter by status"
          value={status || "all"}
          onChange={(key) =>
            setStatus(taskStatuses.find((item) => item === key) ?? "")
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="all">All statuses</SelectItem>
            {taskStatuses.map((item) => (
              <SelectItem id={item} key={item}>
                {statusLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
      <Card className={styles.panel}>
        <p className={styles.results}>
          {tasks.length} matching task{tasks.length === 1 ? "" : "s"}
        </p>
        <TaskList
          tasks={tasks}
          projects={
            new Map(workspace.projects.map((project) => [project.id, project]))
          }
          editable
        />
      </Card>
      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        defaultProjectId={selected || undefined}
      />
    </>
  );
}
