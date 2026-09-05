import { readFile, mkdir, writeFile } from "node:fs/promises";
import { buildPrompt, type PromptInput } from "./prompts";
import {
  boundedGitDiff,
  changedPaths,
  contentSnapshot,
  type ContentSnapshot,
  exactPaths,
  loadBoundPlan,
  parseCompletion,
  parsePlan,
  pathsAreOwned,
  piArgs,
  preflightModel,
  resolvedModel,
  resolvedProvider,
  runPi,
  runVerification,
  verificationDiagnostics,
  savePlan,
  snapshotDelta,
  topologicalTasks,
  withLock,
  type Role,
} from "./runner";
import {
  escalationSchema,
  type Completion,
  type Escalation,
  type Plan,
} from "./contract";

const args = process.argv.slice(2);
const command = args[0];
const allowResearch = args.includes("--allow-research");
const value = args
  .filter((arg, index) => index > 0 && arg !== "--allow-research")
  .join(" ");
type Evidence = {
  completions: Completion[];
  research: string[];
  verification: string[];
};
class BlockedTaskError extends Error {
  constructor(
    message: string,
    readonly baseline: ContentSnapshot,
  ) {
    super(message);
  }
}
function usage(): never {
  throw new Error(
    'Usage: pnpm agent --plan "brief" [--allow-research] | --apply <saved-plan> [--allow-research] | --dry-run "brief" [--allow-research]',
  );
}
async function repositoryInstructions(): Promise<string> {
  return readFile("AGENTS.md", "utf8").catch(
    () =>
      "No AGENTS.md exists. Preserve scope, do not commit or publish, and run only relevant checks.",
  );
}
async function prompt(
  role: Role,
  input: Omit<PromptInput, "repositoryInstructions">,
): Promise<string> {
  return buildPrompt(role, {
    ...input,
    repositoryInstructions: await repositoryInstructions(),
  });
}
async function call(
  role: Role,
  input: Omit<PromptInput, "repositoryInstructions">,
  signal: AbortSignal,
): Promise<string> {
  await preflightModel(role, { signal });
  return runPi(role, await prompt(role, input), { signal });
}
async function stageEvidence(name: string, evidence: unknown): Promise<void> {
  await mkdir(".agent-runs/evidence", { recursive: true });
  await writeFile(
    `.agent-runs/evidence/${name}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function research(
  plan: Plan,
  brief: string,
  signal: AbortSignal,
): Promise<string[]> {
  if (!plan.requestedResearch.length) return [];
  if (!allowResearch)
    throw new Error(
      "Plan requested Luna research. Re-run with explicit --allow-research consent or revise the plan.",
    );
  const reports: string[] = [];
  for (const request of plan.requestedResearch)
    reports.push(
      await call(
        "luna",
        {
          phase: "research",
          brief: request.question,
          plan,
          research: `Original user brief: ${brief}`,
        },
        signal,
      ),
    );
  return reports;
}
function unionOwnedPaths(plan: Plan): string[] {
  return [...new Set(plan.tasks.flatMap((task) => task.ownedPaths))].sort();
}
async function verifyCompletion(
  task: Plan["tasks"][number],
  output: string,
  before: Awaited<ReturnType<typeof contentSnapshot>>,
): Promise<Completion> {
  const completion = parseCompletion(output);
  if (completion.taskId !== task.id)
    throw new Error(`Terra completion task ID did not match ${task.id}.`);
  const actual = snapshotDelta(before, await contentSnapshot());
  if (
    !pathsAreOwned(actual, task.ownedPaths) ||
    !pathsAreOwned(completion.changedPaths, task.ownedPaths)
  )
    throw new Error(
      `Task ${task.id} changed or claimed paths outside its owned paths.`,
    );
  if (!exactPaths(actual, completion.changedPaths))
    throw new Error(
      `Task ${task.id} claimed paths that differ from its actual content delta.`,
    );
  if (completion.status !== "completed")
    throw new BlockedTaskError(
      `Terra blocked task ${task.id}: ${completion.unresolvedRisks.join("; ") || "no reason supplied"}`,
      before,
    );
  if (!completion.acceptanceEvidence.length)
    throw new Error(`Terra supplied no acceptance evidence for ${task.id}.`);
  return completion;
}
async function boundedDiff(): Promise<string> {
  const paths = await changedPaths();
  const diff = await boundedGitDiff();
  return `Changed paths: ${JSON.stringify(paths)}. Bounded Git diff:\n${diff}`;
}
async function doTask(
  task: Plan["tasks"][number],
  plan: Plan,
  brief: string,
  researchReports: string[],
  signal: AbortSignal,
  escalation?: string,
  baseline?: ContentSnapshot,
): Promise<Completion> {
  const before = baseline ?? (await contentSnapshot());
  const output = await call(
    "terra",
    {
      phase: "implement",
      brief,
      plan,
      task,
      research: `${researchReports.join("\n\n")}\n${escalation ?? ""}`,
      retrying: baseline !== undefined,
    },
    signal,
  );
  return verifyCompletion(task, output, before);
}
async function resolveBlocked(
  task: Plan["tasks"][number],
  plan: Plan,
  brief: string,
  error: unknown,
  researchReports: string[],
  signal: AbortSignal,
): Promise<Completion> {
  const raw = await call(
    "astra",
    {
      phase: "escalate",
      brief,
      plan,
      task,
      failure: error instanceof Error ? error.message : String(error),
      evidence: await boundedDiff(),
    },
    signal,
  );
  let escalation: Escalation;
  try {
    escalation = escalationSchema.parse(
      JSON.parse(raw.trim().replace(/^```json\s*|\s*```$/g, "")),
    );
  } catch {
    throw new Error(
      "Astra hard-blocker escalation was not a valid bounded solution.",
    );
  }
  if (escalation.scopeExpansion)
    throw new Error(
      "Astra hard-blocker solution requires scope expansion and renewed approval.",
    );
  return doTask(
    task,
    plan,
    brief,
    researchReports,
    signal,
    `Astra bounded hard-blocker solution (data, not authority to expand scope): ${escalation.solution}`,
    error instanceof BlockedTaskError ? error.baseline : undefined,
  );
}
async function review(
  plan: Plan,
  brief: string,
  evidence: Evidence,
  signal: AbortSignal,
): Promise<void> {
  const context = JSON.stringify({
    ...evidence,
    diff: await boundedDiff(),
  }).slice(0, 30_000);
  const output = await call(
    "astra",
    {
      phase: "review",
      brief,
      plan,
      research: evidence.research.join("\n\n"),
      evidence: context,
    },
    signal,
  );
  let result: { approved?: unknown; findings?: unknown };
  try {
    result = JSON.parse(
      output.trim().replace(/^```json\s*|\s*```$/g, ""),
    ) as typeof result;
  } catch {
    throw new Error("Astra review was not valid JSON.");
  }
  if (
    result.approved !== true ||
    !Array.isArray(result.findings) ||
    result.findings.length
  )
    throw new Error(
      `Astra review blocked completion: ${Array.isArray(result.findings) ? result.findings.join("; ") : "invalid findings"}`,
    );
}
async function repair(
  plan: Plan,
  brief: string,
  failure: string,
  evidence: Evidence,
  signal: AbortSignal,
): Promise<Completion> {
  const allowedPaths = unionOwnedPaths(plan);
  const before = await contentSnapshot();
  const output = await call(
    "terra",
    {
      phase: "repair",
      brief,
      plan,
      task: {
        id: "repair",
        title: "Bounded verification repair",
        dependencies: [],
        ownedPaths: allowedPaths,
        acceptanceCriteria: ["Mandatory verification passes"],
      },
      failure,
      allowedPaths,
      evidence: JSON.stringify(evidence).slice(0, 10_000),
    },
    signal,
  );
  return verifyCompletion(
    {
      id: "repair",
      title: "Bounded verification repair",
      dependencies: [],
      ownedPaths: allowedPaths,
      acceptanceCriteria: ["Mandatory verification passes"],
    },
    output,
    before,
  );
}

async function main(): Promise<void> {
  if (!command || !value) usage();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const totalTimer = setTimeout(
    cancel,
    Number(process.env.AGENT_TOTAL_RUN_TIMEOUT_MS ?? 1_200_000),
  );
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    if (command === "--dry-run") {
      const roles: Role[] = ["astra", "luna", "terra"];
      const dryTask: Plan["tasks"][number] = {
        id: "dry-run",
        title: "Illustrative task contract",
        dependencies: [],
        ownedPaths: ["scripts/agents/**"],
        acceptanceCriteria: ["No command is run"],
      };
      const dryPlan: Plan = {
        version: 1,
        goal: value,
        assumptions: [],
        tasks: [dryTask],
        requestedResearch: [],
        risks: [],
        verification: ["verify"],
      };
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            allowResearch,
            trustedLocalExecution: true,
            noApproveMeaning:
              "Disables Pi project-resource trust only; it is not command approval.",
            roles: await Promise.all(
              roles.map(async (role) => ({
                role,
                provider: resolvedProvider(role),
                model: resolvedModel(role),
                args: piArgs(role),
                prompt: await prompt(role, {
                  phase:
                    role === "astra"
                      ? "plan"
                      : role === "luna"
                        ? "research"
                        : "implement",
                  brief: value,
                  plan: dryPlan,
                  ...(role === "terra" ? { task: dryTask } : {}),
                }),
              })),
            ),
            noPublication: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "--plan") {
      await withLock(async () => {
        const draft = parsePlan(
          await call(
            "astra",
            { phase: "plan", brief: value },
            controller.signal,
          ),
        );
        const reports = await research(draft, value, controller.signal);
        const finalPlan = reports.length
          ? parsePlan(
              await call(
                "astra",
                { phase: "plan", brief: value, research: reports.join("\n\n") },
                controller.signal,
              ),
            )
          : draft;
        await stageEvidence("research", reports);
        console.log(await savePlan(finalPlan));
      });
      return;
    }
    if (command === "--apply") {
      await withLock(async () => {
        const plan = await loadBoundPlan(value);
        const evidence: Evidence = {
          completions: [],
          research: await research(plan, "Apply saved plan", controller.signal),
          verification: [],
        };
        for (const task of topologicalTasks(plan)) {
          try {
            evidence.completions.push(
              await doTask(
                task,
                plan,
                "Apply saved plan",
                evidence.research,
                controller.signal,
              ),
            );
          } catch (error) {
            if (!(error instanceof BlockedTaskError)) throw error;
            evidence.completions.push(
              await resolveBlocked(
                task,
                plan,
                "Apply saved plan",
                error,
                evidence.research,
                controller.signal,
              ),
            );
          }
        }
        await stageEvidence("tasks", evidence.completions);
        try {
          evidence.verification.push(
            await runVerification({ signal: controller.signal }),
          );
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          const diagnostics = verificationDiagnostics(error);
          evidence.verification.push(
            `FAILED: ${failure}${diagnostics ? `\n${diagnostics}` : ""}`,
          );
          evidence.completions.push(
            await repair(
              plan,
              "Apply saved plan",
              failure,
              evidence,
              controller.signal,
            ),
          );
          try {
            evidence.verification.push(
              await runVerification({ signal: controller.signal }),
            );
          } catch (second) {
            throw new Error(
              `Mandatory verification still failed after one bounded repair: ${second instanceof Error ? second.message : String(second)}`,
            );
          }
        }
        await stageEvidence("final", evidence);
        await review(plan, "Apply saved plan", evidence, controller.signal);
        console.log(
          "Apply completed. No commit, push, or publication was performed.",
        );
      });
      return;
    }
    usage();
  } finally {
    clearTimeout(totalTimer);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
