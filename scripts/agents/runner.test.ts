import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { escalationSchema } from "./contract";
import { buildPrompt } from "./prompts";
import {
  changedPaths,
  contentSnapshot,
  exactPaths,
  parseCompletion,
  parsePlan,
  pathsAreOwned,
  preflightModel,
  runBoundedProcess,
  runPi,
  loadBoundPlan,
  savePlan,
  snapshotDelta,
  topologicalTasks,
  withLock,
} from "./runner";

const root = process.cwd();
const fake = join(root, "scripts/agents/fake-pi.mjs");
afterEach(() => {
  delete process.env.FAKE_PI_MODE;
  delete process.env.AGENT_PI_BIN;
  delete process.env.AGENT_TEST_VERIFY_BIN;
});
async function temporaryGit(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "runner-git-"));
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "runner@example.test"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "Runner"], { cwd: directory });
  await writeFile(join(directory, "seed.txt"), "seed\n");
  await writeFile(join(directory, ".gitignore"), ".agent-runs\n");
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "seed"], { cwd: directory });
  return directory;
}
describe("agent runner process boundary", () => {
  it("emits and consumes one strict hard-blocker escalation contract", () => {
    const emitted = buildPrompt("astra", {
      phase: "escalate",
      brief: "fix blocker",
      repositoryInstructions: "scope",
      failure: "blocked",
      evidence: "observed evidence",
    });
    expect(emitted).toContain('"solution"');
    expect(emitted).toContain('"scopeExpansion"');
    expect(emitted).not.toContain("completion-contract JSON");
    expect(
      escalationSchema.parse({
        solution: "retry owned task",
        scopeExpansion: false,
      }),
    ).toEqual({ solution: "retry owned task", scopeExpansion: false });
  });
  it("preflights the exact provider/model catalog and isolated arguments", async () => {
    process.env.AGENT_PI_BIN = fake;
    await expect(preflightModel("astra")).resolves.toBeUndefined();
    process.env.FAKE_PI_MODE = "catalog-stdout";
    await expect(preflightModel("astra")).resolves.toBeUndefined();
    process.env.FAKE_PI_MODE = "wrong-provider";
    await expect(preflightModel("astra")).rejects.toThrow("different provider");
    process.env.FAKE_PI_MODE = "missing-model";
    await expect(preflightModel("astra")).rejects.toThrow(
      "does not list model",
    );
    process.env.FAKE_PI_MODE = "catalog-text";
    await expect(preflightModel("astra")).rejects.toThrow(
      "unrecognized or malformed",
    );
  });
  it("accepts only exact completed JSONL lifecycle and rejects protocol failures", async () => {
    process.env.AGENT_PI_BIN = fake;
    await expect(runPi("astra", "test")).resolves.toBe('{"ok":true}');
    for (const mode of [
      "malformed",
      "null-event",
      "event-error",
      "tool-error",
      "model-error",
      "missing-identity",
      "wrong-intermediate",
      "length",
      "stale-final",
      "unclosed-tool",
      "orphan-tool",
      "duplicate-terminal",
      "missing-terminal",
      "truncated",
      "bad-content",
      "duplicate-tool",
      "bad-role",
    ]) {
      process.env.FAKE_PI_MODE = mode;
      await expect(runPi("terra", "test")).rejects.toThrow();
    }
    process.env.FAKE_PI_MODE = "split-utf8";
    await expect(runPi("terra", "test")).resolves.toBe('{"ok":true}');
    process.env.FAKE_PI_MODE = "unknown-event";
    await expect(runPi("terra", "test")).resolves.toBe('{"ok":true}');
  }, 15_000);
  it("terminates promptly after abort, timeout, and a leader which leaves a descendant", async () => {
    process.env.AGENT_PI_BIN = fake;
    process.env.FAKE_PI_MODE = "term-resistant";
    const controller = new AbortController();
    const abortRun = runPi("terra", "test", {
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    controller.abort();
    await expect(abortRun).rejects.toThrow("cancelled");
    await expect(runPi("terra", "test", { timeoutMs: 60 })).rejects.toThrow(
      "timed out",
    );
    process.env.FAKE_PI_MODE = "leader-exits";
    await expect(runPi("terra", "test", { timeoutMs: 1_000 })).rejects.toThrow(
      "authoritative completion",
    );
  });
  it("kills a nonzero leader's TERM-resistant descendant before releasing its lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-nonzero-"));
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const pidPath = join(directory, "child.pid");
      process.env.FAKE_PI_MODE = "nonzero-grandchild";
      process.env.FAKE_CHILD_PID_PATH = pidPath;
      await expect(withLock(() => runBoundedProcess(fake, []))).rejects.toThrow(
        "exited with 7",
      );
      const pid = Number(await readFile(pidPath, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(withLock(() => Promise.resolve())).resolves.toBeUndefined();
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
      delete process.env.FAKE_CHILD_PID_PATH;
    }
  });
  it("rejects malformed plans and orders valid dependency tasks deterministically", () => {
    expect(() => parsePlan('{"version":1}')).toThrow();
    const plan = parsePlan(
      JSON.stringify({
        version: 1,
        goal: "x",
        assumptions: [],
        tasks: [
          {
            id: "b",
            title: "b",
            dependencies: ["a"],
            ownedPaths: ["src"],
            acceptanceCriteria: ["x"],
          },
          {
            id: "a",
            title: "a",
            dependencies: [],
            ownedPaths: ["src"],
            acceptanceCriteria: ["x"],
          },
        ],
        requestedResearch: [],
        risks: [],
        verification: ["verify"],
      }),
    );
    expect(topologicalTasks(plan).map((task) => task.id)).toEqual(["a", "b"]);
    expect(() => parseCompletion('{"version":1,"taskId":"x"}')).toThrow();
  });
  it("uses NUL git paths, content snapshots, exact claims, and real glob semantics", async () => {
    const directory = await temporaryGit();
    const previous = process.cwd();
    process.chdir(directory);
    try {
      await writeFile("seed.txt", "first dirty change\n");
      const before = await contentSnapshot();
      await writeFile("seed.txt", "second dirty change\n");
      await writeFile("new.txt", "new\n");
      const actual = snapshotDelta(before, await contentSnapshot());
      expect(actual).toEqual(["new.txt", "seed.txt"]);
      expect(await changedPaths()).toEqual(["new.txt", "seed.txt"]);
      expect(exactPaths(actual, ["seed.txt", "new.txt"])).toBe(true);
      expect(exactPaths(actual, ["seed.txt"])).toBe(false);
      expect(pathsAreOwned(["src/a.ts"], ["*"])).toBe(false);
      expect(
        pathsAreOwned(["src/a.ts", "src/nested/b.ts"], ["src/**/*.ts"]),
      ).toBe(true);
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("does not release another owner lock on failed third-party contention", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-lock-"));
    const previous = process.cwd();
    process.chdir(directory);
    try {
      let release: (() => void) | undefined;
      const owner = withLock(
        () =>
          new Promise<void>((resolvePromise) => {
            release = resolvePromise;
          }),
      );
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await expect(withLock(() => Promise.resolve())).rejects.toThrow(
        "Another agent run",
      );
      await expect(withLock(() => Promise.resolve())).rejects.toThrow(
        "Another agent run",
      );
      release?.();
      await owner;
      await expect(withLock(() => Promise.resolve())).resolves.toBeUndefined();
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("runs plan/apply through the executable fake and dry-run emits actual prompts without Pi", async () => {
    const directory = await temporaryGit();
    const env = {
      ...process.env,
      AGENT_PI_BIN: fake,
      FAKE_PI_MODE: "cli-success",
      AGENT_TEST_VERIFY_BIN: "/usr/bin/true",
    };
    const tsx = resolve(root, "node_modules/.bin/tsx");
    const cli = resolve(root, "scripts/agents/cli.ts");
    const dry = execFileSync(tsx, [cli, "--dry-run", "full brief"], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    expect(dry).toContain("full brief");
    expect(dry).toContain("REPOSITORY INSTRUCTIONS");
    expect(dry).toContain("version");
    const planned = execFileSync(tsx, [cli, "--plan", "full brief"], {
      cwd: directory,
      env,
      encoding: "utf8",
    }).trim();
    expect(planned).toContain(".agent-runs/plans/");
    const applied = execFileSync(tsx, [cli, "--apply", planned], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    expect(applied).toContain("Apply completed");
    await rm(directory, { recursive: true, force: true });
  }, 30_000);
  it("uses /dev/null for omitted or empty utility stdin but delivers nonempty Pi payloads", async () => {
    const expectsNull = [
      "-e",
      "const fs=require('fs');if(!fs.fstatSync(0).isCharacterDevice())process.exit(9)",
    ];
    await expect(
      runBoundedProcess(process.execPath, expectsNull),
    ).resolves.toMatchObject({ stdout: "" });
    await expect(
      runBoundedProcess(process.execPath, expectsNull, { input: "" }),
    ).resolves.toMatchObject({ stdout: "" });
    const receivesPayload = [
      "-e",
      "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{if(s==='full payload')process.stdout.write('received');else process.exit(8)})",
    ];
    await expect(
      runBoundedProcess(process.execPath, receivesPayload, {
        input: "full payload",
      }),
    ).resolves.toMatchObject({ stdout: "received" });
    await expect(
      runBoundedProcess(process.execPath, ["-e", "process.exit(0)"], {
        input: "x".repeat(5_000_000),
      }),
    ).rejects.toThrow("stdin failed");
  });
  it("binds saved plans to content and enforces output bounds", async () => {
    const directory = await temporaryGit();
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const plan = parsePlan(
        JSON.stringify({
          version: 1,
          goal: "x",
          assumptions: [],
          tasks: [
            {
              id: "a",
              title: "a",
              dependencies: [],
              ownedPaths: ["seed.txt"],
              acceptanceCriteria: ["x"],
            },
          ],
          requestedResearch: [],
          risks: [],
          verification: ["verify"],
        }),
      );
      const saved = await savePlan(plan);
      await writeFile("seed.txt", "changed\n");
      await expect(loadBoundPlan(saved)).rejects.toThrow("stale");
      process.env.FAKE_PI_MODE = "success";
      await expect(
        runBoundedProcess(fake, [], { maxOutputBytes: 50 }),
      ).rejects.toThrow("output limit");
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("exercises consented research, one blocker escalation, rejection, and repeated verification failure in CLI", async () => {
    const tsx = resolve(root, "node_modules/.bin/tsx");
    const cli = resolve(root, "scripts/agents/cli.ts");
    const base = {
      ...process.env,
      AGENT_PI_BIN: fake,
      AGENT_TEST_VERIFY_BIN: "/usr/bin/true",
    };
    const researchDirectory = await temporaryGit();
    const researchEnv = { ...base, FAKE_PI_MODE: "cli-research" };
    const researchPlan = execFileSync(
      tsx,
      [cli, "--plan", "brief", "--allow-research"],
      { cwd: researchDirectory, env: researchEnv, encoding: "utf8" },
    ).trim();
    expect(
      execFileSync(tsx, [cli, "--apply", researchPlan, "--allow-research"], {
        cwd: researchDirectory,
        env: researchEnv,
        encoding: "utf8",
      }),
    ).toContain("Apply completed");
    await rm(researchDirectory, { recursive: true, force: true });
    const blockedDirectory = await temporaryGit();
    const blockedEnv = { ...base, FAKE_PI_MODE: "cli-blocked" };
    const blockedPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: blockedDirectory,
      env: blockedEnv,
      encoding: "utf8",
    }).trim();
    expect(
      execFileSync(tsx, [cli, "--apply", blockedPlan], {
        cwd: blockedDirectory,
        env: blockedEnv,
        encoding: "utf8",
      }),
    ).toContain("Apply completed");
    await rm(blockedDirectory, { recursive: true, force: true });
    const unownedDirectory = await temporaryGit();
    const unownedEnv = { ...base, FAKE_PI_MODE: "cli-blocked-unowned" };
    const unownedPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: unownedDirectory,
      env: unownedEnv,
      encoding: "utf8",
    }).trim();
    expect(() =>
      execFileSync(tsx, [cli, "--apply", unownedPlan], {
        cwd: unownedDirectory,
        env: unownedEnv,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    await rm(unownedDirectory, { recursive: true, force: true });
    const partialDirectory = await temporaryGit();
    const partialEnv = { ...base, FAKE_PI_MODE: "cli-blocked-partial" };
    const partialPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: partialDirectory,
      env: partialEnv,
      encoding: "utf8",
    }).trim();
    expect(
      execFileSync(tsx, [cli, "--apply", partialPlan], {
        cwd: partialDirectory,
        env: partialEnv,
        encoding: "utf8",
      }),
    ).toContain("Apply completed");
    await rm(partialDirectory, { recursive: true, force: true });
    const rejectedDirectory = await temporaryGit();
    const rejectedEnv = { ...base, FAKE_PI_MODE: "cli-review-reject" };
    const rejectedPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: rejectedDirectory,
      env: rejectedEnv,
      encoding: "utf8",
    }).trim();
    expect(() =>
      execFileSync(tsx, [cli, "--apply", rejectedPlan], {
        cwd: rejectedDirectory,
        env: rejectedEnv,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    await rm(rejectedDirectory, { recursive: true, force: true });
    const failingDirectory = await temporaryGit();
    const failingEnv = {
      ...base,
      FAKE_PI_MODE: "cli-success",
      AGENT_TEST_VERIFY_BIN: "/usr/bin/false",
    };
    const failingPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: failingDirectory,
      env: failingEnv,
      encoding: "utf8",
    }).trim();
    expect(() =>
      execFileSync(tsx, [cli, "--apply", failingPlan], {
        cwd: failingDirectory,
        env: failingEnv,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    await rm(failingDirectory, { recursive: true, force: true });
    const diagnosticsDirectory = await temporaryGit();
    const checkDirectory = await mkdtemp(join(tmpdir(), "runner-check-"));
    const check = join(checkDirectory, "stdout-fail.sh");
    const capture = join(checkDirectory, "repair-prompt.txt");
    const diagnosticsPlan = execFileSync(tsx, [cli, "--plan", "brief"], {
      cwd: diagnosticsDirectory,
      env: { ...base, FAKE_PI_MODE: "cli-success" },
      encoding: "utf8",
    }).trim();
    await writeFile(
      check,
      "#!/bin/sh\necho UNIQUE_VERIFY_STDOUT_DIAGNOSTIC\nexit 1\n",
    );
    await chmod(check, 0o755);
    const diagnosticsEnv = {
      ...base,
      FAKE_PI_MODE: "cli-success",
      AGENT_TEST_VERIFY_BIN: check,
      FAKE_CAPTURE_PATH: capture,
    };
    expect(() =>
      execFileSync(tsx, [cli, "--apply", diagnosticsPlan], {
        cwd: diagnosticsDirectory,
        env: diagnosticsEnv,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    expect(await readFile(capture, "utf8")).toContain(
      "UNIQUE_VERIFY_STDOUT_DIAGNOSTIC",
    );
    await rm(diagnosticsDirectory, { recursive: true, force: true });
    await rm(checkDirectory, { recursive: true, force: true });
  }, 60_000);
  it("supervises a spawn failure rather than throwing from an event callback", async () => {
    await expect(
      runBoundedProcess("/definitely/not/a-program", []),
    ).rejects.toThrow("could not start");
  });
});
