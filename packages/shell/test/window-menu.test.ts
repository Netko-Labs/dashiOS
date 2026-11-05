import { describe, expect, test } from "bun:test";
import type { CompositorWindow } from "../src/compositor.ts";
import { type KeyChord, resolveChord } from "../src/keymap-match.ts";
import type { Tile } from "../src/layout.ts";
import { buildMenu, isEnabled, type MenuContext, type MenuEntry } from "../src/menus/model.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";

const files: CompositorWindow = {
  id: 7,
  appId: "dev.dashi.files",
  title: "Files",
  pid: 9,
  focused: true,
  state: "normal",
  frame: { x: 300, y: 200, width: 800, height: 600 },
  titleBar: 0,
};

const context = (arrangement: Tile | null, focused: CompositorWindow | null = files): MenuContext => ({
  appName: "Files",
  windows: focused ? [focused] : [],
  focused,
  canLaunch: true,
  canOpenHelp: false,
  arrangement,
});

const row = (entries: MenuEntry[], label: string) => entries.find((entry) => entry.kind === "item" && entry.label === label);
const labels = (entries: MenuEntry[]) => entries.flatMap((entry) => (entry.kind === "item" ? [entry.label] : []));

describe("the Window menu", () => {
  test("Fill once, Center, the halves and quarters with their keys, and no Zoom", () => {
    const entries = buildMenu("window", context(null));
    expect(labels(entries)).not.toContain("Zoom");
    expect(labels(entries).filter((label) => label === "Fill")).toHaveLength(1);
    expect(entries.flatMap((entry) => (entry.kind === "item" && entry.keys?.startsWith("⌃❖") ? [[entry.label, entry.keys]] : []))).toEqual([
      ["Fill", "⌃❖↩"],
      ["Center", "⌃❖C"],
      ["Left Half", "⌃❖←"],
      ["Right Half", "⌃❖→"],
      ["Top Half", "⌃❖↑"],
      ["Bottom Half", "⌃❖↓"],
      ["Top Left Quarter", "⌃❖← ↑"],
      ["Top Right Quarter", "⌃❖→ ↑"],
      ["Bottom Left Quarter", "⌃❖← ↓"],
      ["Bottom Right Quarter", "⌃❖→ ↓"],
      ["Back to Previous Size", "⌃❖R"],
    ]);
    expect(buildMenu("view", context(null)).some((entry) => entry.kind === "item" && entry.label === "Zoom")).toBe(false);
  });

  test("Back to Previous Size is disabled when there is nothing to go back to (bug 5)", () => {
    const back = (arrangement: Tile | null) => row(buildMenu("window", context(arrangement)), "Back to Previous Size");
    expect(back(null)).toMatchObject({ action: null });
    expect(back("left")).toMatchObject({ action: { kind: "tile", window: 7, tile: "restore" } });
    expect(back("fill")).toMatchObject({ action: { kind: "tile", window: 7, tile: "restore" } });
  });

  test("the window's own arrangement is checked", () => {
    const entries = buildMenu("window", context("top-left"));
    expect(row(entries, "Top Left Quarter")).toMatchObject({ checked: true });
    expect(row(entries, "Fill")).not.toHaveProperty("checked");
    expect(row(buildMenu("window", context("fill")), "Fill")).toMatchObject({ checked: true, action: { kind: "tile", tile: "fill" } });
  });

  test("a full-screen window, or no window, arranges nothing", () => {
    for (const ctx of [context("left", { ...files, fullscreen: true }), context(null, null)]) {
      const entries = buildMenu("window", ctx);
      for (const label of ["Fill", "Center", "Left Half", "Bottom Right Quarter", "Back to Previous Size"]) {
        const entry = row(entries, label);
        expect(entry && isEnabled(entry)).toBe(false);
      }
    }
  });
});

describe("the ⌃❖ keys", () => {
  const chord = (key: string): KeyChord => ({ mods: ["super", "ctrl"], key });

  test("arrows, Return, C, and R are bound before the reserved ⌃❖ chords", () => {
    expect(resolveChord(chord("Left"), "dev.dashi.files")).toEqual({ kind: "bind", name: "tile-left" });
    expect(resolveChord(chord("Up"), "dev.dashi.files")).toEqual({ kind: "bind", name: "tile-up" });
    expect(resolveChord(chord("Down"), "foot")).toEqual({ kind: "bind", name: "tile-down" });
    expect(resolveChord(chord("Return"), "dev.dashi.files")).toEqual({ kind: "bind", name: "tile-fill" });
    expect(resolveChord(chord("KP_Enter"), "dev.dashi.files")).toEqual({ kind: "bind", name: "tile-fill" });
    expect(resolveChord(chord("c"), "foot")).toEqual({ kind: "bind", name: "tile-center" });
    expect(resolveChord(chord("r"), "dev.dashi.files")).toEqual({ kind: "bind", name: "tile-restore" });
    expect(resolveChord(chord("f"), "dev.dashi.files")).toEqual({ kind: "bind", name: "fullscreen" });
    expect(resolveChord(chord("x"), "dev.dashi.files")).toEqual({ kind: "swallow" });
  });

  test("the bindings reach the arranger: arrows chain, the rest arrange", async () => {
    const done: unknown[] = [];
    const actions = {
      hardware: { run: async () => false },
      tile: async (window: number, to: string) => void done.push(["tile", window, to]),
      arrow: async (window: number, arrow: string) => void done.push(["arrow", window, arrow]),
    } as unknown as ShellActions;
    const compositor = { request: async () => ({}), windows: async () => [] } as unknown as Requests;
    for (const name of ["tile-left", "tile-up", "tile-fill", "tile-center", "tile-restore"]) await runBinding(name, 7, compositor, actions);
    await runBinding("tile-left", null, compositor, actions);
    expect(done).toEqual([
      ["arrow", 7, "left"],
      ["arrow", 7, "up"],
      ["tile", 7, "fill"],
      ["tile", 7, "center"],
      ["tile", 7, "restore"],
    ]);
  });
});
