import { useId, type FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import { Button } from "@workspace/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  taskStatuses,
  type Project,
  type Task,
  type TaskStatus,
} from "@workspace/contracts/v1";
import { useWorkspace } from "../hooks/workspace-context";
import { statusLabel } from "../view-models/projections";
import styles from "../workspace.module.css";
export function Field({
  label,
  name,
  defaultValue,
  required = false,
  multiline = false,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  required?: boolean;
  multiline?: boolean;
  maxLength: number;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          name={name}
          defaultValue={defaultValue}
          rows={3}
          maxLength={maxLength}
        />
      ) : (
        <Input
          id={id}
          name={name}
          defaultValue={defaultValue}
          required={required}
          minLength={required ? 2 : undefined}
          maxLength={maxLength}
        />
      )}
    </div>
  );
}
export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  project?: Project | undefined;
}) {
  const actions = useWorkspace();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await actions.project(
        {
          name: String(form.get("name")),
          description: String(form.get("description")),
        },
        project,
      )
    )
      onOpenChange(false);
  };
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      className={styles.dialog ?? ""}
    >
      <DialogTitle>{project ? "Rename project" : "New project"}</DialogTitle>
      <DialogDescription>
        Keep this concise and clear for your team.
      </DialogDescription>
      <form onSubmit={(event) => void submit(event)}>
        <Field
          label="Project name"
          name="name"
          defaultValue={project?.name}
          required
          maxLength={60}
        />
        <Field
          label="Description"
          name="description"
          defaultValue={project?.description}
          multiline
          maxLength={280}
        />
        <RequestError />
        <div className={styles.dialogActions}>
          <DialogClose type="button">Cancel</DialogClose>
          <Button
            type="submit"
            isDisabled={actions.busy || actions.needsReload}
          >
            Save project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  task?: Task | undefined;
  defaultProjectId?: string | undefined;
}) {
  const actions = useWorkspace();
  const active = actions.workspace.projects.filter(
    (project) => !project.archived || project.id === task?.projectId,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await actions.task(
        {
          projectId: String(form.get("projectId")),
          title: String(form.get("title")),
          description: String(form.get("description")),
          status: String(form.get("status")) as TaskStatus,
        },
        task,
      )
    )
      onOpenChange(false);
  };
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      className={styles.dialog ?? ""}
    >
      <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
      <DialogDescription>
        Tasks stay attached to their original project.
      </DialogDescription>
      <form onSubmit={(event) => void submit(event)}>
        {task ? (
          <input type="hidden" name="projectId" value={task.projectId} />
        ) : null}
        <Select
          className={styles.field ?? ""}
          {...(!task ? { name: "projectId" } : {})}
          defaultValue={
            task?.projectId ??
            (active.some((project) => project.id === defaultProjectId)
              ? defaultProjectId
              : active[0]?.id) ??
            null
          }
          isDisabled={Boolean(task)}
          isRequired
        >
          <Label>Project</Label>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {active.map((project) => (
              <SelectItem
                key={project.id}
                id={project.id}
                textValue={project.name}
              >
                {project.name}
                {project.archived ? " (archived)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Field
          label="Task title"
          name="title"
          defaultValue={task?.title}
          required
          maxLength={120}
        />
        <Field
          label="Description"
          name="description"
          defaultValue={task?.description}
          multiline
          maxLength={500}
        />
        <Select
          className={styles.field ?? ""}
          name="status"
          defaultValue={task?.status ?? "todo"}
          isRequired
        >
          <Label>Status</Label>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {taskStatuses.map((status) => (
              <SelectItem key={status} id={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!active.length ? (
          <p>Create an active project before adding a task.</p>
        ) : null}
        <RequestError />
        <div className={styles.dialogActions}>
          <DialogClose type="button">Cancel</DialogClose>
          <Button
            type="submit"
            isDisabled={actions.busy || actions.needsReload || !active.length}
          >
            {task ? "Save changes" : "Create task"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function RequestError() {
  const actions = useWorkspace();
  return actions.error ? (
    <div role="alert">
      <p>{actions.error} Your draft has not been discarded.</p>
      <Button
        type="button"
        variant="outline"
        onPress={() => void actions.reload()}
        isDisabled={actions.busy}
      >
        Reload and review
      </Button>
    </div>
  ) : null;
}
