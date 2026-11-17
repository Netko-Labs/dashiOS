import { describe, expect, test } from "bun:test";
import { KOMBU_SEED } from "../src/theme/accent/index.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { paletteFor } from "../src/theme/palette-for.ts";

describe("the palette with an accent", () => {
  test("Kombu, or no accent, is today's constants byte for byte", () => {
    for (const dark of [false, true]) {
      const base = dark ? darkColors : lightColors;
      expect(paletteFor(dark)).toBe(base);
      expect(paletteFor(dark, null)).toBe(base);
      expect(paletteFor(dark, KOMBU_SEED)).toBe(base);
      expect(paletteFor(dark, KOMBU_SEED.toLowerCase())).toBe(base);
    }
    expect(lightColors.selection).toBe("#357A64");
    expect(lightColors.accentInk).toBe("#2F6E5A");
    expect(darkColors.accentInk).toBe("#7FD1B2");
    expect(darkColors.selectionWash).toBe("#3E8A7238");
  });

  test("another seed changes only the keys the accent owns", () => {
    const owned = new Set(["selection", "selectionHover", "selectionPressed", "selectionWash", "textSelection", "selectionBar", "accentInk", "onAccent"]);
    for (const dark of [false, true]) {
      const base = dark ? darkColors : lightColors;
      const momo = paletteFor(dark, "#DA4482");
      for (const key of Object.keys(base) as (keyof typeof base)[]) if (!owned.has(key)) expect([key, momo[key]]).toEqual([key, base[key]]);
      expect(momo.selection).toBe("#DA4482");
      expect(momo.onAccent).toBe("#111113");
      expect(momo.primary).toBe(base.primary);
      expect(momo.focusRing).toBe(base.focusRing);
      expect(paletteFor(dark, "#DA4482")).toBe(momo);
    }
  });
});
