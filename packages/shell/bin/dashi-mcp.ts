#!/usr/bin/env bun
/**
 * dashi-mcp: Dashi's MCP server for agents, over stdio. The server runs in
 * the Dashi session (shell/src/agents); this carries the client's lines to
 * its socket and the socket's to stdout, so MCP clients can spawn it:
 *
 *   claude mcp add dashi -- bun <dashi>/shell/bin/dashi-mcp.ts
 *   ssh <host> bun <dashi>/shell/bin/dashi-mcp.ts     (from another machine)
 *
 * The person at the screen is asked before the agent may see or do
 * anything (docs/agents.html).
 *
 * It does not connect until the client calls a tool: `initialize`,
 * `tools/list` and `ping` are answered here, from the same table the shell
 * uses (src/agents/mcp-local.ts), so a chat that starts this server and
 * never uses it is nothing to the shell (decisions.md D140). At the first
 * `tools/call` it connects, says the client's `initialize` again, and from
 * then on carries every line. Only for the agents' server, whose socket is
 * named `dashi-mcp.sock`: another server reached through this bridge (plan
 * mode's, `DASHI_MCP_SOCKET`: agents/ask/harness/) has its own tools and
 * words, so there it connects at once and answers nothing itself.
 *
 * With `--reconnect` (a launcher run's harness starts it so: agents/handoff/),
 * it outlives the shell restarting: when the socket closes it connects again
 * for up to two minutes, says the client's `initialize` again, and answers
 * a request that was on its way with an error (src/agents/mcp-relay.ts).
 * Without it, it ends when the socket does.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { answerLocally } from "../src/agents/mcp-local.ts";
import { McpRelay } from "../src/agents/mcp-relay.ts";

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const path = process.env.DASHI_MCP_SOCKET || join(runtime, "dashi-mcp.sock");

// Replies go out in order, each written in full, before any exit.
let flushed: Promise<unknown> = Promise.resolve();
const toClient = (data: Uint8Array | string) => {
  flushed = flushed.then(() => Bun.write(Bun.stdout, data));
};

/** How long it tries to reach Dashi again, and how often. */
const AGAIN_FOR_MS = 120_000;
const AGAIN_EVERY_MS = 250;

/** A stream's chunks as whole lines; the unfinished tail waits for the next chunk. */
function lineSplitter(): { push(chunk: Uint8Array): string[]; rest(): string } {
  const decoder = new TextDecoder();
  let pending = "";
  return {
    push(chunk) {
      const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
      pending = lines.pop() ?? "";
      return lines;
    },
    rest: () => pending,
  };
}

/** What waits to be written to the socket, in order. */
function outbox(): { push(line: string): void; write(socket: Bun.Socket<undefined>): boolean; clear(): void } {
  const encoder = new TextEncoder();
  let queue: Uint8Array[] = [];
  return {
    push: (line) => void queue.push(encoder.encode(`${line}\n`)),
    /** Writes what the socket takes; true when nothing is left waiting. */
    write(socket) {
      while (queue.length > 0) {
        const next = queue[0] as Uint8Array;
        const written = socket.write(next);
        if (written < next.byteLength) {
          queue[0] = next.subarray(Math.max(written, 0));
          return false;
        }
        queue.shift();
      }
      return true;
    },
    clear() {
      queue = [];
    },
  };
}

/** The agents' server, whose `initialize` and `tools/list` this bridge knows; any other server answers for itself. */
const OWN_SERVER = basename(path) === "dashi-mcp.sock";

/** What a call is told when Dashi can't be reached at the client's first call. */
const UNREACHABLE = `Dashi can't be reached at ${path}. Is a Dashi session running?`;

/**
 * Line by line: the client's lines are answered here until its first tool call, then carried to Dashi;
 * with `reconnect`, `initialize` is said again and what was lost fails when the socket closes.
 */
class Bridge {
  private readonly relay = new McpRelay();
  private readonly out = outbox();
  private socket: Bun.Socket<undefined> | null = null;
  /** It has reached Dashi once: from then on every line is Dashi's to answer. */
  private reached = false;
  private connecting = false;
  /** The client's lines while Dashi is away, or not reached yet. */
  private held: string[] = [];
  private clientDone = false;

  constructor(private readonly reconnect: boolean) {}

  private exit(code: number): void {
    void flushed.then(() => process.exit(code));
  }

  private readonly pump = (): void => {
    if (this.socket && this.out.write(this.socket) && this.clientDone) this.socket.end();
  };

  private send(line: string): void {
    this.out.push(line);
    this.pump();
  }

  private async connect(): Promise<boolean> {
    const lines = lineSplitter();
    try {
      this.socket = await Bun.connect({
        unix: path,
        socket: {
          data: (_socket, data) => {
            for (const line of lines.push(data)) if (line.trim() && this.relay.fromServer(line)) toClient(`${line}\n`);
          },
          drain: this.pump,
          close: () => {
            this.socket = null;
            this.out.clear();
            void this.lost();
          },
        },
      });
      return true;
    } catch {
      this.socket = null;
      return false;
    }
  }

  /** Connected: the client's `initialize` first, then what waited. */
  private resume(): void {
    for (const line of this.relay.reconnected()) this.send(line);
    const waiting = this.held;
    this.held = [];
    for (const line of waiting) this.send(line);
  }

  /** The socket closed: done if the client is, or without `--reconnect`; else what was on its way fails and it connects again. */
  private async lost(): Promise<void> {
    if (this.clientDone || !this.reconnect) return this.exit(0);
    for (const line of this.relay.lost()) toClient(`${line}\n`);
    const until = Date.now() + AGAIN_FOR_MS;
    while (Date.now() < until) {
      await Bun.sleep(AGAIN_EVERY_MS);
      if (await this.connect()) return this.resume();
    }
    console.error(`dashi-mcp: can't reach Dashi at ${path} again; giving up`);
    for (const line of this.relay.lost()) toClient(`${line}\n`);
    this.exit(1);
  }

  /** The client's first tool call: reach Dashi now. A call that can't is told so, and the next one tries again. */
  private async reach(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    this.reached = await this.connect();
    this.connecting = false;
    if (this.reached) return this.resume();
    this.held = [];
    for (const line of this.relay.lost(UNREACHABLE)) toClient(`${line}\n`);
    if (this.clientDone) this.exit(0);
  }

  private fromClient(line: string): void {
    if (!line.trim()) return;
    this.relay.fromClient(line);
    if (this.reached) return this.socket ? this.send(line) : void this.held.push(line);
    const answer = answerLocally(line);
    if (answer.kind === "none") return;
    if (answer.kind === "connect") {
      this.held.push(line);
      return void this.reach();
    }
    // Answered here: nothing is on its way to Dashi for it.
    this.relay.fromServer(answer.line);
    toClient(`${answer.line}\n`);
  }

  async run(): Promise<void> {
    if (!OWN_SERVER) {
      // Another server's tools and words are its own: connect now, and carry every line.
      this.reached = await this.connect();
      if (!this.reached) {
        console.error(`dashi-mcp: can't reach Dashi at ${path}; is a Dashi session running?`);
        process.exit(1);
      }
    }
    const lines = lineSplitter();
    for await (const chunk of Bun.stdin.stream()) {
      for (const line of lines.push(chunk)) this.fromClient(line);
    }
    this.fromClient(lines.rest());
    this.clientDone = true;
    // The client is done: let Dashi see the end once what it sent is written.
    if (this.socket) this.pump();
    else if (!this.connecting) this.exit(0);
  }
}

// Nothing to connect to, now or at a first call: say so at once, as a server that can't start.
if (!existsSync(path)) {
  console.error(`dashi-mcp: can't reach Dashi at ${path}; is a Dashi session running?`);
  process.exit(1);
}
await new Bridge(process.argv.includes("--reconnect")).run();
