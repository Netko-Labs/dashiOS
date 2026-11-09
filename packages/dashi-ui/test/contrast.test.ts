import { describe, expect, test } from "bun:test";
import { contrastRatio, parseHex } from "../src/theme/contrast.ts";
import { darkColors, lightColors, type Palette, TRUE_BLACK } from "../src/theme/palette.ts";
import { DARK_SURFACE, LIGHT_SURFACE, type Surface } from "../src/theme/surface.ts";

test("parseHex reads short, long, and translucent colors", () => {
  expect(parseHex("#fff")).toEqual({ rgb: [255, 255, 255], alpha: 1 });
  expect(parseHex("#1d1d1f")).toEqual({ rgb: [29, 29, 31], alpha: 1 });
  expect(parseHex("#00000080")?.alpha).toBeCloseTo(128 / 255);
  expect(parseHex("red")).toBeNull();
  expect(parseHex("#12345")).toBeNull();
});

test("contrastRatio matches WCAG's known pairs", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  // Order doesn't matter for opaque colors.
  expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#767676"), 5);
  expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
  // A translucent ink is composited over its ground: fully clear is the ground itself.
  expect(contrastRatio("#00000000", "#ffffff")).toBeCloseTo(1, 5);
});

// CO-6 in docs/design.html: text 4.5:1 on its ground, control edges 3:1, both modes.
const modes: ReadonlyArray<[string, Palette, Surface]> = [
  ["light", lightColors, LIGHT_SURFACE],
  ["dark", darkColors, DARK_SURFACE],
];

for (const [mode, colors, surface] of modes) {
  describe(`${mode} mode`, () => {
    const grounds = { window: surface.window, sidebar: surface.sidebar, card: surface.card };
    for (const [ground, value] of Object.entries(grounds)) {
      test(`text, muted text, and the job inks are AA on the ${ground}`, () => {
        const inks = ["text", "textMuted", "ume", "critical", "broth", "moss", "accentInk"] as const;
        // The failures by name, so a miss says which token.
        expect(inks.filter((ink) => contrastRatio(colors[ink], value) < 4.5)).toEqual([]);
      });
      test(`a secondary button's edge is 3:1 on the ${ground}`, () => {
        expect(contrastRatio(colors.controlEdge, value)).toBeGreaterThanOrEqual(3);
      });
    }
    test("white text is AA on kombu and on a destructive button", () => {
      expect(contrastRatio("#ffffff", colors.selection)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", colors.umeFill)).toBeGreaterThanOrEqual(4.5);
    });
    test("errors are ume: critical and the battery's last percent are the same token", () => {
      expect(colors.critical).toBe(colors.ume);
      expect(colors.batteryLow).toBe(colors.ume);
    });
  });
}

// True black (docs/design.html, "Tokens"): Dark's ground is #000000, what sits
// on it lifts by near-black steps, and every ink and control edge still meets
// CO-6 on every surface token, the lifts and the glass included.
describe("true black", () => {
  const luminanceOf = (hex: string): number => contrastRatio(hex, "#000000");
  const surfaces = Object.entries(DARK_SURFACE) as [keyof Surface, string][];

  test("the ground is #000: the window, and media's canvas on it", () => {
    expect(TRUE_BLACK.ground).toBe("#000000");
    expect(DARK_SURFACE.window).toBe("#000000");
    expect(DARK_SURFACE.canvas).toBe("#000000");
  });

  test("every surface is the ground or one of its two lifts, and the lifts stay near black (no gray wash)", () => {
    const steps: string[] = [TRUE_BLACK.ground, TRUE_BLACK.lift, TRUE_BLACK.raised];
    expect(surfaces.filter(([, value]) => !steps.includes(value))).toEqual([]);
    expect(luminanceOf(TRUE_BLACK.lift)).toBeGreaterThan(1);
    expect(luminanceOf(TRUE_BLACK.raised)).toBeGreaterThan(luminanceOf(TRUE_BLACK.lift));
    expect(luminanceOf(TRUE_BLACK.raised)).toBeLessThan(1.2);
  });

  test("a field in a card is sunk below it (CO-8)", () => {
    expect(luminanceOf(DARK_SURFACE.field)).toBeLessThan(luminanceOf(DARK_SURFACE.card));
  });

  test("the ink is 92% white and muted ink 60% of it", () => {
    expect(darkColors.text).toBe(TRUE_BLACK.ink);
    const ink = parseHex(TRUE_BLACK.ink);
    expect(ink?.rgb.every((channel) => Math.abs(channel / 255 - 0.92) < 0.015)).toBe(true);
    expect(parseHex(darkColors.textMuted)?.alpha).toBeCloseTo(0.6, 2);
  });

  // Glass composited on black, as it sits over a black window or wallpaper.
  const onBlack = (glass: string): string => {
    const parsed = parseHex(glass);
    if (!parsed) throw new Error(`not a color: ${glass}`);
    const hex = (channel: number): string =>
      Math.round(channel * parsed.alpha)
        .toString(16)
        .padStart(2, "0");
    return `#${parsed.rgb.map(hex).join("")}`;
  };
  const grounds: Record<string, string> = {
    ...Object.fromEntries(surfaces),
    menu: onBlack(darkColors.menu),
    launcher: onBlack(darkColors.launcher),
    osd: onBlack(darkColors.osd),
    "menu bar": onBlack(darkColors.menuBar),
  };

  for (const [name, ground] of Object.entries(grounds)) {
    test(`text, muted text and the job inks are AA on the ${name}`, () => {
      const inks = ["text", "textMuted", "onSelection", "ume", "broth", "moss", "accentInk", "criticalInk", "agentInk"] as const;
      expect(inks.filter((ink) => contrastRatio(darkColors[ink], ground) < 4.5)).toEqual([]);
    });
    test(`control edges, the focus ring and the selection bar are 3:1 on the ${name}`, () => {
      const edges = ["controlEdge", "checkbox", "focusRing", "selectionBar", "agent"] as const;
      expect(edges.filter((edge) => contrastRatio(darkColors[edge], ground) < 3)).toEqual([]);
    });
  }

  test("glass over the wallpaper is black, not a smoky gray", () => {
    for (const glass of [darkColors.menuBar, darkColors.dock]) expect(parseHex(glass)?.rgb).toEqual([0, 0, 0]);
  });

  test("hairlines are 8 to 12% white", () => {
    for (const line of [darkColors.separator, darkColors.menuBarEdge, darkColors.dockBorder, TRUE_BLACK.hairline, TRUE_BLACK.edge]) {
      const parsed = parseHex(line);
      expect(parsed?.rgb).toEqual([255, 255, 255]);
      expect(parsed?.alpha).toBeGreaterThanOrEqual(0.08);
      expect(parsed?.alpha).toBeLessThanOrEqual(0.125);
    }
  });
});
