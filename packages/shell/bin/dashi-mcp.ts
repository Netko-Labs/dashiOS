#!/usr/bin/env bun
/**
 * dashi-mcp: Dashi's MCP server for agents, over stdio. The server runs in
 * the Dashi session (shell/src/agents); this copies stdin to its socket and
 * the socket to stdout, nothing more, so MCP clients can spawn it:
 *
 *   claude mcp add dashi -- bun <dashi>/shell/bin/dashi-mcp.ts
 *   ssh <host> bun <dashi>/shell/bin/dashi-mcp.ts     (from another machine)
 *
 * The person at the screen is asked before the agent may see or do
 * anything (docs/agents.html).
 *
 * With `--reconnect` (a launcher run's harness starts it so: agents/handoff/),
 * it outlives the shell restarting: when the socket closes it connects again
 * for up to two minutes, says the client's `initialize` again, and answers
 * a request that was on its way with an error (src/agents/mcp-relay.ts).
 * Without it, it ends when the socket does.
 */

import { join } from "node:path";
import { McpRelay } from "../src/agents/mcp-relay.ts";

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const path = process.env.DASHI_MCP_SOCKET || join(runtime, "dashi-mcp.sock");

// Replies go out in order, each written in full, before any exit.
let flushed: Promise<unknown> = Promise.resolve();
const toClient = (data: Uint8Array | string) => {
  flushed = flushed.then(() => Bun.write(Bun.stdout, data));
};

/** Stdin to the socket and back as bytes; it ends when either does. */
async function plain(): Promise<void> {
  let drained: (() => void) | null = null;
  let socket: Bun.Socket<undefined>;
  try {
    socket = await Bun.connect({
      unix: path,
      socket: {
        data(_socket, data) {
          toClient(new Uint8Array(data));
        },
        drain() {
          drained?.();
          drained = null;
        },
        close() {
          void flushed.then(() => process.exit(0));
        },
      },
    });
  } catch (error) {
    console.error(`dashi-mcp: can't reach Dashi at ${path} (${error}); is a Dashi session running?`);
    process.exit(1);
  }

  for await (const chunk of Bun.stdin.stream()) {
    let rest = chunk;
    while (rest.byteLength > 0) {
      const written = socket.write(rest);
      rest = rest.subarray(Math.max(written, 0));
      if (rest.byteLength > 0) await new Promise<void>((resolve) => (drained = resolve));
    }
  }
  // The client is done: let Dashi see the end.
  socket.end();
}

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

/** Line by line, so it can say `initialize` again and fail what was lost when the socket closes. */
async function reconnecting(): Promise<void> {
  const relay = new McpRelay();
  const out = outbox();
  let socket: Bun.Socket<undefined> | null = null;
  /** The client's lines while Dashi is away. */
  let held: string[] = [];
  let clientDone = false;

  const pump = () => {
    if (socket && out.write(socket) && clientDone) socket.end();
  };
  const send = (line: string) => {
    out.push(line);
    pump();
  };

  const connect = async (): Promise<boolean> => {
    const lines = lineSplitter();
    try {
      socket = await Bun.connect({
        unix: path,
        socket: {
          data(_socket, data) {
            for (const line of lines.push(data)) if (line.trim() && relay.fromServer(line)) toClient(`${line}\n`);
          },
          drain: pump,
          close() {
            socket = null;
            out.clear();
            void lost();
          },
        },
      });
      return true;
    } catch {
      socket = null;
      return false;
    }
  };

  /** The socket closed: done if the client is, else what was on its way fails and it connects again. */
  const lost = async () => {
    if (clientDone) return void flushed.then(() => process.exit(0));
    for (const line of relay.lost()) toClient(`${line}\n`);
    const until = Date.now() + AGAIN_FOR_MS;
    while (Date.now() < until) {
      await Bun.sleep(AGAIN_EVERY_MS);
      if (!(await connect())) continue;
      for (const line of relay.reconnected()) send(line);
      const waiting = held;
      held = [];
      for (const line of waiting) send(line);
      return;
    }
    console.error(`dashi-mcp: can't reach Dashi at ${path} again; giving up`);
    for (const line of relay.lost()) toClient(`${line}\n`);
    void flushed.then(() => process.exit(1));
  };

  if (!(await connect())) {
    console.error(`dashi-mcp: can't reach Dashi at ${path}; is a Dashi session running?`);
    process.exit(1);
  }

  const lines = lineSplitter();
  const fromClient = (line: string) => {
    if (!line.trim()) return;
    relay.fromClient(line);
    if (socket) send(line);
    else held.push(line);
  };
  for await (const chunk of Bun.stdin.stream()) {
    for (const line of lines.push(chunk)) fromClient(line);
  }
  fromClient(lines.rest());
  clientDone = true;
  // The client is done: let Dashi see the end once what it sent is written.
  if (socket) pump();
  else void flushed.then(() => process.exit(0));
}

if (process.argv.includes("--reconnect")) await reconnecting();
else await plain();
