import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  ChevronRight,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Link, useLocation } from "@tanstack/react-router";
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
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  useEffect(() => {
    const result = loadWorkspace(getBrowserStorage());
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
  }, []);
  if (!state)
    return (
      <main className={styles.loading} aria-live="polite">
        Loading your demo workspace…
      </main>
    );
  const retryStorage = () => {
    const result = loadWorkspace(getBrowserStorage());
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
      if (!current) return current;
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
      const result = resetWorkspace(getBrowserStorage());
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
        <button className="button" onClick={resetRecovery}>
          Reset to safe demo data
        </button>
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
    if (state.persistence === "memory") {
      setState({ workspace, persistence: "memory" });
      return true;
    }
    const result = saveWorkspace(getBrowserStorage(), workspace);
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
    if (state.persistence === "memory") {
      setState({ workspace: structuredCloneFallback(), persistence: "memory" });
      return true;
    }
    const result = resetWorkspace(getBrowserStorage());
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
      <button type="button" className="button secondary" onClick={retryStorage}>
        Retry storage
      </button>
      <button type="button" className="button" onClick={continueInMemory}>
        Continue in memory
      </button>
    </div>
  );
}
function structuredCloneFallback(): Workspace {
  return structuredClone(demoWorkspace);
}

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/settings", label: "Demo settings", icon: RotateCcw },
];
export function WorkspaceShell({ children }: { children: ReactNode }) {
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
                  <Icon size={18} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className={styles.sidebarNote}>
          A focused starting point for small teams.
        </p>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.mobileHeader}>
          <Link to="/" className={styles.brand}>
            <span>W</span> Workbench
          </Link>
          <nav aria-label="Mobile workspace">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} aria-label={label}>
                <Icon size={20} />
              </Link>
            ))}
          </nav>
        </header>
        <div className={styles.banner}>
          Demo workspace — data is stored only in this browser. No account or
          cloud sync.
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
          <article key={String(label)} className={styles.metric}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
      <section className={styles.twoColumn}>
        <article className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>Next up</p>
              <h2>Recent tasks</h2>
            </div>
            <Link to="/tasks" search={{ project: undefined }}>
              View all <ChevronRight size={16} />
            </Link>
          </div>
          <TaskList
            tasks={workspace.tasks.slice(0, 4)}
            projects={projectById}
          />
        </article>
        <article className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>At a glance</p>
              <h2>Projects</h2>
            </div>
            <Link to="/projects">
              Manage <ChevronRight size={16} />
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
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </article>
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
        <button className="button" onClick={() => setOpen(true)}>
          <Plus size={17} />
          New project
        </button>
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
    <article className={styles.projectCard}>
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
          Open <ChevronRight size={16} />
        </Link>
      </footer>
    </article>
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
          <button className="button secondary" onClick={() => setEditing(true)}>
            Rename
          </button>
          <button
            className="button secondary"
            onClick={() =>
              save(setProjectArchived(workspace, project.id, !project.archived))
            }
          >
            <Archive size={16} />
            {project.archived ? "Unarchive" : "Archive"}
          </button>
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
      <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <h2>Tasks</h2>
          <Link to="/tasks" search={{ project: project.id }}>
            View in tasks <ChevronRight size={16} />
          </Link>
        </div>
        <TaskList tasks={tasks} projects={new Map([[project.id, project]])} />
      </section>
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
        <button className="button" data-new-task onClick={() => setOpen(true)}>
          <Plus size={17} />
          New task
        </button>
      </PageHeader>
      <section className={styles.filters} aria-label="Task filters">
        <label>
          <Search size={17} />
          <span className="sr-only">Search tasks</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
          />
        </label>
        <select
          aria-label="Filter by project"
          value={selectedProjectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">All projects</option>
          {workspace.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as TaskStatus | "")}
        >
          <option value="">All statuses</option>
          {taskStatuses.map((item) => (
            <option key={item} value={item}>
              {statusLabel(item)}
            </option>
          ))}
        </select>
      </section>
      <section className={styles.panel}>
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
      </section>
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
        <ClipboardList size={26} />
        <h3>No tasks here yet</h3>
        <p>Try adjusting the filters or create a focused next step.</p>
      </div>
    );
  return (
    <>
      <ul className={styles.taskList}>
        {tasks.map((task) => (
          <li key={task.id}>
            <span className={`${styles.status} ${styles[task.status]}`}>
              <span aria-hidden="true" />
              {statusLabel(task.status)}
            </span>
            <div>
              <b>{task.title}</b>
              <small>
                {projects.get(task.projectId)?.name ?? "Unknown project"}
                {task.description ? ` · ${task.description}` : ""}
              </small>
            </div>
            {editable ? (
              <div className={styles.rowActions}>
                <button onClick={() => setEditing(task)}>Edit</button>
                <button
                  className={styles.dangerText}
                  onClick={() => setDeleting(task)}
                  aria-label={`Delete ${task.title}`}
                >
                  <Trash2 size={16} />
                </button>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <Dialog.Title>
            {project ? "Rename project" : "New project"}
          </Dialog.Title>
          <Dialog.Description>
            Keep this concise and clear for your team.
          </Dialog.Description>
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
              <Dialog.Close asChild>
                <button type="button" className="button secondary">
                  Cancel
                </button>
              </Dialog.Close>
              <button className="button" type="submit">
                Save project
              </button>
            </div>
          </form>
          <Dialog.Close className={styles.close} aria-label="Close">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          onCloseAutoFocus={(event) => {
            if (!task) {
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>("[data-new-task]")
                ?.focus();
            }
          }}
        >
          <Dialog.Title>{task ? "Edit task" : "New task"}</Dialog.Title>
          <Dialog.Description>
            Tasks stay attached to their original project in this demo.
          </Dialog.Description>
          <form onSubmit={submit}>
            <label className={styles.field}>
              Project
              {task ? (
                <input type="hidden" name="projectId" value={task.projectId} />
              ) : null}
              <select
                name={task ? undefined : "projectId"}
                defaultValue={task?.projectId ?? defaultProjectId}
                disabled={Boolean(task)}
              >
                {activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
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
            <label className={styles.field}>
              Status
              <select name="status" defaultValue={task?.status ?? "todo"}>
                {taskStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <StorageConsent
                retryStorage={retryStorage}
                continueInMemory={continueInMemory}
              />
            ) : null}
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className="button secondary">
                  Cancel
                </button>
              </Dialog.Close>
              <button className="button" type="submit">
                {task ? "Save changes" : "Create task"}
              </button>
            </div>
          </form>
          <Dialog.Close className={styles.close} aria-label="Close">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <label className={styles.field} htmlFor={id}>
      {label}
      {textarea ? (
        <textarea id={id} name={name} defaultValue={defaultValue} rows={3} />
      ) : (
        <input
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
    </label>
  );
}
function DeleteDialog({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange(open: boolean): void;
}) {
  const { workspace, save } = useWorkspace();
  return (
    <AlertDialog.Root open={Boolean(task)} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content className={styles.dialog}>
          <AlertDialog.Title>Delete this task?</AlertDialog.Title>
          <AlertDialog.Description>
            {task ? `“${task.title}” will be removed from this browser.` : ""}
          </AlertDialog.Description>
          <div className={styles.dialogActions}>
            <AlertDialog.Cancel asChild>
              <button className="button secondary">Keep task</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="button danger"
                onClick={(event) => {
                  if (task && !save(deleteTask(workspace, task.id)))
                    event.preventDefault();
                }}
              >
                Delete task
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
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
      <section className={styles.panel}>
        <h2>Reset demo data</h2>
        <p>
          Restore the starter projects and tasks in this browser. This cannot be
          undone.
        </p>
        <button className="button danger" onClick={() => setOpen(true)}>
          <RotateCcw size={16} />
          Reset data
        </button>
      </section>
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.overlay} />
          <AlertDialog.Content className={styles.dialog}>
            <AlertDialog.Title>Reset this demo workspace?</AlertDialog.Title>
            <AlertDialog.Description>
              Your locally stored projects and tasks will be replaced with the
              starter data.
            </AlertDialog.Description>
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
              <AlertDialog.Cancel asChild>
                <button className="button secondary">Cancel</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="button danger"
                  onClick={(event) => {
                    if (!reset()) {
                      event.preventDefault();
                      setError("Could not reset demo data.");
                    }
                  }}
                >
                  Reset demo data
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
export function NotFound() {
  return (
    <main className={styles.notFound}>
      <p className={styles.eyebrow}>404</p>
      <h1>That page is not in this workspace.</h1>
      <p>Use the overview to find your way back.</p>
      <Link className="button" to="/">
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
      <Link className="button" to="/">
        Return to overview
      </Link>
    </main>
  );
}
