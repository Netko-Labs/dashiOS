import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, darkColors, LOGIN_GROUND, LOGIN_INK, LOGIN_MUTED, TRUE_BLACK } from "@dashi/ui";
import { DARK_TERMINAL } from "../apps/terminal/palette.ts";
import { gtkColors } from "../src/appearance/gtk-colors.ts";
import { DARK_CONTROLS, LIGHT_CONTROLS, panelEdge } from "../src/shared/controls/palette.ts";

// Dark is true black everywhere Dashi draws (docs/design.html, "Tokens"):
// Control Center, Settings, GTK's colors, Terminal, the login screen and the
// compositor's title bars take their grounds from TRUE_BLACK, and their inks
// and controls still meet CO-6 on every one.

const repo = join(import.meta.dir, "../../..");

describe("Control Center's and Settings' controls on true black", () => {
  const grounds = { panel: DARK_CONTROLS.surface, "off tile and card": DARK_CONTROLS.off, window: DARK_CONTROLS.window, sidebar: DARK_CONTROLS.sidebar };

  test("the panel and Settings' window are the black ground; tiles, cards and the sidebar its lifts", () => {
    expect(DARK_CONTROLS.surface).toBe(TRUE_BLACK.ground);
    expect(DARK_CONTROLS.window).toBe(TRUE_BLACK.ground);
    expect(DARK_CONTROLS.sidebar).toBe(TRUE_BLACK.lift);
    expect(DARK_CONTROLS.off).toBe(TRUE_BLACK.raised);
  });

  for (const [name, ground] of Object.entries(grounds)) {
    test(`words and muted words are AA on the ${name}`, () => {
      const inks = ["text", "muted", "offInk"] as const;
      expect(inks.filter((ink) => contrastRatio(DARK_CONTROLS[ink], ground) < 4.5)).toEqual([]);
    });
    test(`green, the ink fill and the purple ring stand 3:1 on the ${name}`, () => {
      const edges = ["on", "fill", "focus"] as const;
      expect(edges.filter((edge) => contrastRatio(DARK_CONTROLS[edge], ground) < 3)).toEqual([]);
    });
  }

  test("green keeps its ink and the fill its words", () => {
    expect(DARK_CONTROLS.on).toBe("#86d3b6");
    expect(contrastRatio(DARK_CONTROLS.onInk, DARK_CONTROLS.on)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DARK_CONTROLS.fillInk, DARK_CONTROLS.fill)).toBeGreaterThanOrEqual(4.5);
  });

  test("a floating panel takes a hairline on black, where its shadow does nothing, and nothing in Light", () => {
    expect(panelEdge(true)).toEqual({ borderWidth: 1, borderColor: TRUE_BLACK.edge });
    expect(panelEdge(false)).toEqual({});
  });

  test("Light is as it was", () => {
    expect([LIGHT_CONTROLS.surface, LIGHT_CONTROLS.off, LIGHT_CONTROLS.window, LIGHT_CONTROLS.sidebar]).toEqual(["#f3eff8", "#e4ddee", "#f7f4fa", "#efeaf5"]);
  });
});

test("GTK apps' window and view are the black ground, their headerbar the compositor's title bar", () => {
  const dark = gtkColors(true);
  expect(dark.window_bg_color).toBe(TRUE_BLACK.ground);
  expect(dark.view_bg_color).toBe(TRUE_BLACK.ground);
  expect(dark.headerbar_bg_color).toBe(TRUE_BLACK.raised);
  expect(dark.headerbar_backdrop_color).toBe(TRUE_BLACK.lift);
  expect(dark.window_fg_color).toBe(TRUE_BLACK.ink);
  expect(gtkColors(false).window_bg_color).toBe("#FAF9F6");
});

test("the compositor's Dark title bars are TRUE_BLACK's raised step when focused and its first lift when not", () => {
  const source = readFileSync(join(repo, "crates/dashi-comp/src/render/titlebar.rs"), "utf8");
  const bar = (active: boolean): string | undefined => {
    const arm = new RegExp(`\\(true, ${active}\\) => Palette \\{\\s*bar: Rgba::hex\\(0x([0-9a-f]{6})\\)`).exec(source);
    return arm?.[1] === undefined ? undefined : `#${arm[1]}`;
  };
  expect(bar(true)).toBe(TRUE_BLACK.raised);
  expect(bar(false)).toBe(TRUE_BLACK.lift);
});

test("Terminal's Dark ground is the black ground, under Dashi's ink", () => {
  expect(DARK_TERMINAL.ground).toBe(TRUE_BLACK.ground);
  expect(DARK_TERMINAL.ink).toBe(TRUE_BLACK.ink);
});

test("the login and lock screens darken the wallpaper toward black, and their words read on it over white", () => {
  expect(LOGIN_GROUND.slice(0, 7)).toBe(TRUE_BLACK.ground);
  // The darkest the field's ground can be is the scrim over a white wallpaper: #b8 of black over white.
  const scrimOverWhite = "#474747";
  expect(contrastRatio(LOGIN_INK, scrimOverWhite)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(LOGIN_MUTED, scrimOverWhite)).toBeGreaterThanOrEqual(3);
  expect(darkColors.text).toBe(LOGIN_INK);
});
