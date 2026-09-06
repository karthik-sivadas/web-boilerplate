import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import { Card } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive01Icon,
  ArrowRight01Icon,
  Task01Icon,
  Folder01Icon,
  DashboardSquare01Icon,
  Add01Icon,
  RefreshIcon,
  Search01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { useSessionActions } from "@/features/auth/session-context";
import type { UserDto } from "@/features/auth/server-functions";
import {
  createProject,
  createTask,
  demoWorkspace,
  deleteTask,
  filterTasks,
  getOverview,
  renameProject,
  setProjectArchived,
  taskStatuses,
  type Project,
  type ProjectInput,
  type Task,
  type TaskInput,
  type TaskStatus,
  updateTask,
  type Workspace,
} from "./domain";
import {
  getBrowserStorage,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
} from "./persistence";
import styles from "./workspace.module.css";

type WorkspaceContextValue = {
  workspace: Workspace;
  persistence: "local" | "memory";
  storageError?: string | undefined;
  save(next: Workspace): boolean;
  reset(): boolean;
  retryStorage(): void;
  continueInMemory(): void;
};
type WorkspaceState = {
  workspace: Workspace;
  persistence: "local" | "memory";
  recovery?: string | undefined;
  storageError?: string | undefined;
  awaitingConsent?: boolean;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace provider is missing.");
  return value;
}
export function WorkspaceProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const sessionActions = useSessionActions();
  useEffect(() => {
    if (sessionActions && !sessionActions.canAct()) return;
    const result = loadWorkspace(getBrowserStorage(), userId);
    if (result.kind === "recovery") {
      setState({
        workspace: { projects: [], tasks: [] },
        persistence: "memory",
        recovery: result.reason,
      });
    } else if (result.kind === "unavailable") {
      setState({
        workspace: result.workspace,
        persistence: "memory",
        storageError: "Browser storage is unavailable.",
        awaitingConsent: true,
      });
    } else {
      setState({
        workspace: result.workspace,
        persistence: result.persistence,
      });
    }
  }, [userId, sessionActions]);
  if (!state)
    return (
      <main className={styles.loading} aria-live="polite">
        Loading your demo workspace…
      </main>
    );
  const retryStorage = () => {
    if (sessionActions && !sessionActions.canAct()) return;
    const result = loadWorkspace(getBrowserStorage(), userId);
    if (result.kind === "ready")
      setState({ workspace: result.workspace, persistence: "local" });
    else
      setState((current) =>
        current
          ? {
              ...current,
              storageError:
                result.kind === "recovery"
                  ? result.reason
                  : "Browser storage is still unavailable.",
              awaitingConsent: true,
            }
          : current,
      );
  };
  const continueInMemory = () =>
    setState((current) => {
      if (!current || (sessionActions && !sessionActions.canAct()))
        return current;
      if (current.recovery)
        return {
          workspace: structuredCloneFallback(),
          persistence: "memory",
          awaitingConsent: false,
        };
      return {
        ...current,
        persistence: "memory",
        awaitingConsent: false,
        storageError: undefined,
      };
    });
  if (state.recovery) {
    const resetRecovery = () => {
      if (sessionActions && !sessionActions.canAct()) return;
      const result = resetWorkspace(getBrowserStorage(), userId);
      if (result.kind === "local")
        setState({
          workspace: structuredCloneFallback(),
          persistence: "local",
        });
      else
        setState((current) =>
          current
            ? { ...current, storageError: result.reason, awaitingConsent: true }
            : current,
        );
    };
    return (
      <main className={styles.recovery}>
        <h1>Saved data needs recovery</h1>
        <p>{state.recovery} Nothing has been deleted.</p>
        {state.storageError ? <p role="alert">{state.storageError}</p> : null}
        <Button onPress={resetRecovery}>Reset to safe demo data</Button>
        {state.awaitingConsent ? (
          <StorageConsent
            retryStorage={retryStorage}
            continueInMemory={continueInMemory}
          />
        ) : null}
      </main>
    );
  }
  if (state.awaitingConsent)
    return (
      <main className={styles.recovery}>
        <h1>Browser storage needs your choice</h1>
        <p role="alert">{state.storageError} No changes have been saved.</p>
        <StorageConsent
          retryStorage={retryStorage}
          continueInMemory={continueInMemory}
        />
      </main>
    );
  const save = (workspace: Workspace) => {
    if (sessionActions && !sessionActions.canAct()) return false;
    if (state.persistence === "memory") {
      setState({ workspace, persistence: "memory" });
      return true;
    }
    const result = saveWorkspace(getBrowserStorage(), userId, workspace);
    if (result.kind === "local") {
      setState({ workspace, persistence: "local" });
      return true;
    }
    setState((current) =>
      current
        ? { ...current, storageError: result.reason, awaitingConsent: false }
        : current,
    );
    return false;
  };
  const reset = () => {
    if (sessionActions && !sessionActions.canAct()) return false;
    if (state.persistence === "memory") {
      setState({ workspace: structuredCloneFallback(), persistence: "memory" });
      return true;
    }
    const result = resetWorkspace(getBrowserStorage(), userId);
    if (result.kind === "local") {
      setState({ workspace: structuredCloneFallback(), persistence: "local" });
      return true;
    }
    setState((current) =>
      current
        ? { ...current, storageError: result.reason, awaitingConsent: false }
        : current,
    );
    return false;
  };
  return (
    <WorkspaceContext.Provider
      value={{
        workspace: state.workspace,
        persistence: state.persistence,
        storageError: state.storageError,
        save,
        reset,
        retryStorage,
        continueInMemory,
      }}
    >
      {children}
      {state.storageError ? (
        <StorageFailureNotice
          error={state.storageError}
          retryStorage={retryStorage}
          continueInMemory={continueInMemory}
        />
      ) : null}
    </WorkspaceContext.Provider>
  );
}
function StorageFailureNotice({
  error,
  retryStorage,
  continueInMemory,
}: {
  error: string;
  retryStorage(): void;
  continueInMemory(): void;
}) {
  return (
    <section className={styles.recovery} role="alert">
      <p>{error} Your change was not saved.</p>
      <StorageConsent
        retryStorage={retryStorage}
        continueInMemory={continueInMemory}
      />
    </section>
  );
}
function StorageConsent({
  retryStorage,
  continueInMemory,
}: {
  retryStorage(): void;
  continueInMemory(): void;
}) {
  return (
    <div className={styles.dialogActions}>
      <Button type="button" variant="outline" onPress={retryStorage}>
        Retry storage
      </Button>
      <Button type="button" onPress={continueInMemory}>
        Continue in memory
      </Button>
    </div>
  );
}
function SignOutButton() {
  const actions = useSessionActions();
  return (
    <Button
      variant="outline"
      size="sm"
      isDisabled={!actions}
      onPress={() => {
        if (actions?.canAct()) void actions.signOut();
      }}
    >
      Sign out
    </Button>
  );
}
function structuredCloneFallback(): Workspace {
  return structuredClone(demoWorkspace);
}

const nav = [
  { to: "/", label: "Overview", icon: DashboardSquare01Icon },
  { to: "/projects", label: "Projects", icon: Folder01Icon },
  { to: "/tasks", label: "Tasks", icon: Task01Icon },
  { to: "/settings", label: "Demo settings", icon: RefreshIcon },
];
export function WorkspaceShell({
  children,
  user,
}: {
  children: ReactNode;
  user: UserDto;
}) {
  const location = useLocation();
  const { persistence, storageError } = useWorkspace();
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <span>W</span> Workbench
        </Link>
        <nav aria-label="Workspace">
          <ul>
            {nav.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className={
                    location.pathname === to ? styles.active : undefined
                  }
                >
                  <HugeiconsIcon icon={Icon} size={18} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.sidebarNote}>
          <p>{user.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.mobileHeader}>
          <Link to="/" className={styles.brand}>
            <span>W</span> Workbench
          </Link>
          <nav aria-label="Mobile workspace">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} aria-label={label}>
                <HugeiconsIcon icon={Icon} size={20} />
              </Link>
            ))}
          </nav>
          <SignOutButton />
        </header>
        <div className={styles.banner}>
          Workspace data is stored only in this browser for {user.email}. This
          is normal-view isolation, not protection from browser-profile or
          devtools access, and it does not provide cloud sync.
          {persistence === "memory"
            ? " Using in-memory mode; changes will not survive a reload."
            : ""}
        </div>
        {storageError ? (
          <div className={styles.banner} role="status">
            Storage needs attention below; your change has not been saved.
          </div>
        ) : null}
        <main id="content" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function OverviewPage() {
  const { workspace } = useWorkspace();
  const overview = getOverview(workspace);
  const projectById = new Map(
    workspace.projects.map((project) => [project.id, project]),
  );
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="A clearer way to move work forward"
      />
      <section className={styles.metrics} aria-label="Workspace metrics">
        {[
          [overview.projects, "Active projects"],
          [overview.tasks, "Total tasks"],
          [overview.inProgress, "In progress"],
          [overview.done, "Completed"],
        ].map(([value, label]) => (
          <Card key={String(label)} className={styles.metric}>
            <strong>{value}</strong>
            <span>{label}</span>
          </Card>
        ))}
      </section>
      <section className={styles.twoColumn}>
        <Card className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>Next up</p>
              <h2>Recent tasks</h2>
            </div>
            <Link to="/tasks" search={{ project: undefined }}>
              View all{" "}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                className="rtl:rotate-180"
              />
            </Link>
          </div>
          <TaskList
            tasks={workspace.tasks.slice(0, 4)}
            projects={projectById}
          />
        </Card>
        <Card className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>At a glance</p>
              <h2>Projects</h2>
            </div>
            <Link to="/projects">
              Manage{" "}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                className="rtl:rotate-180"
              />
            </Link>
          </div>
          <div className={styles.projectSummary}>
            {workspace.projects.map((project) => (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
              >
                <span>
                  <b>{project.name}</b>
                  <small>
                    {
                      workspace.tasks.filter(
                        (task) => task.projectId === project.id,
                      ).length
                    }{" "}
                    tasks {project.archived ? "· Archived" : ""}
                  </small>
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  className="rtl:rotate-180"
                />
              </Link>
            ))}
          </div>
        </Card>
      </section>
    </>
  );
}

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
      <div className={styles.projectGrid}>
        {workspace.projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            taskCount={
              workspace.tasks.filter((task) => task.projectId === project.id)
                .length
            }
          />
        ))}
      </div>
      <ProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
function ProjectCard({
  project,
  taskCount,
}: {
  project: Project;
  taskCount: number;
}) {
  return (
    <Card className={styles.projectCard}>
      <div>
        <span className={styles.projectMark}>{project.name.slice(0, 1)}</span>
        <p className={styles.cardMeta}>
          {project.archived ? "Archived project" : "Active project"}
        </p>
        <h2>{project.name}</h2>
        <p>{project.description || "No description yet."}</p>
      </div>
      <footer>
        <span>
          {taskCount} task{taskCount === 1 ? "" : "s"}
        </span>
        <Link to="/projects/$projectId" params={{ projectId: project.id }}>
          Open{" "}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            className="rtl:rotate-180"
          />
        </Link>
      </footer>
    </Card>
  );
}
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { workspace, save } = useWorkspace();
  const project = workspace.projects.find((item) => item.id === projectId);
  const [editing, setEditing] = useState(false);
  if (!project) return <NotFound />;
  const tasks = workspace.tasks.filter((task) => task.projectId === project.id);
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
            onPress={() => {
              save(
                setProjectArchived(workspace, project.id, !project.archived),
              );
            }}
          >
            <HugeiconsIcon icon={Archive01Icon} size={16} />
            {project.archived ? "Unarchive" : "Archive"}
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
            View in tasks{" "}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={16}
              className="rtl:rotate-180"
            />
          </Link>
        </div>
        <TaskList tasks={tasks} projects={new Map([[project.id, project]])} />
      </Card>
      <ProjectDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
      />
    </>
  );
}

export function TasksPage({
  initialProjectId,
}: {
  initialProjectId?: string | undefined;
}) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  useEffect(() => setProjectId(initialProjectId ?? ""), [initialProjectId]);
  // Ignore a stale or adversarial URL value rather than showing an empty trap.
  const selectedProjectId = workspace.projects.some(
    (project) => project.id === projectId,
  )
    ? projectId
    : "";
  const [status, setStatus] = useState<TaskStatus | "">("");
  const tasks = filterTasks(workspace, {
    query,
    projectId: selectedProjectId || undefined,
    status: status || undefined,
  });
  return (
    <>
      <PageHeader eyebrow="Track" title="Tasks">
        <Button data-new-task onPress={() => setOpen(true)}>
          <HugeiconsIcon icon={Add01Icon} size={17} />
          New task
        </Button>
      </PageHeader>
      <section className={styles.filters} aria-label="Task filters">
        <div className={styles.search}>
          <HugeiconsIcon icon={Search01Icon} size={17} />
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
          value={selectedProjectId || "all"}
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
        defaultProjectId={selectedProjectId || undefined}
      />
    </>
  );
}
function TaskList({
  tasks,
  projects,
  editable = false,
}: {
  tasks: Task[];
  projects: Map<string, Project>;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
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
                  variant="destructive"
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
      <DeleteDialog
        task={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </>
  );
}
function statusLabel(status: TaskStatus): string {
  return status === "in_progress"
    ? "In progress"
    : status === "todo"
      ? "To do"
      : "Done";
}

function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  project?: Project;
}) {
  const { workspace, save, retryStorage, continueInMemory } = useWorkspace();
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: ProjectInput = {
      name: String(form.get("name")),
      description: String(form.get("description")),
    };
    try {
      const saved = save(
        project
          ? renameProject(workspace, project.id, input)
          : createProject(workspace, input),
      );
      if (!saved) {
        setError(
          "Could not save project. Choose a storage option before trying again.",
        );
        return;
      }
      setError("");
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save project.",
      );
    }
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
      <form onSubmit={submit}>
        <Field
          label="Project name"
          name="name"
          defaultValue={project?.name}
          required
          error={error}
        />
        <Field
          label="Description"
          name="description"
          defaultValue={project?.description}
          textarea
        />
        {error ? (
          <StorageConsent
            retryStorage={retryStorage}
            continueInMemory={continueInMemory}
          />
        ) : null}
        <div className={styles.dialogActions}>
          <DialogClose type="button">Cancel</DialogClose>
          <Button type="submit">Save project</Button>
        </div>
      </form>
    </Dialog>
  );
}
function TaskDialog({
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
  const { workspace, save, retryStorage, continueInMemory } = useWorkspace();
  const [error, setError] = useState("");
  const activeProjects = workspace.projects.filter(
    (project) => !project.archived || project.id === task?.projectId,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: TaskInput = {
      projectId: String(form.get("projectId")),
      title: String(form.get("title")),
      description: String(form.get("description")),
      status: String(form.get("status")) as TaskStatus,
    };
    try {
      const saved = save(
        task
          ? updateTask(workspace, task.id, input)
          : createTask(workspace, input),
      );
      if (!saved) {
        setError(
          "Could not save task. Choose a storage option before trying again.",
        );
        return;
      }
      setError("");
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save task.");
    }
  };
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      className={styles.dialog ?? ""}
    >
      <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
      <DialogDescription>
        Tasks stay attached to their original project in this demo.
      </DialogDescription>
      <form onSubmit={submit}>
        {task ? (
          <input type="hidden" name="projectId" value={task.projectId} />
        ) : null}
        <Select
          className={styles.field ?? ""}
          {...(!task ? { name: "projectId" } : {})}
          defaultValue={
            task?.projectId ??
            (activeProjects.some((project) => project.id === defaultProjectId)
              ? defaultProjectId
              : activeProjects[0]?.id) ??
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
            {activeProjects.map((project) => (
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
          error={error}
        />
        <Field
          label="Description"
          name="description"
          defaultValue={task?.description}
          textarea
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
        {error ? (
          <StorageConsent
            retryStorage={retryStorage}
            continueInMemory={continueInMemory}
          />
        ) : null}
        <div className={styles.dialogActions}>
          <DialogClose type="button">Cancel</DialogClose>
          <Button type="submit">{task ? "Save changes" : "Create task"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
function Field({
  label,
  name,
  defaultValue,
  required,
  textarea,
  error,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  textarea?: boolean | undefined;
  error?: string | undefined;
}) {
  const id = `field-${name}`;
  return (
    <div className={styles.field}>
      <Label htmlFor={id}>{label}</Label>
      {textarea ? (
        <Textarea id={id} name={name} defaultValue={defaultValue} rows={3} />
      ) : (
        <Input
          id={id}
          name={name}
          defaultValue={defaultValue}
          required={required}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      )}
      {error ? (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
function DeleteDialog({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange(open: boolean): void;
}) {
  const { workspace, save, storageError, retryStorage, continueInMemory } =
    useWorkspace();
  return (
    <AlertDialog
      isOpen={Boolean(task)}
      onOpenChange={onOpenChange}
      className={styles.dialog ?? ""}
    >
      <AlertDialogTitle>Delete this task?</AlertDialogTitle>
      <AlertDialogDescription>
        {task ? `“${task.title}” will be removed from this browser.` : ""}
      </AlertDialogDescription>
      {storageError ? (
        <>
          <p role="alert">{storageError} The task was not deleted.</p>
          <StorageConsent
            retryStorage={retryStorage}
            continueInMemory={continueInMemory}
          />
        </>
      ) : null}
      <div className={styles.dialogActions}>
        {/* Focus the least destructive action when the confirmation opens. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <AlertDialogCancel autoFocus>Keep task</AlertDialogCancel>
        {/* Do not use the close-slot Action: failed persistence must retain consent and focus. */}
        <Button
          variant="destructive"
          className="text-foreground"
          onPress={() => {
            if (task && save(deleteTask(workspace, task.id)))
              onOpenChange(false);
          }}
        >
          Delete task
        </Button>
      </div>
    </AlertDialog>
  );
}
export function SettingsPage() {
  const { reset, storageError, retryStorage, continueInMemory } =
    useWorkspace();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <PageHeader eyebrow="Demo controls" title="Settings" />
      <Card className={styles.panel}>
        <h2>Reset demo data</h2>
        <p>
          Restore the starter projects and tasks in this browser. This cannot be
          undone.
        </p>
        <Button variant="outline" onPress={() => setOpen(true)}>
          <HugeiconsIcon icon={RefreshIcon} size={16} />
          Reset data
        </Button>
      </Card>
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        className={styles.dialog ?? ""}
      >
        <AlertDialogTitle>Reset this demo workspace?</AlertDialogTitle>
        <AlertDialogDescription>
          Your locally stored projects and tasks will be replaced with the
          starter data.
        </AlertDialogDescription>
        {error || storageError ? (
          <>
            <p className={styles.error} role="alert">
              {error || storageError} The previous saved data is unchanged.
            </p>
            <StorageConsent
              retryStorage={retryStorage}
              continueInMemory={continueInMemory}
            />
          </>
        ) : null}
        <div className={styles.dialogActions}>
          {/* Focus the least destructive action when the confirmation opens. */}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            className="text-foreground"
            onPress={() => {
              if (!reset()) setError("Could not reset demo data.");
              else {
                setError("");
                setOpen(false);
              }
            }}
          >
            Reset demo data
          </Button>
        </div>
      </AlertDialog>
    </>
  );
}
export function NotFound() {
  return (
    <main className={styles.notFound}>
      <p className={styles.eyebrow}>404</p>
      <h1>That page is not in this workspace.</h1>
      <p>Use the overview to find your way back.</p>
      <Link className={buttonVariants()} to="/">
        Go to overview
      </Link>
    </main>
  );
}
export function RouteError({ error }: { error: Error }) {
  return (
    <main className={styles.notFound}>
      <p className={styles.eyebrow}>Something went wrong</p>
      <h1>We could not open this view.</h1>
      <p>{error.message}</p>
      <Link className={buttonVariants()} to="/">
        Return to overview
      </Link>
    </main>
  );
}
