import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Archive01Icon } from "@hugeicons/core-free-icons";
import { Card } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { useWorkspace } from "../hooks/workspace-context";
import { PageHeader, NotFound } from "../components/frame";
import { ProjectDialog, Field, RequestError } from "../components/forms";
import { TaskList } from "../components/task-list";
import styles from "../workspace.module.css";
export function ProjectsPage() {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Organize" title="Projects">
        <Button onPress={() => setOpen(true)}>
          <HugeiconsIcon icon={Add01Icon} size={17} />
          New project
        </Button>
      </PageHeader>
      {!workspace.projects.length ? (
        <div className={styles.empty}>
          <h2>Your workspace starts here</h2>
          <p>
            Create your first project, or explicitly import legacy data in
            Settings.
          </p>
        </div>
      ) : null}
      <div className={styles.projectGrid}>
        {workspace.projects.map((project) => (
          <Card key={project.id} className={styles.projectCard}>
            <div>
              <span className={styles.projectMark}>
                {project.name.slice(0, 1)}
              </span>
              <p className={styles.cardMeta}>
                {project.archived ? "Archived project" : "Active project"}
              </p>
              <h2>{project.name}</h2>
              <p>{project.description || "No description yet."}</p>
            </div>
            <footer>
              <span>
                {
                  workspace.tasks.filter(
                    (task) => task.projectId === project.id,
                  ).length
                }{" "}
                tasks
              </span>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
              >
                Open
              </Link>
            </footer>
          </Card>
        ))}
      </div>
      <ProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const actions = useWorkspace();
  const project = actions.workspace.projects.find(
    (item) => item.id === projectId,
  );
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  if (!project) return <NotFound />;
  const remove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirm = String(new FormData(event.currentTarget).get("confirm"));
    if (await actions.deleteProject(project.id, confirm))
      await navigate({ to: "/projects" });
  };
  return (
    <>
      <PageHeader
        eyebrow={project.archived ? "Archived project" : "Project"}
        title={project.name}
      >
        <div className={styles.headerActions}>
          <Button variant="outline" onPress={() => setEditing(true)}>
            Rename
          </Button>
          <Button
            variant="outline"
            isDisabled={actions.busy || actions.needsReload}
            onPress={() =>
              void actions.project(
                { name: project.name, description: project.description },
                { ...project, archived: !project.archived },
              )
            }
          >
            <HugeiconsIcon icon={Archive01Icon} size={16} />
            {project.archived ? "Unarchive" : "Archive"}
          </Button>
          <Button variant="outline" onPress={() => setDeleting(true)}>
            Delete project
          </Button>
        </div>
      </PageHeader>
      <p className={styles.lead}>
        {project.description || "No description yet."}
      </p>
      {project.archived ? (
        <p className={styles.notice}>
          Archived projects remain readable and cannot receive new tasks.
        </p>
      ) : null}
      <Card className={styles.panel}>
        <div className={styles.sectionTitle}>
          <h2>Tasks</h2>
          <Link to="/tasks" search={{ project: project.id }}>
            View in tasks
          </Link>
        </div>
        <TaskList
          tasks={actions.workspace.tasks.filter(
            (task) => task.projectId === project.id,
          )}
          projects={new Map([[project.id, project]])}
        />
      </Card>
      <ProjectDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
      />
      <AlertDialog
        isOpen={deleting}
        onOpenChange={setDeleting}
        className={styles.dialog ?? ""}
      >
        <AlertDialogTitle>Delete project and its tasks?</AlertDialogTitle>
        <AlertDialogDescription>
          All tasks in this project will also be deleted. Type the exact project
          name to confirm: {project.name}
        </AlertDialogDescription>
        <form onSubmit={(event) => void remove(event)}>
          <Field
            label="Confirm project name"
            name="confirm"
            required
            maxLength={60}
          />
          <RequestError />
          <div className={styles.dialogActions}>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <AlertDialogCancel autoFocus>Keep project</AlertDialogCancel>
            <Button
              variant="outline"
              type="submit"
              isDisabled={actions.busy || actions.needsReload}
            >
              Delete permanently
            </Button>
          </div>
        </form>
      </AlertDialog>
    </>
  );
}
