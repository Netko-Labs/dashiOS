import { describe, expect, test } from "bun:test";
import { rowLook, SELECTION_BAR, selectionBarHeight } from "../src/selection.tsx";
import { darkColors, lightColors, type Palette } from "../src/theme/palette.ts";
import { DARK_SURFACE, LIGHT_SURFACE, type Surface } from "../src/theme/surface.ts";

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
    expect(contrast(over(colors.selectionBar, glass), glass)).toBeGreaterThanOrEqual(3);
  });
});

test("white on the brand's kombu fill is what the wash replaced: it fails CO-6", () => {
  // Kept as a record of why the launcher stopped using it (betterments, finding 5).
  // `selection` has since been deepened to pass; the launcher keeps the wash.
  expect(contrast(over("#ffffff", rgba("#3E8A72")), rgba("#3E8A72"))).toBeLessThan(4.5);
});

test("the bar is the selection in light mode", () => {
  expect(lightColors.selectionBar).toBe(lightColors.selection);
});

// One selection look (CO-9): apps' lists, tables and sidebars select with the
// launcher's wash and bar, on their own grounds, and on menus' glass (Files'
// path suggestions, Force Quit).
const SURFACES: Record<string, Surface> = { light: LIGHT_SURFACE, dark: DARK_SURFACE };

describe.each(Object.entries(MODES))("a selected row in a window in %s mode", (mode, colors) => {
  const surface = SURFACES[mode] as Surface;
  const grounds = { window: surface.window, sidebar: surface.sidebar, card: surface.card, field: surface.field, stripe: surface.stripe };

  test.each(Object.entries(grounds))("ink on the wash reads at 4.5:1 or more on the %s", (_ground, value) => {
    const washed = over(colors.selectionWash, rgba(value));
    expect(contrast(over(colors.onSelection, washed), washed)).toBeGreaterThanOrEqual(4.5);
  });

  // As the launcher's: the bar is the row's left edge, so it is measured against the ground beside the row.
  test.each(Object.entries(grounds))("the bar stands out at 3:1 or more against the %s", (_ground, value) => {
    expect(contrast(over(colors.selectionBar, rgba(value)), rgba(value))).toBeGreaterThanOrEqual(3);
  });

  test.each(Object.entries(WALLPAPERS))("on a menu's glass over a %s wallpaper, ink on the wash reads at 4.5:1 and the bar at 3:1", (_wall, wallpaper) => {
    const glass = over(colors.menu, wallpaper);
    const washed = over(colors.selectionWash, glass);
    expect(contrast(over(colors.onSelection, washed), washed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(over(colors.selectionBar, glass), glass)).toBeGreaterThanOrEqual(3);
  });
});

// Selected text in a field (CO-9) has no bar to mark it, so its wash alone must
// show: at least 1.3:1 from the ground the field sits on, under ink that still
// reads at 4.5:1. The rows' wash is fainter than that in Dark Mode.
describe.each(Object.entries(MODES))("selected text in a field in %s mode", (mode, colors) => {
  const surface = SURFACES[mode] as Surface;
  const sheet = (wallpaper: Rgb): Rgb => over(colors.tile, over(colors.menu, wallpaper));
  const grounds: Record<string, Rgb> = {
    window: rgba(surface.window),
    sidebar: rgba(surface.sidebar),
    card: rgba(surface.card),
    field: rgba(surface.field),
    "tile on a card": over(colors.tile, rgba(surface.card)),
    "sheet's field over a white wallpaper": sheet(WALLPAPERS.white as Rgb),
    "sheet's field over a black wallpaper": sheet(WALLPAPERS.black as Rgb),
  };

  test.each(Object.entries(grounds))("the wash stands out at 1.3:1 or more on the %s, under ink at 4.5:1", (_ground, ground) => {
    const washed = over(colors.textSelection, ground);
    expect(contrast(washed, ground)).toBeGreaterThanOrEqual(1.3);
    expect(contrast(over(colors.text, washed), washed)).toBeGreaterThanOrEqual(4.5);
  });

  test("it is at least as strong as a row's wash", () => {
    expect(rgba(colors.textSelection).a).toBeGreaterThanOrEqual(rgba(colors.selectionWash).a);
  });
});

test("Dark Mode's rows' wash is too faint for selected text on its own", () => {
  // The review that added `textSelection`: #3E8A7238 on Text Editor's card is 1.29:1.
  const card = rgba(DARK_SURFACE.card);
  expect(contrast(over(darkColors.selectionWash, card), card)).toBeLessThan(1.3);
});

describe("rowLook and the bar", () => {
  test("a selected row is the wash, with every word and glyph in ink; at rest, glyphs are muted", () => {
    expect(rowLook(lightColors, true)).toEqual({
      ground: lightColors.selectionWash,
      hover: lightColors.selectionWash,
      ink: lightColors.onSelection,
      quiet: lightColors.onSelection,
      glyph: lightColors.onSelection,
    });
    const rest = rowLook(darkColors, false);
    expect([rest.ink, rest.quiet, rest.glyph, rest.hover]).toEqual([darkColors.text, darkColors.textMuted, darkColors.textMuted, darkColors.button]);
  });

  test("no row is solid kombu under white any more", () => {
    for (const selected of [true, false]) {
      const look = rowLook(lightColors, selected);
      expect([look.ground, look.hover]).not.toContain(lightColors.selection);
      expect([look.ink, look.quiet, look.glyph]).not.toContain("#ffffff");
    }
  });

  test("the bar is 20 tall on the launcher's 40 px row, and keeps 6 above and below on shorter rows", () => {
    expect(selectionBarHeight(40)).toBe(SELECTION_BAR.height);
    expect(selectionBarHeight(32)).toBe(20);
    expect(selectionBarHeight(28)).toBe(16);
    expect(selectionBarHeight(24)).toBe(12);
    expect(selectionBarHeight(8)).toBe(0);
  });
});
