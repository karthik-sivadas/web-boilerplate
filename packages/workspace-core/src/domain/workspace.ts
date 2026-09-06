import { z } from "zod";

export const limits = {
  projects: 100,
  tasks: 1000,
  bytes: 2 * 1024 * 1024,
} as const;
export const statuses = ["todo", "in_progress", "done"] as const;
const text = z
  .string()
  .refine(
    (value) => !value.includes(String.fromCharCode(0)),
    "NUL is not supported.",
  );
const id = text.min(1).max(128);
export const projectInputSchema = z.strictObject({
  name: text.trim().min(2).max(60),
  description: text.trim().max(280),
});
export const taskInputSchema = z.strictObject({
  projectId: id,
  title: text.trim().min(2).max(120),
  description: text.trim().max(500),
  status: z.enum(statuses),
});
export const projectSchema = projectInputSchema.extend({
  id,
  archived: z.boolean(),
});
export const taskSchema = taskInputSchema.extend({
  id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workspaceSchema = z
  .strictObject({
    revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    projects: z.array(projectSchema).max(limits.projects),
    tasks: z.array(taskSchema).max(limits.tasks),
  })
  .superRefine((state, ctx) => {
    const projects = new Set(state.projects.map((p) => p.id));
    if (
      projects.size !== state.projects.length ||
      new Set(state.tasks.map((t) => t.id)).size !== state.tasks.length ||
      state.tasks.some((t) => !projects.has(t.projectId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid workspace references.",
      });
    // JSON escaping (including control characters) matters more than character counts.
    // Count UTF-8 without a browser/Node dependency; reserve space for import metadata.
    const json = JSON.stringify(state);
    let bytes = 0;
    for (const char of json) {
      const point = char.codePointAt(0)!;
      bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
    if (bytes > limits.bytes - 4096)
      ctx.addIssue({
        code: "custom",
        message: "Workspace export byte limit exceeded.",
      });
  });
export type Workspace = z.infer<typeof workspaceSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type Command =
  | { type: "createProject"; input: ProjectInput }
  | {
      type: "updateProject";
      id: string;
      input: ProjectInput & { archived: boolean };
    }
  | { type: "deleteProject"; id: string; confirm: string }
  | { type: "createTask"; input: TaskInput }
  | { type: "updateTask"; id: string; input: TaskInput }
  | { type: "deleteTask"; id: string };
export type FailureCode =
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "RULE_VIOLATION"
  | "VALIDATION";
export class WorkspaceFailure extends Error {
  constructor(
    public readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}
export interface Values {
  id(): string;
  now(): string;
}
export const emptyWorkspace = (): Workspace => ({
  revision: 0,
  projects: [],
  tasks: [],
});
export function transition(
  current: Workspace,
  command: Command,
  values: Values,
): Workspace {
  const state = workspaceSchema.parse(current);
  const missing = () =>
    new WorkspaceFailure("NOT_FOUND", "Resource not found.");
  switch (command.type) {
    case "createProject":
      state.projects.push({
        ...projectInputSchema.parse(command.input),
        id: values.id(),
        archived: false,
      });
      break;
    case "updateProject": {
      const project = state.projects.find((p) => p.id === command.id);
      if (!project) throw missing();
      Object.assign(
        project,
        projectInputSchema.parse({
          name: command.input.name,
          description: command.input.description,
        }),
        { archived: z.boolean().parse(command.input.archived) },
      );
      break;
    }
    case "deleteProject": {
      const project = state.projects.find((p) => p.id === command.id);
      if (!project) throw missing();
      if (command.confirm !== project.name)
        throw new WorkspaceFailure(
          "RULE_VIOLATION",
          "Confirm the exact project name.",
        );
      state.projects = state.projects.filter((p) => p.id !== command.id);
      state.tasks = state.tasks.filter((t) => t.projectId !== command.id);
      break;
    }
    case "createTask": {
      const input = taskInputSchema.parse(command.input);
      const project = state.projects.find((p) => p.id === input.projectId);
      if (!project) throw missing();
      if (project.archived)
        throw new WorkspaceFailure(
          "RULE_VIOLATION",
          "Archived projects cannot receive new tasks.",
        );
      const now = values.now();
      state.tasks.push({
        ...input,
        id: values.id(),
        createdAt: now,
        updatedAt: now,
      });
      break;
    }
    case "updateTask": {
      const task = state.tasks.find((t) => t.id === command.id);
      if (!task) throw missing();
      const input = taskInputSchema.parse(command.input);
      if (input.projectId !== task.projectId)
        throw new WorkspaceFailure(
          "RULE_VIOLATION",
          "Tasks cannot move projects.",
        );
      Object.assign(task, input, { updatedAt: values.now() });
      break;
    }
    case "deleteTask": {
      if (!state.tasks.some((t) => t.id === command.id)) throw missing();
      state.tasks = state.tasks.filter((t) => t.id !== command.id);
      break;
    }
  }
  state.revision++;
  return workspaceSchema.parse(state);
}
