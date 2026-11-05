import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { darkColors, lightColors } from "@dashi/ui";
import { DARK_ALPHA, SHADOWS, WindowStyleSync, windowStyle } from "../src/appearance/window-style.ts";
import { parseSettings } from "../src/settings.ts";

const repo = join(import.meta.dir, "../../..");

test("light windows: the recommended shadows, the menu bar's hairline, no ring", () => {
  const style = windowStyle({ dark: false, highlight: false, reduceMotion: false });
  expect(style.shadow.focused).toEqual([
    { x: 0, y: 18, blur: 40, spread: -8, alpha: 0.38 },
    { x: 0, y: 2, blur: 6, spread: 0, alpha: 0.16 },
  ]);
  expect(style.shadow.other).toEqual([{ x: 0, y: 8, blur: 20, spread: -6, alpha: 0.22 }]);
  // Tiles shade the gap, not the neighbor; a filled window casts nothing.
  expect(style.shadow.tiled).toEqual([{ x: 0, y: 0, blur: 8, spread: 0, alpha: 0.2 }]);
  expect(style.shadow.filled).toEqual([]);
  expect(style.edge).toEqual({ color: lightColors.menuBarEdge, width: 1, filled: false });
  expect(style.ring.on).toBe(false);
  expect(style.fade).toBe(150);
});

test("dark windows: every shadow half again as strong, a white hairline", () => {
  const light = windowStyle({ dark: false, highlight: false, reduceMotion: false });
  const dark = windowStyle({ dark: true, highlight: false, reduceMotion: false });
  expect(dark.shadow.focused.map((layer) => layer.alpha)).toEqual([0.57, 0.24]);
  expect(dark.shadow.other[0]?.alpha).toBe(0.33);
  expect(dark.shadow.sheet.map((layer) => layer.alpha)).toEqual(SHADOWS.sheet.map((layer) => Math.round(layer.alpha * DARK_ALPHA * 1000) / 1000));
  // Only the alphas change.
  expect(dark.shadow.focused.map(({ alpha: _, ...rest }) => rest)).toEqual(light.shadow.focused.map(({ alpha: _, ...rest }) => rest));
  expect(dark.edge.color).toBe(darkColors.menuBarEdge);
});

test("the highlight is an accent ring; Reduce Motion stops the fade", () => {
  const style = windowStyle({ dark: false, highlight: true, reduceMotion: true });
  expect(style.ring).toEqual({ on: true, color: lightColors.selection, width: 1.5 });
  expect(style.fade).toBe(0);
});

test("the style goes out once both Dark Mode and the settings are known, then only on a change", async () => {
  const sent: [string, unknown][] = [];
  const sync = new WindowStyleSync({
    request: async (method, params) => {
      sent.push([method, params]);
      return {};
    },
  });
  sync.set({ highlight: false, reduceMotion: false });
  expect(sent).toHaveLength(0);
  sync.set({ dark: false });
  expect(sent).toEqual([["window-style", windowStyle({ dark: false, highlight: false, reduceMotion: false })]]);
  // A settings file rewritten as it was: nothing new.
  sync.set({ highlight: false, reduceMotion: false });
  expect(sent).toHaveLength(1);
  sync.set({ dark: true });
  sync.set({ highlight: true });
  expect(sent).toHaveLength(3);
  expect((sent[2]?.[1] as { ring: { on: boolean } }).ring.on).toBe(true);
});

test("a refused style is sent again on the next change", async () => {
  let refuse = true;
  const sent: unknown[] = [];
  const sync = new WindowStyleSync({
    request: async (_method, params) => {
      sent.push(params);
      if (refuse) throw new Error("old compositor");
      return {};
    },
  });
  sync.set({ dark: false, highlight: false, reduceMotion: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  refuse = false;
  sync.set({ dark: false });
  expect(sent).toHaveLength(2);
});

test("settings.json keeps the highlight, off unless set", () => {
  expect(parseSettings({}).settings.appearance.highlightActiveWindow).toBe(false);
  expect(parseSettings({ appearance: { highlightActiveWindow: true } }).settings.appearance.highlightActiveWindow).toBe(true);
  const wrong = parseSettings({ appearance: { highlightActiveWindow: "yes" } });
  expect(wrong.settings.appearance.highlightActiveWindow).toBe(false);
  expect(wrong.problems.length).toBeGreaterThan(0);
});

test("window-style is handled, documented, and sent", () => {
  const handled = readFileSync(join(repo, "crates/dashi-comp/src/ipc/requests.rs"), "utf8");
  const doc = readFileSync(join(repo, "docs/compositor-ipc.md"), "utf8");
  expect(handled).toContain(`"window-style" =>`);
  expect(doc).toContain("| `window-style` |");
});
