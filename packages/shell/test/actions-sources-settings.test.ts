import { describe, expect, test } from "bun:test";
import { ActionRegistry, fixedSource } from "../src/actions/registry.ts";
import { settingsActions } from "../src/actions/sources/settings.ts";
import type { ActionContext } from "../src/actions/types.ts";
import type { Call } from "../src/agents/tools/types.ts";
import { AGENT_ROWS } from "../src/settings-app/registry/index.ts";
import { scrollFor } from "../src/settings-app/spot.tsx";
import { PANES } from "../src/shared/settings/panes.ts";
import { run } from "./support/actions-sources.ts";
import { fakeClockEachTest } from "./support/time.ts";

fakeClockEachTest();

describe("settings", () => {
  const state: Record<string, unknown> = { dark_mode: false, window_corners: "medium", mouse_scroll_speed: 1 };
  const opened: unknown[] = [];
  const calls: Call[] = [];
  const registry = new ActionRegistry();
  registry.add(
    fixedSource("settings", settingsActions({ state: (row) => (state[row.agent ?? ""] ?? null) as never, open: (pane, row) => void opened.push([pane, row]) })),
  );
  const ctx: ActionContext = {
    window: null,
    tool: async (call) => {
      calls.push(call);
      return { content: [{ type: "text", text: "done" }] };
    },
  };

  test("every pane, and every setting set_setting knows, has an address", () => {
    for (const pane of PANES) expect(registry.get(`dashi://settings/${pane.id}`)?.title).toBe(pane.title);
    const names = AGENT_ROWS.map((row) => row.agent ?? "");
    // The ten agents had before the registry are all still there, by the same names.
    for (const name of [
      "battery_percentage",
      "dark_mode",
      "do_not_disturb",
      "dock_autohide",
      "dock_style",
      "mouse_scroll_speed",
      "night_shift",
      "sound_in_menu_bar",
      "trackpad_scroll_speed",
      "window_corners",
    ])
      expect(names).toContain(name);
    for (const row of AGENT_ROWS) expect(registry.get(`dashi://settings/${row.id}`)?.scope).toBe("settings");
    expect(registry.get("dashi://settings/appearance/dark-mode")).toMatchObject({ kind: "toggle", place: { pane: "appearance", row: "dark-mode" } });
    expect(registry.get("dashi://settings/appearance/dark-mode")?.state?.()).toBe(false);
  });

  test("a toggle with no value switches; a value is checked by set_setting's own check", async () => {
    await run(registry.get("dashi://settings/appearance/dark-mode"), {}, ctx);
    await run(registry.get("dashi://settings/appearance/window-corners"), { value: "large" }, ctx);
    expect(calls).toEqual([
      { name: "set_setting", setting: "dark_mode", value: true },
      { name: "set_setting", setting: "window_corners", value: "large" },
    ]);
    expect(registry.get("dashi://settings/mouse/scrolling-speed")?.check({ value: 300 })).toEqual({
      ok: false,
      error: "`value` must be a number from 0.25 to 4.",
    });
  });

  test("a pane opens Settings there", async () => {
    await run(registry.get("dashi://settings/sound"));
    expect(opened).toEqual([["sound", undefined]]);
  });

  test("a row is scrolled to only when it is out of view", () => {
    const page = { x: 0, y: 40, width: 500, height: 400 };
    expect(scrollFor({ x: 0, y: 100, width: 500, height: 44 }, page)).toBe(0);
    expect(scrollFor({ x: 0, y: 700, width: 500, height: 44 }, page)).toBe(636);
    expect(scrollFor({ x: 0, y: 30, width: 500, height: 44 }, page)).toBe(-34);
  });
});
