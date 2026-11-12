/**
 * vm/agent's pointer: a QMP click in the VM made while the agent's session
 * is open, after a screenshot, so the menu bar has the agents' mark in it
 * when clicked as it had in the stills (a click made with no session lands
 * one item off). Run against a stand-in MCP server and a stand-in QMP socket.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT = join(import.meta.dir, "../../../vm/agent");
const FAKE_MCP = join(import.meta.dir, "fixtures/fake-mcp.ts");

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Seen {
  what: string;
  at: number;
}

async function run(args: string[], stdin = ""): Promise<{ code: number; mcp: Seen[]; qmp: (Seen & { arguments: unknown })[] }> {
  dir = mkdtempSync(join(tmpdir(), "vm-agent-"));
  const log = join(dir, "mcp.log");
  const qmpPath = join(dir, "qmp.sock");
  const qmp: (Seen & { arguments: unknown })[] = [];
  const server = Bun.listen<{ pending: string }>({
    unix: qmpPath,
    socket: {
      open(socket) {
        socket.data = { pending: "" };
        socket.write(`${JSON.stringify({ QMP: { version: {} } })}\n`);
      },
      data(socket, chunk) {
        socket.data.pending += new TextDecoder().decode(chunk);
        const lines = socket.data.pending.split("\n");
        socket.data.pending = lines.pop() ?? "";
        for (const line of lines.filter((each) => each.trim())) {
          const message = JSON.parse(line) as { execute: string; arguments: unknown };
          qmp.push({ what: message.execute, arguments: message.arguments, at: performance.timeOrigin + performance.now() });
          socket.write(`${JSON.stringify({ return: {} })}\n`);
        }
      },
    },
  });
  const child = Bun.spawn(["python3", "-I", AGENT, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "ignore",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, DASHI_AGENT_CMD: `${process.execPath} ${FAKE_MCP} ${log}`, DASHI_AGENT_QMP: qmpPath },
  });
  const code = await child.exited;
  server.stop(true);
  const mcp = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Seen);
  return { code, mcp, qmp };
}

const inputs = (qmp: (Seen & { arguments: unknown })[]) => qmp.filter((each) => each.what === "input-send-event");

test("pointer clicks inside the session, after a screenshot, at that screenshot's pixels", async () => {
  const { code, mcp, qmp } = await run(["pointer", "961", "25"]);
  expect(code).toBe(0);
  // Two screenshots: the first brings the agents' mark, the second is the screen the click meets.
  expect(mcp.filter((each) => each.what === "call screenshot")).toHaveLength(2);
  const shot = mcp.findLast((each) => each.what === "call screenshot");
  const end = mcp.find((each) => each.what === "end");
  const events = inputs(qmp);
  expect(shot).toBeDefined();
  expect(events).toHaveLength(3);
  // Moved to the middle of a 1922-wide screen, near its top, then pressed and let go.
  expect(events[0]?.arguments).toEqual({
    events: [
      { type: "abs", data: { axis: "x", value: Math.trunc((961 / 1922) * 32767) } },
      { type: "abs", data: { axis: "y", value: Math.trunc((25 / 1201) * 32767) } },
    ],
  });
  expect(events.slice(1).map((each) => each.arguments)).toEqual([
    { events: [{ type: "btn", data: { down: true, button: "left" } }] },
    { events: [{ type: "btn", data: { down: false, button: "left" } }] },
  ]);
  // The agent was connected the whole time: the screenshot came first, the session ended after.
  for (const event of events) {
    expect(event.at).toBeGreaterThan(shot?.at ?? Number.POSITIVE_INFINITY);
    expect(event.at).toBeLessThan(end?.at ?? 0);
  }
});

test("a batch mixes tool calls with pointer, key and sleep lines in one session", async () => {
  const { code, mcp, qmp } = await run(["batch", "-"], "screenshot {}\npointer 100 25 right\nkey esc\nlist_windows\n");
  expect(code).toBe(0);
  expect(mcp.map((each) => each.what)).toEqual(["call screenshot", "call screenshot", "call screenshot", "call list_windows", "end"]);
  expect(inputs(qmp).map((each) => each.arguments)).toContainEqual({ events: [{ type: "btn", data: { down: true, button: "right" } }] });
  expect(qmp.find((each) => each.what === "send-key")?.arguments).toMatchObject({ keys: [{ type: "qcode", data: "esc" }] });
});
