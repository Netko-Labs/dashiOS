import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOST_CODE, McpRelay } from "../src/agents/mcp-relay.ts";
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
function fakeDashi(path: string, name: string, seen: string[]) {
  if (existsSync(path)) unlinkSync(path);
  let pending = "";
  return Bun.listen({
    unix: path,
    socket: {
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

describe("dashi-mcp --reconnect", () => {
  test("outlives the server restarting: what was on its way fails, the next call works, and it never sees the second initialize", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "dashi-mcp-")), "dashi-mcp.sock");
    const seen: string[] = [];
    let server = fakeDashi(path, "one", seen);
    const bridge = Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "dashi-mcp.ts"), "--reconnect"], {
      env: { ...process.env, DASHI_MCP_SOCKET: path },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
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

    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 1, result: { server: "one" } });
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
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
