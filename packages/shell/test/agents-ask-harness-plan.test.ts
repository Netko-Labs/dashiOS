import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanTool } from "../src/agents/ask/answerer.ts";
import { PlanRecorder, parsedArguments, plannedWords, servePlan } from "../src/agents/ask/harness/index.ts";
import { TOOLS } from "./support/agents-ask-harness.ts";

const line = (method: string, params: Record<string, unknown> = {}, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });

describe("plan mode", () => {
  test("tools/list is the plan's tools: the same set the Claude API answerer is offered", () => {
    const recorder = new PlanRecorder(TOOLS, "t");
    const init = recorder.handle(line("initialize", { protocolVersion: "2025-06-18" })) as { result: { instructions: string; serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("dashi");
    expect(init.result.instructions).toContain("Nothing runs until the person reads the plan and presses Return");
    expect(recorder.handle(line("notifications/initialized", {}, null))).toBeNull();
    const listed = recorder.handle(line("tools/list")) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain("screenshot");
    expect(listed.result.tools[0]?.inputSchema).toEqual(TOOLS[0]?.schema);
  });

  test("a call is recorded with its parsed arguments and answered, never run", () => {
    const ran: string[] = [];
    // Tools whose check notes it was asked: the recorder checks, and that is all it may do.
    const tools: PlanTool[] = TOOLS.map((tool) => ({
      ...tool,
      check: (args) => {
        ran.push(`check ${tool.name}`);
        return tool.check?.(args) ?? { ok: true };
      },
    }));
    const recorder = new PlanRecorder(tools, "t");
    const reply = recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: true } })) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(reply.result.content[0]?.text).toBe("Planned as step 1; nothing runs until the person presses Return.");
    expect(reply.result.isError).toBeUndefined();
    recorder.handle(line("tools/call", { name: "lock_screen" }, 2));
    expect(recorder.calls).toEqual([
      { id: "t-1", name: "set_setting", input: { name: "dark_mode", value: true } },
      { id: "t-2", name: "lock_screen", input: {} },
    ]);
    expect(ran).toEqual(["check set_setting", "check lock_screen"]);
    expect(plannedWords(2)).toContain("step 2");
  });

  test("a call that doesn't pass, an unknown tool, or one past the last step is answered with why, and not recorded", () => {
    const recorder = new PlanRecorder(TOOLS, "t", 1);
    const bad = recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: "very" } })) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0]?.text).toContain("Not planned: `value` must be true or false.");
    const unknown = recorder.handle(line("tools/call", { name: "screenshot", arguments: {} })) as { result: { isError: boolean } };
    expect(unknown.result.isError).toBe(true);
    const odd = recorder.handle(line("tools/call", { name: "lock_screen", arguments: [1] })) as { result: { isError: boolean } };
    expect(odd.result.isError).toBe(true);
    recorder.handle(line("tools/call", { name: "lock_screen", arguments: {} }));
    const full = recorder.handle(line("tools/call", { name: "lock_screen", arguments: {} })) as { result: { content: Array<{ text: string }> } };
    expect(full.result.content[0]?.text).toContain("nothing more can be added");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.handle("not json")).toMatchObject({ error: { code: -32700 } });
    expect(recorder.handle(line("resources/list"))).toMatchObject({ error: { code: -32601 } });
  });

  test("arguments some MCP clients send as text are parsed as the schema means them", () => {
    const recorder = new PlanRecorder(TOOLS, "t");
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: "true" } }));
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dock_style", value: "taskbar" } }, 2));
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "trackpad_scroll_speed", value: "1.5" } }, 3));
    expect(recorder.calls.map((call) => (call.input as { value: unknown }).value)).toEqual([true, "taskbar", 1.5]);
    const schema = { type: "object", properties: { title: { type: "string" }, n: { type: "integer" } } };
    expect(parsedArguments({ title: "true", n: "x" }, schema)).toEqual({ title: "true", n: "x" });
  });

  test("the socket refuses a process the turn doesn't own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-plan-"));
    const seen: Array<number | null> = [];
    const server = servePlan(join(dir, "turn.sock"), new PlanRecorder(TOOLS, "t"), (pid) => {
      seen.push(pid);
      return false;
    });
    const closed = new Promise<boolean>((resolve) => {
      void Bun.connect({
        unix: server.path,
        socket: { data() {}, close: () => resolve(true), open: (socket) => void socket.write(`${line("tools/list")}\n`) },
      });
    });
    expect(await closed).toBe(true);
    expect(seen).toEqual([process.pid]);
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
