/**
 * The agents' tools, now written from actions: `tools/list` is what MCP
 * clients saw before (fixtures/mcp-tools-list.json is 0.3's list, taken from
 * b4f031a before the registry), and every tool is still called the same way.
 */

import { describe, expect, test } from "bun:test";
import { mayUse } from "../src/actions/registry.ts";
import { ASKS_EVERY_TIME, mcpListing, PERSON_TOOLS, toolAddress } from "../src/actions/tools.ts";
import { catalog, INSTRUCTIONS, parseCall, scopeOf, TOOL_ACTIONS, TOOLS } from "../src/agents/tools/index.ts";
import fixture from "./fixtures/mcp-tools-list.json";

describe("tools/list from the registry", () => {
  test("is byte for byte the list agents saw before", () => {
    expect(JSON.stringify(catalog())).toBe(JSON.stringify(fixture.tools));
    expect(INSTRUCTIONS).toBe(fixture.instructions);
  });

  test("lists every tool, once, in the same order, under the same name", () => {
    expect(catalog().map((tool) => tool.name)).toEqual(fixture.tools.map((tool) => tool.name));
    expect(new Set(catalog().map((tool) => tool.name)).size).toBe(TOOLS.length);
  });

  test("every tool is an action at its own address, for agents", () => {
    expect(TOOL_ACTIONS.map((action) => action.tool)).toEqual(TOOLS.map((tool) => tool.name));
    for (const action of TOOL_ACTIONS) {
      expect(action.address).toBe(toolAddress(action.tool as never));
      expect(mayUse(action, "agents")).toBe(true);
      expect(action.scope).toBe(scopeOf({ name: action.tool } as never));
    }
    expect(new Set(TOOL_ACTIONS.map((action) => action.address)).size).toBe(TOOL_ACTIONS.length);
  });

  test("a person-only action is never listed for agents", () => {
    const [first] = TOOL_ACTIONS;
    if (!first) throw new Error("no tools");
    expect(mcpListing([{ ...first, who: "person" }])).toEqual([]);
  });
});

describe("tools/call", () => {
  test("every tool with no required arguments still parses an empty call", () => {
    for (const tool of fixture.tools.filter((each) => each.inputSchema.required.length === 0)) {
      const call = parseCall({ name: tool.name, arguments: {} });
      // Some take one of two optional arguments (force_quit_app: window or pid); the rest parse.
      if ("arguments" in call) expect(["force_quit_app", "set_volume", "request_software_update"]).toContain(tool.name);
      else expect(call).toMatchObject({ name: tool.name });
    }
  });

  test("the same checks and the same words for what is wrong", () => {
    expect(parseCall({ name: "nope" })).toEqual({ unknown: "nope" });
    expect(parseCall({ name: "lock_screen", arguments: [] })).toEqual({ arguments: "`arguments` must be an object." });
    expect(parseCall({ name: "lock_screen", arguments: { now: true } })).toEqual({ arguments: "`now` is not an argument of lock_screen; it takes none." });
    expect(parseCall({ name: "focus_window", arguments: { window: "w3" } })).toEqual({ name: "focus_window", window: 3 });
    expect(parseCall({ name: "set_setting", arguments: { name: "dark_mode", value: true } })).toEqual({
      name: "set_setting",
      setting: "dark_mode",
      value: true,
    });
    expect(parseCall({ name: "set_setting", arguments: { name: "mouse_scroll_speed", value: 9 } })).toEqual({
      arguments: "`value` must be a number from 0.25 to 4.",
    });
  });

  test("an action's check is the tool's check", () => {
    const setting = TOOL_ACTIONS.find((action) => action.tool === "set_setting");
    expect(setting?.check({ name: "mouse_scroll_speed", value: 9 })).toEqual({ ok: false, error: "`value` must be a number from 0.25 to 4." });
    expect(setting?.check({ name: "dark_mode", value: true }).ok).toBe(true);
    expect(setting?.check({ name: "dark_mode", value: true, extra: 1 })).toMatchObject({ ok: false });
  });

  test("a person's run goes through the tool, and its text comes back", async () => {
    const lock = TOOL_ACTIONS.find((action) => action.tool === "lock_screen");
    const checked = lock?.check({});
    if (!checked?.ok) throw new Error("lock_screen did not check");
    const calls: unknown[] = [];
    const outcome = await checked.run({
      window: null,
      tool: async (call) => {
        calls.push(call);
        return { content: [{ type: "text", text: "The screen is locked." }] };
      },
    });
    expect(calls).toEqual([{ name: "lock_screen" }]);
    expect(outcome).toEqual({ ok: true, text: "The screen is locked." });
  });
});

describe("who uses which tool", () => {
  test("what only agents can do stays theirs", () => {
    for (const name of ["screenshot", "record_screen", "click", "type_text", "press_keys", "sign_in", "fill_code", "pay", "hand_over", "list_logins"]) {
      expect(TOOL_ACTIONS.find((action) => action.tool === name)?.who).toBe("agents");
    }
  });

  test("the person's tools are both sides', and those that ask every time say so", () => {
    for (const name of Object.keys(PERSON_TOOLS)) expect(TOOL_ACTIONS.find((action) => action.tool === name)?.who).toBe("both");
    for (const name of ASKS_EVERY_TIME) expect(TOOL_ACTIONS.find((action) => action.tool === name)?.asksEveryTime).toBe(true);
    expect(TOOL_ACTIONS.find((action) => action.tool === "lock_screen")?.asksEveryTime).toBeUndefined();
  });
});
