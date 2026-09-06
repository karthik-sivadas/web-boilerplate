import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Task01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import type { Task, Project } from "@workspace/contracts/v1";
import { useWorkspace } from "../hooks/workspace-context";
import { TaskDialog, RequestError } from "./forms";
import { statusLabel } from "../view-models/projections";
import styles from "../workspace.module.css";
export function TaskList({
  tasks,
  projects,
  editable = false,
}: {
  tasks: Task[];
  projects: Map<string, Project>;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState<Task | null>(null),
    [deleting, setDeleting] = useState<Task | null>(null);
  const actions = useWorkspace();
  if (!tasks.length)
    return (
      <div className={styles.empty}>
        <HugeiconsIcon icon={Task01Icon} size={26} />
        <h3>No tasks here yet</h3>
        <p>Try adjusting the filters or create a focused next step.</p>
      </div>
    );
  return (
    <>
      <ul className={styles.taskList}>
        {tasks.map((task) => (
          <li key={task.id}>
            <Badge variant="outline" className={styles.status}>
              {statusLabel(task.status)}
            </Badge>
            <div>
              <b>{task.title}</b>
              <small>
                {projects.get(task.projectId)?.name ?? "Unknown project"}
                {task.description ? ` · ${task.description}` : ""}
              </small>
            </div>
            {editable ? (
              <div className={styles.rowActions}>
                <Button variant="ghost" onPress={() => setEditing(task)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onPress={() => setDeleting(task)}
                  aria-label={`Delete ${task.title}`}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={16} />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <TaskDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        task={editing ?? undefined}
      />
      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        className={styles.dialog ?? ""}
      >
        <AlertDialogTitle>Delete this task?</AlertDialogTitle>
        <AlertDialogDescription>
          {deleting
            ? `“${deleting.title}” will be removed from your account.`
            : ""}
        </AlertDialogDescription>
        <RequestError />
        <div className={styles.dialogActions}>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <AlertDialogCancel autoFocus>Keep task</AlertDialogCancel>
          <Button
            variant="outline"
            isDisabled={actions.busy || actions.needsReload}
            onPress={() => {
              if (deleting)
                void actions.deleteTask(deleting.id).then((saved) => {
                  if (saved) setDeleting(null);
                });
            }}
          >
            Delete task
          </Button>
        </div>
      </AlertDialog>
    </>
  );
}
