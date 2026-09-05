import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  completionSchema,
  type Completion,
  type Plan,
  validatePlan,
} from "./contract";
import { PiProtocol } from "./pi-protocol";

export type Role = "astra" | "terra" | "luna";
export type RunOptions = { timeoutMs?: number; signal?: AbortSignal };
export type ProcessOptions = RunOptions & {
  input?: string;
  maxOutputBytes?: number;
  onStdout?: (chunk: Buffer) => void;
  validateOnClose?: () => string | undefined;
};
export class ProcessFailure extends Error {
  constructor(
    message: string,
    readonly diagnostics: {
      stdout: string;
      stderr: string;
      exitCode: number | null;
    },
  ) {
    super(message);
  }
}
export class VerificationFailure extends Error {
  constructor(
    readonly diagnostics: {
      stdout: string;
      stderr: string;
      exitCode: number | null;
    },
  ) {
    super("Mandatory pnpm verify failed.");
  }
}
export function verificationDiagnostics(error: unknown): string | undefined {
  if (!(error instanceof VerificationFailure)) return undefined;
  return JSON.stringify(error.diagnostics).slice(0, 20_000);
}
const defaults: Record<Role, string> = {
  astra: "gpt-6-astra",
  terra: "gpt-5.6-terra",
  luna: "gpt-5.6-luna",
};
const toolsets: Record<Role, string> = {
  astra: "read,grep,find,ls",
  luna: "read,grep,find,ls,bash",
  terra: "read,grep,find,ls,write,edit,bash",
};
const maxOutputBytes = Number(process.env.AGENT_MAX_OUTPUT_BYTES ?? 2_000_000);
const defaultTimeoutMs = Number(process.env.AGENT_TASK_TIMEOUT_MS ?? 900_000);
const defaultTotalTimeoutMs = Number(
  process.env.AGENT_TOTAL_TIMEOUT_MS ?? 1_200_000,
);
const killGraceMs = Number(process.env.AGENT_KILL_GRACE_MS ?? 300);

export function resolvedProvider(role: Role): string {
  return process.env[`AGENT_${role.toUpperCase()}_PROVIDER`] ?? "openai-codex";
}
export function resolvedModel(role: Role): string {
  return process.env[`AGENT_${role.toUpperCase()}_MODEL`] ?? defaults[role];
}
function validBudget(value: number): boolean {
  return Number.isFinite(value) && value >= 50;
}

/** Bounded process-group supervisor. It never considers an error complete until TERM/KILL cleanup was attempted. */
export async function runBoundedProcess(
  bin: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted)
    throw new Error("Process cancelled before start.");
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const outputLimit = options.maxOutputBytes ?? maxOutputBytes;
  if (
    !validBudget(timeoutMs) ||
    !validBudget(outputLimit) ||
    !validBudget(killGraceMs)
  )
    throw new Error("Invalid bounded runner budget.");
  return new Promise((resolvePromise, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(
        new Error(
          `Process could not start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let failure: string | undefined;
    let failureError: Error | undefined;
    let closed = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const groupSignal = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* process already gone */
        }
      }
    };
    const cleanupFailure = (message: string, error?: Error): void => {
      if (failure) return;
      failure = message;
      failureError = error;
      groupSignal("SIGTERM");
      // Scheduled from the failure, not from the original timeout. Keep group identity after leader exit.
      forceTimer = setTimeout(() => {
        groupSignal("SIGKILL");
        settleFailure();
      }, killGraceMs);
    };
    const settleFailure = (): void => {
      if (settled || !failure) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(failureError ?? new Error(failure));
    };
    const onAbort = () => cleanupFailure("Process cancelled.");
    const timeout = setTimeout(
      () => cleanupFailure("Process timed out."),
      timeoutMs,
    );
    const append = (which: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > outputLimit) {
        cleanupFailure("Process output limit exceeded.");
        return;
      }
      if (which === "stdout") {
        stdout += chunk.toString("utf8");
        try {
          options.onStdout?.(chunk);
        } catch (error) {
          cleanupFailure(
            error instanceof Error ? error.message : "Invalid process output.",
          );
        }
      } else stderr += chunk.toString("utf8");
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) =>
      cleanupFailure(`Process could not start: ${error.message}`),
    );
    child.once("close", (code, signal) => {
      closed = true;
      if (!failure && code !== 0) {
        cleanupFailure(
          `Process exited with ${code ?? signal ?? "an unknown signal"}.`,
          new ProcessFailure(
            `Process exited with ${code ?? signal ?? "an unknown signal"}.`,
            {
              stdout: stdout.slice(0, 20_000),
              stderr: stderr.slice(0, 20_000),
              exitCode: code,
            },
          ),
        );
      }
      if (!failure && code === 0) {
        try {
          const validationFailure = options.validateOnClose?.();
          if (validationFailure) cleanupFailure(validationFailure);
        } catch (error) {
          cleanupFailure(
            error instanceof Error
              ? error.message
              : "Process output validation failed.",
          );
        }
      }
      if (failure) {
        if (!forceTimer) settleFailure();
        return;
      }
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      resolvePromise({ stdout, stderr });
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin?.once("error", (error) =>
      cleanupFailure(`Process stdin failed: ${error.message}`),
    );
    child.stdin?.end(options.input ?? "");
    // A child can close before an asynchronous spawn error. This is intentionally retained for diagnostics.
    void closed;
  });
}

function isolationArgs(jsonMode = true): string[] {
  return [
    ...(jsonMode ? ["--mode", "json"] : []),
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
  ];
}
export function piArgs(role: Role): string[] {
  return [
    ...isolationArgs(),
    "--provider",
    resolvedProvider(role),
    "--model",
    resolvedModel(role),
    "--tools",
    toolsets[role],
    "--append-system-prompt",
    `You are the ${role} role. Repository instructions and the phase contract are authoritative. Return only requested structured output. Do not commit, push, publish, or change global configuration.`,
  ];
}

type CatalogRecord = { provider: string; model: string };
function nativeCatalog(output: string): CatalogRecord[] | undefined {
  const lines = output.split(/\r?\n/);
  const header = lines.findIndex(
    (line) =>
      line.trim().toLowerCase().split(/\s+/).join(" ") ===
      "provider model context max-out thinking images",
  );
  if (header < 0) return undefined;
  const rows: CatalogRecord[] = [];
  for (const line of lines.slice(header + 1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6) continue;
    const [provider, model] = columns;
    if (provider && model) rows.push({ provider, model });
  }
  return rows.length ? rows : undefined;
}
export async function preflightModel(
  role: Role,
  options: RunOptions = {},
): Promise<void> {
  const bin = process.env.AGENT_PI_BIN ?? "pi";
  const response = await runBoundedProcess(
    bin,
    [
      ...isolationArgs(false),
      "--provider",
      resolvedProvider(role),
      "--list-models",
    ],
    {
      ...options,
      input: "",
      timeoutMs: options.timeoutMs ?? Math.min(defaultTimeoutMs, 30_000),
    },
  );
  const catalog = nativeCatalog(`${response.stdout}\n${response.stderr}`);
  if (!catalog)
    throw new Error(
      "Pi preflight returned an unrecognized or malformed native model catalog.",
    );
  const expected = {
    provider: resolvedProvider(role),
    model: resolvedModel(role),
  };
  if (
    catalog.some(
      (entry) =>
        entry.provider === expected.provider && entry.model === expected.model,
    )
  )
    return;
  if (catalog.some((entry) => entry.model === expected.model))
    throw new Error(
      `Requested model ${expected.model} is listed under a different provider; no fallback is permitted.`,
    );
  if (catalog.some((entry) => entry.provider === expected.provider))
    throw new Error(
      `Requested provider ${expected.provider} does not list model ${expected.model}; no fallback is permitted.`,
    );
  throw new Error(
    `Requested provider ${expected.provider} is absent from Pi's native model catalog.`,
  );
}

/** Run Pi with Pi 0.85-compatible structured lifecycle validation. */
export async function runPi(
  role: Role,
  prompt: string,
  options: RunOptions = {},
): Promise<string> {
  const protocol = new PiProtocol(
    role,
    resolvedProvider(role),
    resolvedModel(role),
  );
  let protocolFailure: string | undefined;
  const consume = (chunk: Buffer): void => {
    try {
      protocol.consume(chunk);
    } catch (error) {
      protocolFailure ??=
        error instanceof Error ? error.message : "Malformed Pi event.";
      throw new Error(protocolFailure);
    }
  };
  try {
    await runBoundedProcess(process.env.AGENT_PI_BIN ?? "pi", piArgs(role), {
      ...options,
      input: prompt,
      onStdout: consume,
      validateOnClose: () => {
        try {
          return protocol.finish();
        } catch (error) {
          return error instanceof Error ? error.message : "Malformed Pi event.";
        }
      },
    });
  } catch (error) {
    throw new Error(
      protocolFailure ??
        (error instanceof Error
          ? error.message.replace(/^Process /, "Pi ")
          : "Pi failed."),
    );
  }
  // finish() was checked before successful process settlement; this only returns final text.
  const completion = protocol.finish();
  if (completion) throw new Error(completion);
  // The protocol exposes completion via a second, validated getter-free finish call below.
  return protocol.result();
}

async function gitText(args: string[]): Promise<string> {
  const result = await runBoundedProcess("git", args, {
    timeoutMs: 30_000,
    maxOutputBytes: maxOutputBytes,
  });
  return result.stdout;
}
async function gitBytes(args: string[]): Promise<Buffer> {
  const result = await runBoundedProcess("git", args, {
    timeoutMs: 30_000,
    maxOutputBytes: maxOutputBytes,
  });
  return Buffer.from(result.stdout);
}
function noNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export type RepositoryBinding = {
  version: 1;
  root: string;
  head: string;
  treeHash: string;
};
export async function repositoryBinding(
  requireClean = true,
): Promise<RepositoryBinding> {
  const [rootRaw, headRaw, status, diff, cached, untrackedRaw] =
    await Promise.all([
      gitText(["rev-parse", "--show-toplevel"]),
      gitText(["rev-parse", "HEAD"]),
      gitText(["status", "--porcelain=v1", "-z"]),
      gitText(["diff", "--binary"]),
      gitText(["diff", "--cached", "--binary"]),
      gitText(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
  if (requireClean && status)
    throw new Error(
      "Planning and apply require a clean tracked worktree; the runner never discards changes.",
    );
  const untracked = untrackedRaw.split("\0").filter(Boolean);
  const contents = await Promise.all(
    untracked.map(async (path) => {
      const bytes = await readFile(path).catch(() => Buffer.alloc(0));
      return `${path}\0${bytes.toString("base64")}`;
    }),
  );
  return {
    version: 1,
    root: noNewline(rootRaw),
    head: noNewline(headRaw),
    treeHash: createHash("sha256")
      .update(`${status}\0${diff}\0${cached}\0${contents.join("\0")}`)
      .digest("hex"),
  };
}

export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(".agent-runs", { recursive: true });
  let handle;
  try {
    handle = await open(".agent-runs/lock", "wx");
  } catch {
    throw new Error("Another agent run owns this repository lock.");
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(".agent-runs/lock", { force: true });
  }
}
const savedPlanSchema = { version: 1 } as const;
export async function savePlan(plan: Plan): Promise<string> {
  const binding = await repositoryBinding(true);
  await mkdir(".agent-runs/plans", { recursive: true });
  const path = join(".agent-runs/plans", `${Date.now()}-plan.json`);
  await writeFile(
    path,
    `${JSON.stringify({ ...savedPlanSchema, binding, plan }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return path;
}
export async function loadBoundPlan(path: string): Promise<Plan> {
  const absolute = resolve(path);
  if (relative(process.cwd(), absolute).startsWith(".."))
    throw new Error("Plan path must be inside this repository.");
  const saved: unknown = JSON.parse(await readFile(absolute, "utf8"));
  if (
    !saved ||
    typeof saved !== "object" ||
    (saved as { version?: unknown }).version !== 1 ||
    !("binding" in saved) ||
    !("plan" in saved)
  )
    throw new Error("Saved plan envelope is invalid.");
  const envelope = saved as { binding: RepositoryBinding; plan: unknown };
  if (
    JSON.stringify(envelope.binding) !==
    JSON.stringify(await repositoryBinding(false))
  )
    throw new Error(
      "Saved plan is stale: repository identity, HEAD, or content changed.",
    );
  return validatePlan(envelope.plan);
}
export function parsePlan(text: string): Plan {
  return validatePlan(
    JSON.parse(text.trim().replace(/^```json\s*|\s*```$/g, "")),
  );
}
export function parseCompletion(text: string): Completion {
  return completionSchema.parse(
    JSON.parse(text.trim().replace(/^```json\s*|\s*```$/g, "")),
  );
}
export function topologicalTasks(plan: Plan): Plan["tasks"] {
  const remaining = new Map(plan.tasks.map((task) => [task.id, task]));
  const complete = new Set<string>();
  const ordered: Plan["tasks"] = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependencies.every((id) => complete.has(id)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error("Plan dependencies contain a cycle.");
    for (const task of ready) {
      ordered.push(task);
      complete.add(task.id);
      remaining.delete(task.id);
    }
  }
  return ordered;
}

export async function changedPaths(): Promise<string[]> {
  const raw = await gitBytes(["status", "--porcelain=v1", "-z"]);
  const parts = raw.toString("utf8").split("\0");
  const paths = new Set<string>();
  for (let i = 0; i < parts.length - 1; i++) {
    const record = parts[i];
    if (!record) continue;
    const status = record.slice(0, 2);
    const first = record.slice(3);
    paths.add(first);
    if ("RC".includes(status[0] ?? "") || "RC".includes(status[1] ?? "")) {
      const old = parts[++i];
      if (old) paths.add(old);
    }
  }
  return [...paths].sort();
}
export type ContentSnapshot = Map<string, string>;
export async function contentSnapshot(): Promise<ContentSnapshot> {
  const paths = await changedPaths();
  const result = new Map<string, string>();
  for (const path of paths) {
    const [work, diff] = await Promise.all([
      readFile(path).catch(() => Buffer.from("<deleted>")),
      gitText(["diff", "--binary", "HEAD", "--", path]).catch(
        () => "<git-error>",
      ),
    ]);
    result.set(
      path,
      createHash("sha256").update(work).update("\0").update(diff).digest("hex"),
    );
  }
  return result;
}
export function snapshotDelta(
  before: ContentSnapshot,
  after: ContentSnapshot,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}
function globRegex(pattern: string): RegExp {
  let expression = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          expression += "(?:.*/)?";
        } else expression += ".*";
      } else expression += "[^/]*";
    } else expression += (char ?? "").replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${expression}$`);
}
export function pathsAreOwned(paths: string[], ownedPaths: string[]): boolean {
  return paths.every((path) =>
    ownedPaths.some((owned) =>
      owned.includes("*")
        ? globRegex(owned).test(path)
        : path === owned || path.startsWith(`${owned.replace(/\/$/, "")}/`),
    ),
  );
}
export function exactPaths(actual: string[], claimed: string[]): boolean {
  return (
    actual.length === claimed.length &&
    actual.every((path, index) => path === [...new Set(claimed)].sort()[index])
  );
}
export async function boundedGitDiff(): Promise<string> {
  const result = await runBoundedProcess("git", ["diff", "--binary", "HEAD"], {
    timeoutMs: 30_000,
    maxOutputBytes: Math.min(maxOutputBytes, 200_000),
  });
  return result.stdout.slice(0, 20_000);
}
export async function runVerification(
  options: RunOptions = {},
): Promise<string> {
  const testBin = process.env.AGENT_TEST_VERIFY_BIN;
  try {
    const result = await runBoundedProcess(
      testBin ?? "pnpm",
      testBin ? [] : ["verify"],
      { ...options, timeoutMs: options.timeoutMs ?? defaultTotalTimeoutMs },
    );
    return `${result.stdout}\n${result.stderr}`.slice(0, 20_000);
  } catch (error) {
    if (error instanceof ProcessFailure)
      throw new VerificationFailure(error.diagnostics);
    throw error;
  }
}
