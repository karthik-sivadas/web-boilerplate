import { z } from "zod";

export const taskStatuses = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(2, "Use at least 2 characters.").max(60),
    description: z.string().trim().max(280),
    archived: z.boolean(),
  })
  .strict();
export const taskSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string().trim().min(2, "Use at least 2 characters.").max(120),
    description: z.string().trim().max(500),
    status: z.enum(taskStatuses),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const workspaceSchema = z
  .object({ projects: z.array(projectSchema), tasks: z.array(taskSchema) })
  .strict()
  .superRefine((value, ctx) => {
    const projectIds = new Set<string>();
    for (const [index, project] of value.projects.entries()) {
      if (projectIds.has(project.id))
        ctx.addIssue({
          code: "custom",
          message: "Project IDs must be unique.",
          path: ["projects", index, "id"],
        });
      projectIds.add(project.id);
    }
    const taskIds = new Set<string>();
    for (const [index, task] of value.tasks.entries()) {
      if (taskIds.has(task.id))
        ctx.addIssue({
          code: "custom",
          message: "Task IDs must be unique.",
          path: ["tasks", index, "id"],
        });
      taskIds.add(task.id);
      if (!projectIds.has(task.projectId))
        ctx.addIssue({
          code: "custom",
          message: "A task refers to an unknown project.",
          path: ["tasks", index, "projectId"],
        });
    }
  });
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export const projectInputSchema = projectSchema
  .pick({ name: true, description: true })
  .strict();
export const taskInputSchema = taskSchema
  .pick({ projectId: true, title: true, description: true, status: true })
  .strict();
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;

const stamp = "2026-01-15T09:00:00.000Z";
export const demoWorkspace: Workspace = {
  projects: [
    {
      id: "p-foundation",
      name: "Foundation refresh",
      description: "Give the team a calm, dependable place to start.",
      archived: false,
    },
    {
      id: "p-research",
      name: "Customer research",
      description: "Capture insights from discovery calls.",
      archived: false,
    },
    {
      id: "p-archive",
      name: "Completed experiments",
      description: "A record of earlier explorations.",
      archived: true,
    },
  ],
  tasks: [
    {
      id: "t-brief",
      projectId: "p-foundation",
      title: "Review the implementation brief",
      description: "Align the workspace around the smallest useful scope.",
      status: "done",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "t-shell",
      projectId: "p-foundation",
      title: "Shape the workspace shell",
      description: "Make navigation clear on desktop and mobile.",
      status: "in_progress",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "t-interviews",
      projectId: "p-research",
      title: "Synthesize five interview notes",
      description: "Pull themes into a shareable summary.",
      status: "todo",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
};

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
export function createProject(
  workspace: Workspace,
  input: ProjectInput,
): Workspace {
  workspaceSchema.parse(workspace);
  const project = projectSchema.parse({
    ...projectInputSchema.parse(input),
    id: createId("project"),
    archived: false,
  });
  return { ...workspace, projects: [...workspace.projects, project] };
}
export function renameProject(
  workspace: Workspace,
  id: string,
  input: ProjectInput,
): Workspace {
  workspaceSchema.parse(workspace);
  if (!workspace.projects.some((project) => project.id === id))
    throw new Error("Project not found.");
  const parsed = projectInputSchema.parse(input);
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === id
        ? projectSchema.parse({ ...project, ...parsed, id: project.id })
        : project,
    ),
  };
}
export function setProjectArchived(
  workspace: Workspace,
  id: string,
  archived: boolean,
): Workspace {
  workspaceSchema.parse(workspace);
  if (!workspace.projects.some((project) => project.id === id))
    throw new Error("Project not found.");
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === id ? { ...project, archived } : project,
    ),
  };
}
export function createTask(
  workspace: Workspace,
  input: TaskInput,
  now = new Date().toISOString(),
): Workspace {
  workspaceSchema.parse(workspace);
  const parsedInput = taskInputSchema.parse(input);
  const project = workspace.projects.find(
    (item) => item.id === parsedInput.projectId,
  );
  if (!project) throw new Error("Choose an existing project.");
  if (project.archived)
    throw new Error("Archived projects cannot receive new tasks.");
  const task = taskSchema.parse({
    ...parsedInput,
    id: createId("task"),
    createdAt: now,
    updatedAt: now,
  });
  return { ...workspace, tasks: [...workspace.tasks, task] };
}
export function updateTask(
  workspace: Workspace,
  id: string,
  input: TaskInput,
  now = new Date().toISOString(),
): Workspace {
  workspaceSchema.parse(workspace);
  const parsedInput = taskInputSchema.parse(input);
  const existing = workspace.tasks.find((task) => task.id === id);
  if (!existing) throw new Error("Task not found.");
  if (existing.projectId !== parsedInput.projectId)
    throw new Error("Tasks cannot move projects in this demo.");
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === id
        ? taskSchema.parse({
            ...task,
            ...parsedInput,
            id: task.id,
            createdAt: task.createdAt,
            updatedAt: now,
          })
        : task,
    ),
  };
}
export function deleteTask(workspace: Workspace, id: string): Workspace {
  workspaceSchema.parse(workspace);
  return {
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== id),
  };
}
export function filterTasks(
  workspace: Workspace,
  filters: {
    query?: string | undefined;
    projectId?: string | undefined;
    status?: TaskStatus | undefined;
  },
): Task[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return workspace.tasks.filter(
    (task) =>
      (!query ||
        `${task.title} ${task.description}`.toLowerCase().includes(query)) &&
      (!filters.projectId || task.projectId === filters.projectId) &&
      (!filters.status || task.status === filters.status),
  );
}
export function getOverview(workspace: Workspace) {
  return {
    projects: workspace.projects.filter((project) => !project.archived).length,
    tasks: workspace.tasks.length,
    done: workspace.tasks.filter((task) => task.status === "done").length,
    inProgress: workspace.tasks.filter((task) => task.status === "in_progress")
      .length,
  };
}
