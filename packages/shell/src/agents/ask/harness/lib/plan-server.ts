/**
 * Plan mode: Dashi's MCP server as a harness answering the launcher sees it
 * (docs/actions.md, "Plan mode"). `tools/list` is the plan's tools, the same
 * registry actions the Claude API answerer is offered (plan.ts
 * `planTools`); `tools/call` runs nothing, ever. Each call is checked by its
 * action and recorded as the plan's next step with its parsed arguments,
 * and the harness is told "Planned as step N; nothing runs until the person
 * presses Return". A call whose arguments don't pass is answered with what
 * is wrong, so the harness can fix it, and is not recorded. When the
 * harness ends, the recorded calls are the plan, shown and run as any
 * other answerer's (tasks.ts).
 *
 * One socket per turn, `$XDG_RUNTIME_DIR/dashi-plan/<turn>.sock` (0600),
 * bound into that turn's sandbox only; the harness reaches it through
 * `dashi-mcp` with `DASHI_MCP_SOCKET` pointing at it. A connection from a
 * process outside the turn's sandbox scope is refused.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { LineBuffer } from "../../../../shared/io/index.ts";
import * as mcp from "../../../lib/mcp.ts";
import { peerPid, socketFd } from "../../../peer.ts";
import type { ModelCall, PlanTool } from "../../answerer.ts";
import { MAX_STEPS, oneLine } from "../../plan.ts";

/** What the harness is told about this server, in `initialize`. */
export const PLAN_INSTRUCTIONS = [
  "Dashi's plan mode. Each tool here is something Dashi can do for the person.",
  "Calling a tool doesn't do it: it adds the call to a plan as the next step, and Dashi shows the plan to the person.",
  "Nothing runs until the person reads the plan and presses Return. Call the tools in the order they should run, then stop.",
].join(" ");

/** The words a recorded call is answered with. */
export const plannedWords = (step: number): string => `Planned as step ${step}; nothing runs until the person presses Return.`;

/** A line longer than this ends the connection (a runaway client). */
const MAX_LINE = 1024 * 1024;

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const textResult = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** The schemas a value may match: the schema itself, or each of its `oneOf`/`anyOf`. */
const alternatives = (schema: unknown): Raw[] => {
  if (!isRaw(schema)) return [];
  const options = [...(Array.isArray(schema.oneOf) ? schema.oneOf : []), ...(Array.isArray(schema.anyOf) ? schema.anyOf : [])].filter(isRaw);
  return options.length > 0 ? options : [schema];
};
const types = (schema: Raw): string[] =>
  typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type.filter((t) => typeof t === "string") : [];

/** Whether a string value fits a schema as a string. */
const fitsAsString = (value: string, options: readonly Raw[]): boolean =>
  options.some((option) => types(option).includes("string") && (!Array.isArray(option.enum) || option.enum.includes(value)));

/**
 * A harness's arguments as the schema means them: some MCP clients send
 * `true`, `2` or an object as text when a property may be one of several
 * types. A string that doesn't fit as a string, but is the boolean, number
 * or JSON a property takes, is parsed; anything else is left as it came
 * (the action's check still decides).
 */
export function parsedArguments(args: Raw, schema: Raw): Raw {
  const properties = isRaw(schema.properties) ? schema.properties : {};
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => {
      if (typeof value !== "string") return [name, value];
      const options = alternatives(properties[name]);
      if (options.length === 0 || fitsAsString(value, options)) return [name, value];
      const allowed = new Set(options.flatMap(types));
      const text = value.trim();
      if (allowed.has("boolean") && (text === "true" || text === "false")) return [name, text === "true"];
      if ((allowed.has("number") || allowed.has("integer")) && text !== "" && Number.isFinite(Number(text))) return [name, Number(text)];
      if ((allowed.has("object") || allowed.has("array")) && /^[[{]/.test(text)) {
        try {
          return [name, JSON.parse(text) as unknown];
        } catch {
          return [name, value];
        }
      }
      return [name, value];
    }),
  );
}

/**
 * The calls of one turn, from MCP lines: pure, so it is tested without a
 * socket. `handle` answers each line (null for a notification or a
 * response), and `calls` is the plan so far.
 */
export class PlanRecorder {
  private readonly recorded: ModelCall[] = [];

  constructor(
    private readonly tools: readonly PlanTool[],
    /** Ids for the recorded calls: `<prefix>-1`, `<prefix>-2`… (a follow-up reports how each went under it). */
    private readonly prefix: string,
    private readonly max = MAX_STEPS,
  ) {}

  /** The plan so far: each call with its parsed arguments, in the order made. */
  get calls(): readonly ModelCall[] {
    return this.recorded;
  }

  handle(line: string): unknown {
    const incoming = mcp.parse(line);
    if (incoming.kind === "invalid") return mcp.error(incoming.id, incoming.code, incoming.message);
    if (incoming.kind !== "request") return null;
    const { id, method, params } = incoming;
    switch (method) {
      case "initialize":
        return mcp.result(id, {
          protocolVersion: mcp.negotiate(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "dashi", title: "Dashi (plan mode)", version: "0.4.0" },
          instructions: PLAN_INSTRUCTIONS,
        });
      case "ping":
        return mcp.result(id, {});
      case "tools/list":
        return mcp.result(id, {
          tools: this.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.schema })),
        });
      case "tools/call":
        return mcp.result(id, this.call(params));
      default:
        return mcp.error(id, mcp.METHOD_NOT_FOUND, "Method not found");
    }
  }

  /** A call: checked, then recorded, never run. */
  private call(params: Raw): unknown {
    const name = typeof params.name === "string" ? params.name : "";
    const tool = this.tools.find((each) => each.name === name);
    if (!tool) return textResult(`Dashi has no tool called “${oneLine(name, 40)}”. Use only the tools listed.`, true);
    const sent = params.arguments === undefined ? {} : params.arguments;
    if (!isRaw(sent)) return textResult("Its arguments must be an object.", true);
    const args = parsedArguments(sent, tool.schema);
    const checked = tool.check?.(args) ?? { ok: true };
    if (!checked.ok) return textResult(`Not planned: ${oneLine(checked.error, 160)} Fix the arguments and call it again.`, true);
    if (this.recorded.length >= this.max) return textResult(`The plan has ${this.max} steps already; nothing more can be added. Stop here.`, true);
    this.recorded.push({ id: `${this.prefix}-${this.recorded.length + 1}`, name, input: args });
    return textResult(plannedWords(this.recorded.length));
  }
}

export interface PlanServer {
  readonly path: string;
  close(): void;
}

/**
 * Serve `recorder` on a unix socket at `path`, to the processes `accept`
 * lets in (by pid, from SO_PEERCRED); the socket is the person's alone (0600).
 */
export function servePlan(path: string, recorder: PlanRecorder, accept: (pid: number | null) => boolean): PlanServer {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) unlinkSync(path);
  interface Conn {
    lines: LineBuffer;
    outbox: Uint8Array[];
  }
  const flush = (socket: Bun.Socket<Conn>) => {
    const box = socket.data.outbox;
    while (box.length > 0) {
      const next = box[0] as Uint8Array;
      const written = socket.write(next);
      if (written < next.byteLength) {
        box[0] = next.subarray(Math.max(written, 0));
        return;
      }
      box.shift();
    }
  };
  const server = Bun.listen<Conn>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = { lines: new LineBuffer(), outbox: [] };
        const fd = socketFd(socket);
        if (!accept(fd !== null ? peerPid(fd) : null)) socket.terminate();
      },
      data(socket, chunk) {
        const lines = socket.data.lines.push(chunk);
        if (socket.data.lines.pending > MAX_LINE) {
          socket.terminate();
          return;
        }
        for (const line of lines) {
          if (!line.trim()) continue;
          const reply = recorder.handle(line);
          if (reply !== null) socket.data.outbox.push(new TextEncoder().encode(`${JSON.stringify(reply)}\n`));
        }
        flush(socket);
      },
      drain(socket) {
        flush(socket);
      },
    },
  });
  chmodSync(path, 0o600);
  return {
    path,
    close() {
      server.stop(true);
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
