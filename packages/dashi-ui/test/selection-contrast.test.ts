import { describe, expect, test } from "bun:test";
import { darkColors, lightColors, type Palette } from "../src/theme/palette.ts";

// CO-6 (docs/design.html): text at 4.5:1 or more against its ground, edges at
// 3:1. The launcher's selection is ink on a kombu wash over its glass, and the
// glass is see-through, so the ground is checked over the darkest and the
// lightest wallpaper there can be.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgba(hex: string): Rgb & { a: number } {
  const digits = hex.replace("#", "");
  const channel = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) : 1 };
}

/** `top` painted over `under`, as the renderer blends. */
function over(top: string, under: Rgb): Rgb {
  const { r, g, b, a } = rgba(top);
  return { r: r * a + under.r * (1 - a), g: g * a + under.g * (1 - a), b: b * a + under.b * (1 - a) };
}

function luminance({ r, g, b }: Rgb): number {
  const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const WALLPAPERS: Record<string, Rgb> = { white: { r: 1, g: 1, b: 1 }, black: { r: 0, g: 0, b: 0 } };
const MODES: Record<string, Palette> = { light: lightColors, dark: darkColors };

describe.each(Object.entries(MODES))("the launcher's selection in %s mode", (_mode, colors) => {
  test.each(Object.entries(WALLPAPERS))("ink on the wash reads at 4.5:1 or more over a %s wallpaper", (_wall, wallpaper) => {
    const glass = over(colors.launcher, wallpaper);
    const ground = over(colors.selectionWash, glass);
    expect(contrast(over(colors.onSelection, ground), ground)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(Object.entries(WALLPAPERS))("a destructive row's red reads at 4.5:1 or more, selected or not, over a %s wallpaper", (_wall, wallpaper) => {
    const glass = over(colors.launcher, wallpaper);
    const washed = over(colors.selectionWash, glass);
    expect(contrast(over(colors.criticalInk, glass), glass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(over(colors.criticalInk, washed), washed)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(Object.entries(WALLPAPERS))("the 3 px kombu bar stands out at 3:1 or more over a %s wallpaper", (_wall, wallpaper) => {
    const glass = over(colors.launcher, wallpaper);
    expect(contrast(over(colors.selection, glass), glass)).toBeGreaterThanOrEqual(3);
  });
});

test("white on the full kombu fill is what the wash replaces: it fails CO-6", () => {
  // Kept as a record of why the launcher stopped using it (betterments, finding 5).
  expect(contrast(over("#ffffff", rgba(lightColors.selection)), rgba(lightColors.selection))).toBeLessThan(4.5);
});
