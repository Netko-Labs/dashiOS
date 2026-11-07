import { describe, expect, test } from "bun:test";
import { contrastRatio, parseHex } from "../src/theme/contrast.ts";
import { darkColors, lightColors, type Palette } from "../src/theme/palette.ts";
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
