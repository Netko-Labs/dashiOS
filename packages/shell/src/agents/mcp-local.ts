/**
 * What `dashi-mcp` (bin/dashi-mcp.ts) answers by itself, before it has
 * connected to Dashi (decisions.md D140): `initialize`, `ping` and
 * `tools/list`, and "method not found" for what Dashi does not speak. None
 * of them depends on the session: the tools and the instructions are one
 * table (tools/registry.ts), the same for every agent, whatever it was
 * allowed. So a client that only starts the server and lists its tools,
 * as every chat of a harness does, never reaches the shell; the bridge
 * connects at its first `tools/call`, and says the client's `initialize`
 * again there (mcp-relay.ts). Another server behind the same bridge (plan
 * mode's, ask/harness/lib/plan-server.ts) has other tools and words: the
 * bridge answers nothing for it. Pure: a line in, what to do with it out.
 */

import * as mcp from "./lib/mcp.ts";
import { catalog, INSTRUCTIONS } from "./tools/index.ts";

/** The answer to `initialize`, from the bridge or from the session. */
export function initializeResult(params: Record<string, unknown>): Record<string, unknown> {
  return {
    protocolVersion: mcp.negotiate(params.protocolVersion),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "dashi", title: "Dashi", version: "0.1.0" },
    instructions: INSTRUCTIONS,
  };
}

/** What becomes of a client's line while the bridge is not connected: answered here, dropped, or the reason to connect. */
export type LocalAnswer = { kind: "reply"; line: string } | { kind: "none" } | { kind: "connect" };

export function answerLocally(line: string): LocalAnswer {
  const incoming = mcp.parse(line);
  const reply = (message: unknown): LocalAnswer => ({ kind: "reply", line: JSON.stringify(message) });
  if (incoming.kind === "invalid") return reply(mcp.error(incoming.id, incoming.code, incoming.message));
  // A notification (`notifications/initialized`, a cancel of nothing) and a stray answer need no reply.
  if (incoming.kind !== "request") return { kind: "none" };
  const { id, method, params } = incoming;
  switch (method) {
    case "initialize":
      return reply(mcp.result(id, initializeResult(params)));
    case "ping":
      return reply(mcp.result(id, {}));
    case "tools/list":
      return reply(mcp.result(id, { tools: catalog() }));
    case "tools/call":
      return { kind: "connect" };
    default:
      return reply(mcp.error(id, mcp.METHOD_NOT_FOUND, "Method not found"));
  }
}
