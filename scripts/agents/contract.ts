import { z } from "zod";

export const verificationIds = [
  "format",
  "lint",
  "typecheck",
  "test",
  "coverage",
  "build",
  "e2e",
  "verify",
] as const;
const safePath = z
  .string()
  .regex(
    /^(?!\/|\.git(?:\/|$)|\.agent-runs(?:\/|$)|.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./$*-]+$/,
    "Unsafe repository path.",
  );
export const planSchema = z
  .object({
    version: z.literal(1),
    goal: z.string().min(1).max(800),
    assumptions: z.array(z.string().min(1).max(300)).max(12),
    tasks: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            title: z.string().min(1).max(160),
            dependencies: z.array(z.string()).max(6),
            ownedPaths: z.array(safePath).min(1).max(20),
            acceptanceCriteria: z
              .array(z.string().min(1).max(300))
              .min(1)
              .max(10),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    requestedResearch: z
      .array(z.object({ question: z.string().min(1).max(400) }).strict())
      .max(4),
    risks: z.array(z.string().max(300)).max(12),
    verification: z.array(z.enum(verificationIds)).min(1).max(8),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export const completionSchema = z
  .object({
    version: z.literal(1),
    taskId: z.string().regex(/^[a-z0-9-]+$/),
    status: z.enum(["completed", "blocked"]),
    changedPaths: z.array(safePath).max(100),
    acceptanceEvidence: z.array(z.string().min(1).max(500)).max(20),
    checksRun: z.array(z.enum(verificationIds)).max(8),
    unresolvedRisks: z.array(z.string().max(300)).max(12),
  })
  .strict();
export type Completion = z.infer<typeof completionSchema>;
export const escalationSchema = z
  .object({
    solution: z.string().min(1).max(4000),
    scopeExpansion: z.boolean(),
  })
  .strict();
export type Escalation = z.infer<typeof escalationSchema>;
export function validatePlan(value: unknown): Plan {
  const plan = planSchema.parse(value);
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of plan.tasks)
    for (const dependency of task.dependencies)
      if (!ids.has(dependency) || dependency === task.id)
        throw new Error(`Invalid dependency in ${task.id}`);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Plan dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of plan.tasks.find((task) => task.id === id)
      ?.dependencies ?? [])
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of plan.tasks) visit(task.id);
  return plan;
}
