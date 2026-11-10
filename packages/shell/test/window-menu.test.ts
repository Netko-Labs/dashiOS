import { describe, expect, test } from "bun:test";
import { ActionRegistry, fixedSource } from "../src/actions/registry.ts";
import { runAction } from "../src/actions/run.ts";
import { arrangeActions } from "../src/actions/sources/windows.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import { KEYMAP } from "../src/keymap/keymap.ts";
import { type KeyChord, resolveChord } from "../src/keymap/keymap-match.ts";
import type { Tile } from "../src/layout.ts";
import { buildMenu, isEnabled } from "../src/menus/model.ts";
import type { MenuContext, MenuEntry } from "../src/menus/types.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";
import { fakeCompositor } from "./support/compositor.ts";

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

  test("arrows, Return, C, R, and F are bound to the registry's addresses, before the reserved ⌃❖ chords", () => {
    const bound = (name: string) => ({ kind: "bind" as const, name });
    expect(resolveChord(chord("Left"), "dev.dashi.files")).toEqual(bound("dashi://window/arrange/left"));
    expect(resolveChord(chord("Up"), "dev.dashi.files")).toEqual(bound("dashi://window/arrange/up"));
    expect(resolveChord(chord("Down"), "foot")).toEqual(bound("dashi://window/arrange/down"));
    expect(resolveChord(chord("Return"), "dev.dashi.files")).toEqual(bound("dashi://window/arrange/fill"));
    expect(resolveChord(chord("KP_Enter"), "dev.dashi.files")).toEqual(bound("dashi://window/arrange/fill"));
    expect(resolveChord(chord("c"), "foot")).toEqual(bound("dashi://window/arrange/center"));
    expect(resolveChord(chord("r"), "dev.dashi.files")).toEqual(bound("dashi://window/arrange/restore"));
    expect(resolveChord(chord("f"), "dev.dashi.files")).toEqual(bound("dashi://window/full-screen"));
    expect(resolveChord(chord("x"), "dev.dashi.files")).toEqual({ kind: "swallow" });
  });

  test("an address binding goes to the registry, with the focused window", async () => {
    const ran: unknown[] = [];
    const actions = {
      hardware: { run: async () => true },
      runAddress: async (address: string, window: number | null) => void ran.push([address, window]),
    } as unknown as ShellActions;
    const compositor: Requests = fakeCompositor(async () => ({}), { windows: async () => [] });
    await runBinding("dashi://window/arrange/left", 7, compositor, actions);
    await runBinding("dashi://window/full-screen", null, compositor, actions);
    // Before the hardware keys, which would have taken anything.
    expect(ran).toEqual([
      ["dashi://window/arrange/left", 7],
      ["dashi://window/full-screen", null],
    ]);
  });

  test("the bound addresses reach the arranger: arrows chain, the rest arrange, nothing without a window", async () => {
    const done: unknown[] = [];
    const registry = new ActionRegistry();
    registry.add(
      fixedSource(
        "windows",
        arrangeActions({
          windows: async () => [],
          appName: () => "",
          focus: async () => {},
          arrow: async (window, arrow) => void done.push(["arrow", window, arrow]),
          tile: async (window, to) => void done.push(["tile", window, to]),
          fullscreen: async (window) => void done.push(["fullscreen", window]),
          keymap: KEYMAP,
        }),
      ),
    );
    const deps = { context: (window: number | null) => ({ window }), log: () => {}, reveal: () => {}, confirmLink: async () => false };
    const press = async (when: string, window: number | null) => {
      const rule = KEYMAP.rules.find((each) => each.when === when);
      const action = rule?.bind ? registry.get(rule.bind) : undefined;
      if (!action) throw new Error(`nothing bound to ${when}`);
      return runAction(action, {}, "person", deps, window);
    };
    for (const when of ["super+ctrl+Left", "super+ctrl+Up", "super+ctrl+Return|KP_Enter", "super+ctrl+c", "super+ctrl+r", "super+ctrl+f"]) await press(when, 7);
    expect(await press("super+ctrl+Left", null)).toEqual({ ok: false, error: "No window is focused." });
    expect(done).toEqual([
      ["arrow", 7, "left"],
      ["arrow", 7, "up"],
      ["tile", 7, "fill"],
      ["tile", 7, "center"],
      ["tile", 7, "restore"],
      ["fullscreen", 7],
    ]);
    // Each shows its key, from the keymap.
    expect(registry.get("dashi://window/arrange/left")?.shortcut).toBe("⌃❖←");
    expect(registry.get("dashi://window/arrange/fill")?.shortcut).toBe("⌃❖↩");
    expect(registry.get("dashi://window/full-screen")?.shortcut).toBe("⌃❖F");
  });
});
