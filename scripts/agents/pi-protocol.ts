import { StringDecoder } from "node:string_decoder";
import type { Role } from "./runner";

type ToolState = "declared" | "started" | "ended";
type UnknownRecord = Record<string, unknown>;
const knownEvents = new Set([
  "session",
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "error",
  "aborted",
]);

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Malformed Pi ${label}.`);
  return value as UnknownRecord;
}
function content(value: unknown, label: string): UnknownRecord[] {
  if (!Array.isArray(value)) throw new Error(`Malformed Pi ${label} content.`);
  return value.map((part) => {
    const item = record(part, `${label} content block`);
    if (typeof item.type !== "string")
      throw new Error(`Malformed Pi ${label} content block.`);
    return item;
  });
}
function message(value: unknown): UnknownRecord {
  const item = record(value, "message");
  if (typeof item.role !== "string")
    throw new Error("Malformed Pi message role.");
  return item;
}

/** Strictly validates Pi 0.85's JSON session lifecycle without retaining thinking text. */
export class PiProtocol {
  private readonly decoder = new StringDecoder("utf8");
  private readonly tools = new Map<string, ToolState>();
  private state: "running" | "ended" = "running";
  private started = false;
  private settled = false;
  private final: string | undefined;

  constructor(
    private readonly role: Role,
    private readonly provider: string,
    private readonly model: string,
  ) {}

  consume(chunk: Buffer): void {
    this.consumeText(this.decoder.write(chunk));
  }

  finish(): string | undefined {
    this.consumeText(this.decoder.end());
    if (this.buffer.trim()) return "Truncated Pi JSON event.";
    if (this.state !== "ended" || !this.final || this.tools.size)
      return "Pi ended without an authoritative completion.";
    return undefined;
  }

  result(): string {
    if (!this.final)
      throw new Error("Pi ended without an authoritative completion.");
    return this.final;
  }

  private consumeText(text: string): void {
    // The decoder is incremental, but record framing belongs here so split UTF-8/LF is safe.
    this.buffer += text;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error("Malformed Pi JSON event.");
      }
      this.event(value);
    }
  }
  private buffer = "";

  private event(value: unknown): void {
    const event = record(value, "event");
    if (typeof event.type !== "string")
      throw new Error("Malformed Pi event shape.");
    const type = event.type;
    if (!knownEvents.has(type)) return; // Forward-compatible, but never lifecycle evidence.
    if (this.state === "ended") {
      if (type === "agent_settled" && !this.settled) {
        this.settled = true;
        return;
      }
      throw new Error("Pi emitted lifecycle activity after agent_end.");
    }
    if (type === "session") return;
    if (type === "agent_start") {
      if (this.started) throw new Error("Duplicate Pi agent_start event.");
      this.started = true;
      return;
    }
    if (!this.started)
      throw new Error("Pi lifecycle began before agent_start.");
    if (type === "error" || type === "aborted")
      throw new Error(`Pi emitted ${type} event.`);
    if (type === "agent_end") {
      if (this.tools.size)
        throw new Error("Pi ended with unfinished tool work.");
      if (!this.final)
        throw new Error("Pi ended without an authoritative completion.");
      this.state = "ended";
      return;
    }
    if (type === "message_end") {
      this.messageEnd(event);
      return;
    }
    if (type === "message_start") {
      this.messageStart(event);
      return;
    }
    if (type === "message_update") {
      this.messageUpdate(event);
      return;
    }
    if (type === "turn_end") {
      this.turnEnd(event);
      return;
    }
    if (type === "turn_start") return;
    if (type === "tool_execution_start") {
      this.toolStart(event);
      return;
    }
    if (type === "tool_execution_update") {
      this.toolUpdate(event);
      return;
    }
    if (type === "tool_execution_end") this.toolEnd(event);
  }

  private messageStart(event: UnknownRecord): void {
    const item = message(event.message);
    if (!["user", "assistant", "toolResult"].includes(item.role as string))
      throw new Error("Malformed Pi message role.");
  }
  private messageUpdate(event: UnknownRecord): void {
    record(event.usage, "message_update usage");
    const update = record(
      event.assistantMessageEvent,
      "message_update assistant event",
    );
    if (typeof update.type !== "string")
      throw new Error("Malformed Pi message_update assistant event.");
  }
  private turnEnd(event: UnknownRecord): void {
    const item = message(event.message);
    if (!Array.isArray(event.toolResults))
      throw new Error("Malformed Pi turn_end.");
    if (item.role === "assistant") this.identity(item);
  }
  private messageEnd(event: UnknownRecord): void {
    const item = message(event.message);
    if (item.role === "assistant") {
      this.assistant(item);
      return;
    }
    if (item.role === "user") {
      content(item.content, "user message");
      return;
    }
    if (item.role === "toolResult") {
      this.toolResult(item);
      return;
    }
    throw new Error("Malformed Pi message role.");
  }
  private identity(item: UnknownRecord): void {
    if (typeof item.provider !== "string" || typeof item.model !== "string")
      throw new Error("Pi assistant message lacks provider or model identity.");
    if (item.provider !== this.provider || item.model !== this.model)
      throw new Error("Pi resolved an unexpected provider or model identity.");
  }
  private assistant(item: UnknownRecord): void {
    this.identity(item);
    if (typeof item.stopReason !== "string")
      throw new Error("Pi assistant message lacks stop reason.");
    const parts = content(item.content, "assistant message");
    const text: string[] = [];
    const calls: string[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        if (typeof part.text !== "string")
          throw new Error("Malformed Pi text block.");
        text.push(part.text);
      } else if (part.type === "thinking") {
        if (typeof part.thinking !== "string")
          throw new Error("Malformed Pi thinking block.");
      } else if (part.type === "toolCall") {
        if (
          typeof part.id !== "string" ||
          typeof part.name !== "string" ||
          !part.arguments ||
          typeof part.arguments !== "object" ||
          Array.isArray(part.arguments)
        )
          throw new Error("Malformed Pi toolCall block.");
        if (this.tools.has(part.id) || calls.includes(part.id))
          throw new Error("Duplicate Pi tool call ID.");
        calls.push(part.id);
      } else throw new Error("Malformed Pi assistant content block.");
    }
    if (["error", "aborted", "cancelled", "length"].includes(item.stopReason))
      throw new Error(`Pi stopped: ${item.stopReason}.`);
    if (item.stopReason !== "stop" && item.stopReason !== "toolUse")
      throw new Error(`Malformed Pi stop reason: ${item.stopReason}.`);
    this.final = undefined; // Any later assistant turn supersedes a prior candidate.
    for (const id of calls) this.tools.set(id, "declared");
    if (item.stopReason === "stop") {
      if (calls.length)
        throw new Error(
          "Pi final assistant message included unfinished tool calls.",
        );
      const candidate = text.join("");
      if (!candidate.trim())
        throw new Error("Pi final assistant message lacked text.");
      this.final = candidate;
    }
  }
  private toolStart(event: UnknownRecord): void {
    this.final = undefined;
    const id = event.toolCallId;
    if (
      typeof id !== "string" ||
      typeof event.toolName !== "string" ||
      !this.tools.has(id) ||
      this.tools.get(id) !== "declared"
    )
      throw new Error("Orphaned or duplicate Pi tool execution start.");
    this.tools.set(id, "started");
  }
  private toolUpdate(event: UnknownRecord): void {
    const id = event.toolCallId;
    if (
      typeof id !== "string" ||
      typeof event.toolName !== "string" ||
      this.tools.get(id) !== "started"
    )
      throw new Error("Orphaned Pi tool execution update.");
  }
  private toolEnd(event: UnknownRecord): void {
    this.final = undefined;
    const id = event.toolCallId;
    if (
      typeof id !== "string" ||
      typeof event.toolName !== "string" ||
      typeof event.isError !== "boolean" ||
      this.tools.get(id) !== "started"
    )
      throw new Error("Orphaned or duplicate Pi tool execution end.");
    if (
      event.isError ||
      (event.result &&
        typeof event.result === "object" &&
        (event.result as UnknownRecord).isError === true)
    )
      throw new Error("Pi tool execution failed.");
    this.tools.set(id, "ended");
  }
  private toolResult(item: UnknownRecord): void {
    content(item.content, "tool result");
    if (
      typeof item.toolCallId !== "string" ||
      typeof item.toolName !== "string" ||
      typeof item.isError !== "boolean" ||
      this.tools.get(item.toolCallId) !== "ended"
    )
      throw new Error("Orphaned or unfinished Pi tool result.");
    if (item.isError) throw new Error("Pi tool result failed.");
    this.tools.delete(item.toolCallId);
  }
}
