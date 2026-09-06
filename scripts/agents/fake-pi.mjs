#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const mode = process.env.FAKE_PI_MODE ?? "success";
const provider = process.env.FAKE_PROVIDER ?? "openai-codex";
const model = process.env.FAKE_MODEL ?? "gpt-6-astra";
const event = (type, extra = {}) => ({ type, ...extra });
const assistant = (stopReason, content, identity = {}) =>
  event("message_end", {
    message: {
      role: "assistant",
      provider,
      model,
      stopReason,
      content,
      ...identity,
    },
  });
const user = () =>
  event("message_end", {
    message: { role: "user", content: [{ type: "text", text: "request" }] },
  });
const toolResult = (id, isError = false) =>
  event("message_end", {
    message: {
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      isError,
      content: [{ type: "text", text: "result" }],
    },
  });
const toolCall = (id) => ({
  type: "toolCall",
  id,
  name: "read",
  arguments: { path: "sentinel" },
});
function catalog() {
  const header = "provider model context max-out thinking images";
  const rows =
    mode === "wrong-provider"
      ? ["other gpt-6-astra 1 1 yes no"]
      : mode === "missing-model"
        ? ["openai-codex other-model 1 1 yes no"]
        : ["openai-codex gpt-6-astra 1 1 yes no"];
  const table =
    mode === "catalog-text"
      ? "diagnostic mentions openai-codex gpt-6-astra"
      : `${header}\n${rows.join("\n")}\n`;
  (mode === "catalog-stdout" ? process.stdout : process.stderr).write(table);
}
function normal(finalText) {
  return [
    event("session", { version: 3 }),
    event("agent_start"),
    event("turn_start"),
    event("message_start", { message: { role: "user" } }),
    user(),
    event("message_start", { message: { role: "assistant" } }),
    assistant("toolUse", [
      { type: "thinking", thinking: "private" },
      toolCall("tool-1"),
      toolCall("tool-2"),
    ]),
    event("tool_execution_start", {
      toolCallId: "tool-1",
      toolName: "read",
      args: {},
    }),
    event("tool_execution_end", {
      toolCallId: "tool-1",
      toolName: "read",
      result: {},
      isError: false,
    }),
    toolResult("tool-1"),
    event("tool_execution_start", {
      toolCallId: "tool-2",
      toolName: "read",
      args: {},
    }),
    event("tool_execution_end", {
      toolCallId: "tool-2",
      toolName: "read",
      result: {},
      isError: false,
    }),
    toolResult("tool-2"),
    assistant("toolUse", [
      { type: "thinking", thinking: "private intermediate" },
    ]),
    assistant("stop", [
      { type: "thinking", thinking: "private final" },
      { type: "text", text: finalText },
    ]),
    event("turn_end", {
      message: { role: "assistant", provider, model },
      toolResults: [],
    }),
    event("agent_end", { messages: [] }),
    event("agent_settled"),
  ];
}
function cliText(input) {
  if (input.includes("PHASE: PLAN"))
    return JSON.stringify({
      version: 1,
      goal: "test",
      assumptions: [],
      tasks: [
        {
          id: "task",
          title: "test",
          dependencies: [],
          ownedPaths: ["notes.txt"],
          acceptanceCriteria: ["complete"],
        },
      ],
      requestedResearch:
        mode === "cli-research" ? [{ question: "Is this maintained?" }] : [],
      risks: [],
      verification: ["verify"],
    });
  if (input.includes("PHASE: FINAL REVIEW"))
    return JSON.stringify(
      mode === "cli-review-reject"
        ? { approved: false, findings: ["fake rejection"] }
        : { approved: true, findings: [] },
    );
  if (input.includes("PHASE: HARD BLOCKER"))
    return JSON.stringify({
      solution: "retry within the task",
      scopeExpansion: false,
    });
  if (input.includes("PHASE: CONSENTED RESEARCH"))
    return "Research finding with https://example.test";
  if (
    !input.includes("PHASE: IMPLEMENTATION") &&
    !input.includes("PHASE: ONE BOUNDED VERIFICATION REPAIR")
  )
    throw new Error("Fake Pi requires an explicit phase prompt.");
  const retry = input.includes("Astra high bounded hard-blocker solution");
  const firstBlocked =
    ["cli-blocked", "cli-blocked-unowned", "cli-blocked-partial"].includes(
      mode,
    ) && !retry;
  if (firstBlocked && mode === "cli-blocked-unowned")
    writeFileSync("unowned.txt", "unauthorized\n");
  if (firstBlocked && mode === "cli-blocked-partial")
    writeFileSync("notes.txt", "partial\n");
  if (
    process.env.FAKE_CAPTURE_PATH &&
    input.includes("PHASE: ONE BOUNDED VERIFICATION REPAIR")
  )
    appendFileSync(process.env.FAKE_CAPTURE_PATH, input);
  return JSON.stringify({
    version: 1,
    taskId: input.includes('"id": "repair"') ? "repair" : "task",
    status: firstBlocked ? "blocked" : "completed",
    changedPaths:
      firstBlocked && mode === "cli-blocked-unowned"
        ? ["unowned.txt"]
        : mode === "cli-blocked-partial"
          ? ["notes.txt"]
          : [],
    acceptanceEvidence: ["fake completion"],
    checksRun: ["test"],
    unresolvedRisks: [],
  });
}
if (process.argv.includes("--list-models")) {
  catalog();
  process.exit(0);
}
if (mode === "leader-exits") {
  const { spawn } = await import("node:child_process");
  spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
    detached: false,
    stdio: "ignore",
  });
  process.exit(0);
}
if (mode === "term-resistant") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
if (mode === "nonzero-grandchild") {
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { detached: false, stdio: "ignore" },
  );
  if (process.env.FAKE_CHILD_PID_PATH && child.pid)
    writeFileSync(process.env.FAKE_CHILD_PID_PATH, String(child.pid));
  process.exit(7);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (mode === "term-resistant") return;
  let events = normal(mode.startsWith("cli-") ? cliText(input) : '{"ok":true}');
  if (mode === "malformed") process.stdout.write("{bad\n");
  else if (mode === "null-event") process.stdout.write("null\n");
  else {
    if (mode === "event-error")
      events = [event("agent_start"), event("error"), event("agent_end")];
    if (mode === "tool-error")
      events = normal("{}").map((item) =>
        item.type === "tool_execution_end" ? { ...item, isError: true } : item,
      );
    if (mode === "model-error")
      events = [
        event("agent_start"),
        assistant("error", [{ type: "text", text: "{}" }]),
        event("agent_end"),
      ];
    if (mode === "length")
      events = [
        event("agent_start"),
        assistant("length", [{ type: "text", text: "{}" }]),
        event("agent_end"),
      ];
    if (mode === "missing-identity")
      events = [
        event("agent_start"),
        event("message_end", {
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "{}" }],
          },
        }),
        event("agent_end"),
      ];
    if (mode === "wrong-intermediate") {
      events = normal("{}");
      events[6] = assistant(
        "toolUse",
        [toolCall("tool-1"), toolCall("tool-2")],
        { model: "wrong" },
      );
    }
    if (mode === "stale-final")
      events = [
        event("agent_start"),
        assistant("stop", [{ type: "text", text: "old" }]),
        assistant("toolUse", [{ type: "thinking", thinking: "later" }]),
        event("agent_end"),
      ];
    if (mode === "unclosed-tool")
      events = [
        event("agent_start"),
        assistant("toolUse", [toolCall("tool-1")]),
        event("agent_end"),
      ];
    if (mode === "orphan-tool")
      events = [
        event("agent_start"),
        event("tool_execution_start", {
          toolCallId: "missing",
          toolName: "read",
          args: {},
        }),
        event("agent_end"),
      ];
    if (mode === "duplicate-terminal")
      events = [...normal("{}"), event("agent_end")];
    if (mode === "missing-terminal")
      events = normal("{}").filter(
        (item) => item.type !== "agent_end" && item.type !== "agent_settled",
      );
    if (mode === "bad-content")
      events = [
        event("agent_start"),
        assistant("stop", [{ type: "text" }]),
        event("agent_end"),
      ];
    if (mode === "duplicate-tool")
      events = [
        event("agent_start"),
        assistant("toolUse", [toolCall("same"), toolCall("same")]),
        event("agent_end"),
      ];
    if (mode === "unknown-event")
      events.splice(2, 0, event("future_event", { value: true }));
    if (mode === "bad-role")
      events = [
        event("agent_start"),
        event("message_end", { message: { role: "system", content: [] } }),
        event("agent_end"),
      ];
    if (mode === "truncated") {
      process.stdout.write(JSON.stringify(events[0]));
    } else if (mode === "split-utf8") {
      const bytes = Buffer.from(`${events.map(JSON.stringify).join("\n")}\n`);
      const split = bytes.indexOf(Buffer.from("private")) + 3;
      process.stdout.write(bytes.subarray(0, split));
      setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
    } else process.stdout.write(`${events.map(JSON.stringify).join("\n")}\n`);
  }
});
