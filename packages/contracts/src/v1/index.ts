import { z } from "zod";

// Wire schemas intentionally do not import core or database models.
export const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
const text = z
  .string()
  .refine(
    (value) => !value.includes(String.fromCharCode(0)),
    "NUL is not supported.",
  );
const id = text.min(1).max(128);
/** Required on all workspace requests; capture from the dispatching session lease. */
export const expectedSessionHeader = "X-Expected-Session-Id" as const;
export const expectedSessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export type WorkspaceSessionHeaders = { [expectedSessionHeader]: string };
const projectFields = {
  name: text.trim().min(2).max(60),
  description: text.trim().max(280),
};
const taskFields = {
  projectId: id,
  title: text.trim().min(2).max(120),
  description: text.trim().max(500),
  status: z.enum(["todo", "in_progress", "done"]),
};
export const createProjectSchema = z.strictObject({
  ...projectFields,
  expectedRevision: revisionSchema,
});
export const updateProjectSchema = createProjectSchema.extend({
  archived: z.boolean(),
});
export const createTaskSchema = z.strictObject({
  ...taskFields,
  expectedRevision: revisionSchema,
});
export const updateTaskSchema = createTaskSchema;
export const deleteProjectSchema = z.strictObject({
  confirm: z.string().min(2).max(60),
});
export const projectSchema = z.strictObject({
  ...projectFields,
  id,
  archived: z.boolean(),
});
export const taskSchema = z.strictObject({
  ...taskFields,
  id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workspaceSchema = z.strictObject({
  revision: revisionSchema,
  projects: z.array(projectSchema).max(100),
  tasks: z.array(taskSchema).max(1000),
});
export const sessionSchema = z.strictObject({
  sessionId: id,
  user: z.strictObject({ id, name: z.string(), email: z.email() }),
});
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.uuid(),
  }),
});
export const exportSchema = z
  .strictObject({
    version: z.literal(1),
    workspace: workspaceSchema.omit({ revision: true }),
  })
  .superRefine((value, ctx) => {
    const { projects, tasks } = value.workspace;
    const ids = new Set(projects.map((project) => project.id));
    if (
      ids.size !== projects.length ||
      new Set(tasks.map((task) => task.id)).size !== tasks.length ||
      tasks.some((task) => !ids.has(task.projectId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid workspace references.",
      });
  });
export const importSchema = z.strictObject({
  expectedRevision: revisionSchema,
  data: exportSchema,
});
export const receiptSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  importedRevision: revisionSchema,
});
export const receiptResultSchema = z.strictObject({
  receipt: receiptSchema.nullable(),
});
export const importResultSchema = z.strictObject({
  workspace: workspaceSchema,
  receipt: receiptSchema,
});
export const rollbackSchema = z.strictObject({
  expectedRevision: revisionSchema,
  fingerprint: receiptSchema.shape.fingerprint,
});
export type ExportDto = z.infer<typeof exportSchema>;
export type ImportResultDto = z.infer<typeof importResultSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ProjectInput =
  z.infer<typeof createProjectSchema> extends infer T
    ? Omit<T, "expectedRevision">
    : never;
export type TaskInput = Omit<
  z.infer<typeof createTaskSchema>,
  "expectedRevision"
>;
export type TaskStatus = Task["status"];
export const taskStatuses = ["todo", "in_progress", "done"] as const;
export type WorkspaceDto = z.infer<typeof workspaceSchema>;
export type SessionDto = z.infer<typeof sessionSchema>;
export function parseIfMatch(value: string | undefined): number {
  if (!value || !/^"(?:0|[1-9][0-9]*)"$/.test(value))
    throw new Error("A quoted workspace revision is required.");
  return revisionSchema.parse(Number(value.slice(1, -1)));
}
