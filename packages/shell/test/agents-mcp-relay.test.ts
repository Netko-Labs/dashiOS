import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOST_CODE, McpRelay } from "../src/agents/mcp-relay.ts";
import { catalog } from "../src/agents/tools/index.ts";
import { until } from "./support/time.ts";

const json = (value: unknown) => JSON.stringify(value);

describe("what the bridge keeps to connect again", () => {
  test("the client's initialize is said again under its own id, and its answer kept from the client", () => {
    const relay = new McpRelay();
    expect(relay.reconnected()).toEqual([]);
    relay.fromClient(json({ jsonrpc: "2.0", id: 0, method: "initialize", params: { clientInfo: { name: "codex" } } }));
    expect(relay.fromServer(json({ jsonrpc: "2.0", id: 0, result: {} }))).toBe(true);
    relay.fromClient(json({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const again = relay.reconnected();
    expect(again.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", id: "dashi-mcp-again-1", method: "initialize", params: { clientInfo: { name: "codex" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(relay.fromServer(json({ jsonrpc: "2.0", id: "dashi-mcp-again-1", result: {} }))).toBe(false);
    // Only once: the client's own answers pass.
    expect(relay.fromServer(json({ jsonrpc: "2.0", id: "dashi-mcp-again-1", result: {} }))).toBe(true);
  });

  test("a request on its way when Dashi goes gets an error; one answered doesn't", () => {
    const relay = new McpRelay();
    relay.fromClient(json({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }));
    relay.fromClient(json({ jsonrpc: "2.0", id: "b", method: "tools/call", params: {} }));
    relay.fromClient(json({ jsonrpc: "2.0", method: "notifications/cancelled" }));
    relay.fromClient("not json");
    relay.fromServer(json({ jsonrpc: "2.0", id: 1, result: {} }));
    const lost = relay.lost().map((line) => JSON.parse(line));
    expect(lost).toEqual([{ jsonrpc: "2.0", id: "b", error: { code: LOST_CODE, message: expect.any(String) } }]);
    expect(relay.lost()).toEqual([]);
  });
});

/** A stand-in for Dashi's MCP server: answers every request but "slow" with what it was and which server it is. */
function fakeDashi(path: string, name: string, seen: string[], onOpen: () => void = () => {}) {
  if (existsSync(path)) unlinkSync(path);
  let pending = "";
  return Bun.listen({
    unix: path,
    socket: {
      open: onOpen,
      data(socket, data) {
        const lines = (pending + new TextDecoder().decode(data)).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const message = JSON.parse(line) as { id?: unknown; method?: string };
          seen.push(`${name}:${message.method}`);
          if (message.id !== undefined && message.method !== "slow") socket.write(`${json({ jsonrpc: "2.0", id: message.id, result: { server: name } })}\n`);
        }
      },
    },
  });
}

/** The bridge as a client drives it: lines in, whole messages out. */
function startBridge(path: string, ...args: string[]) {
  const bridge = Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "dashi-mcp.ts"), ...args], {
    env: { ...process.env, DASHI_MCP_SOCKET: path },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = bridge.stdout.getReader();
  let buffered = "";
  const next = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        return JSON.parse(line) as Record<string, unknown>;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("the bridge ended");
      buffered += new TextDecoder().decode(value);
    }
  };
  const write = (value: unknown) => {
    bridge.stdin.write(`${json(value)}\n`);
    bridge.stdin.flush();
  };
  return { bridge, next, write };
}

const socketIn = (): string => join(mkdtempSync(join(tmpdir(), "dashi-mcp-")), "dashi-mcp.sock");

describe("dashi-mcp connects at the first tool call (D140)", () => {
  test("initialize, tools/list, ping and an unknown method are answered by the bridge: Dashi hears nothing", async () => {
    const path = socketIn();
    const seen: string[] = [];
    let connections = 0;
    const server = fakeDashi(path, "one", seen, () => connections++);
    const { bridge, next, write } = startBridge(path);
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } });
    expect(await next()).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "dashi" }, instructions: expect.any(String) } });
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
    write({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listed = (await next()) as { id: number; result: { tools: { name: string }[] } };
    expect(listed.id).toBe(2);
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(catalog().map((tool) => tool.name));
    write({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
    write({ jsonrpc: "2.0", id: 4, method: "resources/list" });
    expect(await next()).toMatchObject({ id: 4, error: { code: -32601 } });
    bridge.stdin.end();
    expect(await bridge.exited).toBe(0);
    expect(connections).toBe(0);
    expect(seen).toEqual([]);
    server.stop(true);
  });

  test("the first tool call connects, and Dashi hears the client's initialize first", async () => {
    const path = socketIn();
    const seen: string[] = [];
    const server = fakeDashi(path, "one", seen);
    const { bridge, next, write } = startBridge(path);
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code" } } });
    await next();
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
    write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_windows" } });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 2, result: { server: "one" } });
    expect(seen).toEqual(["one:initialize", "one:notifications/initialized", "one:tools/call"]);
    // From then on Dashi answers everything.
    write({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 3, result: { server: "one" } });
    bridge.stdin.end();
    expect(await bridge.exited).toBe(0);
    server.stop(true);
  });

  test("with no socket it does not start; with one nobody answers, the call is told and the next tries again", async () => {
    const path = socketIn();
    expect(await startBridge(path).bridge.exited).toBe(1);
    // A socket file left by a shell that is gone.
    fakeDashi(path, "gone", []).stop(true);
    await Bun.write(path, "");
    const seen: string[] = [];
    const { bridge, next, write } = startBridge(path);
    write({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
    expect(await next()).toMatchObject({ id: 1, error: { code: LOST_CODE, message: expect.stringContaining("can't be reached") } });
    const server = fakeDashi(path, "back", seen);
    write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 2, result: { server: "back" } });
    bridge.stdin.end();
    expect(await bridge.exited).toBe(0);
    server.stop(true);
  });
});

test("another server behind the bridge (plan mode's socket) answers for itself, from the first line", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "dashi-plan-")), "turn.sock");
  const seen: string[] = [];
  const server = fakeDashi(path, "plan", seen);
  const { bridge, next, write } = startBridge(path);
  write({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  expect(await next()).toEqual({ jsonrpc: "2.0", id: 1, result: { server: "plan" } });
  write({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  expect(await next()).toEqual({ jsonrpc: "2.0", id: 2, result: { server: "plan" } });
  expect(seen).toEqual(["plan:initialize", "plan:tools/list"]);
  bridge.stdin.end();
  expect(await bridge.exited).toBe(0);
  server.stop(true);
});

describe("dashi-mcp --reconnect", () => {
  test("outlives the server restarting: what was on its way fails, the next call works, and it never sees the second initialize", async () => {
    const path = socketIn();
    const seen: string[] = [];
    let server = fakeDashi(path, "one", seen);
    const { bridge, next, write } = startBridge(path, "--reconnect");

    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(await next()).toMatchObject({ id: 1, result: { serverInfo: { name: "dashi" } } });
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
    write({ jsonrpc: "2.0", id: 10, method: "tools/call", params: {} });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 10, result: { server: "one" } });
    write({ jsonrpc: "2.0", id: 2, method: "slow", params: {} });
    await until(() => seen.includes("one:slow"), "the slow call");

    // The shell restarts: its socket goes, and a new one comes up a moment later.
    server.stop(true);
    expect(await next()).toMatchObject({ id: 2, error: { code: LOST_CODE } });
    server = fakeDashi(path, "two", seen);

    write({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {} });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 3, result: { server: "two" } });
    expect(seen.filter((each) => each.startsWith("two:"))).toEqual(["two:initialize", "two:notifications/initialized", "two:tools/call"]);

    bridge.stdin.end();
    expect(await bridge.exited).toBe(0);
    server.stop(true);
  });
});
