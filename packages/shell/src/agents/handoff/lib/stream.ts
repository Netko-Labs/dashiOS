/**
 * What a harness running a task prints, read as events (docs/actions.md,
 * "Agents from the launcher"): its session, each tool call and how it went,
 * what it said, and how it ended. One parser per harness, each pure and
 * line by line, so the shell can read a stream as it grows (runner.ts) and
 * the tests can read recorded ones (test/fixtures/handoff/).
 *
 * - Claude Code: `claude -p --output-format stream-json --verbose`, one JSON
 *   object a line: `system`/`init` (`session_id`), `assistant` messages
 *   whose content holds `text` and `tool_use` (`id`, `name`, `input`),
 *   `user` messages holding `tool_result` (`tool_use_id`, `is_error`), and
 *   a last `result` (`subtype`, `is_error`, `result`). Recorded from 2.1.319.
 * - Codex: `codex exec --json`, JSONL: `thread.started` (`thread_id`),
 *   `item.started`/`item.completed` with an `item` (`mcp_tool_call`:
 *   `server`, `tool`, `arguments`, `status`, `error`; `command_execution`;
 *   `agent_message`: `text`), `turn.completed`, `turn.failed`, `error`
 *   ("Reconnecting... N/5" while it retries, which isn't the end). From its
 *   docs (developers.openai.com/codex), and a signed-out run recorded from
 *   codex-cli 0.167.0 (test/fixtures/handoff/codex-signed-out.jsonl).
 * - OpenCode: `opencode run --format json`, JSON events with `sessionID`:
 *   `tool_use` (a `part` of type `tool`: `tool`, `callID`, `state` with
 *   `status`, `input`, `output`, `error`), `text` (`part.text`),
 *   `step_finish`, `error`. From its docs (opencode.ai/docs); 1.19.5 takes
 *   the flags, but with no account it printed no event to parse (its free
 *   model's limit; it waits on), so none was recorded: after a while the
 *   card asks instead (quiet.ts).
 */

import type { HarnessId } from "../../ask/answerer.ts";

/** Dashi's tools reach a harness under its MCP server's name: `mcp__dashi__open_url`, `dashi_open_url`. */
export const MCP_SERVER = "dashi";

export type RunEvent =
  /** The harness's own session, for a follow-up. */
  | { kind: "session"; id: string }
  /** A tool call started. `tool` is Dashi's name for Dashi's tools ("open_url"), else the harness's own. */
  | { kind: "call"; id: string; tool: string; input: Record<string, unknown> }
  /** How a call went. */
  | { kind: "result"; id: string; ok: boolean; text: string }
  /** Something it said. */
  | { kind: "said"; text: string }
  /** It ended its turn well; `text` is its last words (empty: the last it said). */
  | { kind: "done"; text: string }
  | { kind: "failed"; error: string };

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const raw = (value: unknown): Raw => (isRaw(value) ? value : {});

/** One line of output as an object; null for a banner, a blank or a broken line. */
export function lineObject(line: string): Raw | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRaw(value) ? value : null;
  } catch {
    return null;
  }
}

/** A tool's name as Dashi knows it: the MCP prefix taken off Dashi's own. */
export function toolName(name: string): string {
  for (const prefix of [`mcp__${MCP_SERVER}__`, `${MCP_SERVER}_`]) if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

/** A tool result's words: a string, or MCP content's text parts. */
function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((part) => str(raw(part).text) ?? "")
      .filter(Boolean)
      .join("\n");
  return isRaw(value) ? resultText(value.content) : "";
}

function claudeEvents(line: Raw): RunEvent[] {
  const session = str(line.session_id);
  switch (line.type) {
    case "system":
      return line.subtype === "init" && session ? [{ kind: "session", id: session }] : [];
    case "assistant": {
      const content = raw(line.message).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part): RunEvent[] => {
        const each = raw(part);
        if (each.type === "text") {
          const text = str(each.text);
          return text ? [{ kind: "said", text: text.trim() }] : [];
        }
        if (each.type === "tool_use" && str(each.id) && str(each.name))
          return [{ kind: "call", id: String(each.id), tool: toolName(String(each.name)), input: raw(each.input) }];
        return [];
      });
    }
    case "user": {
      const content = raw(line.message).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part): RunEvent[] => {
        const each = raw(part);
        if (each.type !== "tool_result" || !str(each.tool_use_id)) return [];
        return [{ kind: "result", id: String(each.tool_use_id), ok: each.is_error !== true, text: resultText(each.content) }];
      });
    }
    case "result": {
      const text = str(line.result) ?? "";
      const failed = line.is_error === true || (typeof line.subtype === "string" && line.subtype !== "success");
      return [
        ...(session ? [{ kind: "session" as const, id: session }] : []),
        failed ? { kind: "failed" as const, error: text.trim() || String(line.subtype ?? "error") } : { kind: "done" as const, text: text.trim() },
      ];
    }
    default:
      return [];
  }
}

function codexEvents(line: Raw): RunEvent[] {
  switch (line.type) {
    case "thread.started": {
      const id = str(line.thread_id);
      return id ? [{ kind: "session", id }] : [];
    }
    case "item.started":
    case "item.completed": {
      const item = raw(line.item);
      const id = str(item.id);
      if (!id) return [];
      const started = line.type === "item.started";
      if (item.type === "mcp_tool_call") {
        const tool = str(item.tool) ?? "tool";
        const name = str(item.server) === MCP_SERVER ? tool : `${String(item.server ?? "")}.${tool}`;
        if (started) return [{ kind: "call", id, tool: name, input: raw(item.arguments) }];
        const error = str(raw(item.error).message) ?? str(item.error);
        return [{ kind: "result", id, ok: item.status !== "failed" && !error, text: error ?? resultText(item.result) }];
      }
      if (item.type === "command_execution") {
        if (started) return [{ kind: "call", id, tool: "shell", input: { command: item.command } }];
        return [{ kind: "result", id, ok: item.status !== "failed" && (item.exit_code ?? 0) === 0, text: str(item.aggregated_output) ?? "" }];
      }
      if (!started && (item.type === "agent_message" || item.type === "assistant_message")) {
        const text = str(item.text);
        return text ? [{ kind: "said", text: text.trim() }] : [];
      }
      return [];
    }
    case "turn.completed":
      return [{ kind: "done", text: "" }];
    case "error":
      // "Reconnecting... 2/5 (…)": Codex tries again on its own; only what it gives up on ends the turn.
      if (/^Reconnecting\b/.test(str(line.message) ?? "")) return [];
      return [{ kind: "failed", error: str(line.message) ?? "Codex stopped." }];
    case "turn.failed":
      return [{ kind: "failed", error: str(raw(line.error).message) ?? str(line.message) ?? "Codex stopped." }];
    default:
      return [];
  }
}

function opencodeEvents(line: Raw): RunEvent[] {
  const session = str(line.sessionID);
  const head: RunEvent[] = session ? [{ kind: "session", id: session }] : [];
  const part = raw(line.part);
  switch (line.type) {
    case "tool_use": {
      const state = raw(part.state);
      const id = str(part.callID) ?? str(part.id);
      const tool = str(part.tool);
      if (!id || !tool) return head;
      const call: RunEvent = { kind: "call", id, tool: toolName(tool), input: raw(state.input) };
      if (state.status !== "completed" && state.status !== "error") return [...head, call];
      const ok = state.status === "completed";
      return [...head, call, { kind: "result", id, ok, text: ok ? resultText(state.output) : (str(state.error) ?? "") }];
    }
    case "text": {
      const text = str(part.text);
      return text ? [...head, { kind: "said", text: text.trim() }] : head;
    }
    case "error": {
      const error = raw(line.error);
      const data = raw(error.data);
      return [...head, { kind: "failed", error: str(data.message) ?? str(error.message) ?? str(error.name) ?? "OpenCode stopped." }];
    }
    default:
      return head;
  }
}

const PARSERS: Readonly<Record<HarnessId, (line: Raw) => RunEvent[]>> = {
  "claude-code": claudeEvents,
  codex: codexEvents,
  opencode: opencodeEvents,
};

/** The events in one line a harness printed. */
export function eventsOf(harness: HarnessId, line: string): RunEvent[] {
  const object = lineObject(line);
  return object ? PARSERS[harness](object) : [];
}

/** Every event in a stream (a recorded one, or the lines read so far). */
export function streamEvents(harness: HarnessId, stream: string): RunEvent[] {
  return stream.split("\n").flatMap((line) => eventsOf(harness, line));
}

/** "Steps: 6" in what it said first: how many steps it expects (its words, asked for in TASK_PROMPT). */
export function stepsPlanned(text: string): number | null {
  const found = /\bsteps?\s*:\s*(?:about\s+)?(\d{1,2})\b/i.exec(text);
  const count = found ? Number(found[1]) : Number.NaN;
  return Number.isInteger(count) && count > 0 ? count : null;
}
