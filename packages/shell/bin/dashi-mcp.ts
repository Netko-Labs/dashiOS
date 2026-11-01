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
 */

import { join } from "node:path";

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const path = process.env.DASHI_MCP_SOCKET || join(runtime, "dashi-mcp.sock");

// Replies go out in order, each written in full, before any exit.
let flushed: Promise<unknown> = Promise.resolve();
let drained: (() => void) | null = null;

let socket: Bun.Socket<undefined>;
try {
  socket = await Bun.connect({
    unix: path,
    socket: {
      data(_socket, data) {
        const copy = new Uint8Array(data);
        flushed = flushed.then(() => Bun.write(Bun.stdout, copy));
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
