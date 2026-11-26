// The measure tokens (theme/measures.ts, TK-1) and the colour sets moved into the theme (CO-5):
// the scales are design.html's, text size scales type through one reader, and every set holds its
// contrast in both modes.
import { describe, expect, test } from "bun:test";
import {
  AMBER,
  CAPSULE,
  CAPTURE_AREA,
  contrastRatio,
  controlPalette,
  DARK_CONTROLS,
  darkColors,
  FILE_TINTS,
  INK_TILE,
  LIGHT_CONTROLS,
  LIGHT_SURFACE,
  lightColors,
  MOTION,
  ON_AGENT,
  ON_DANGER,
  ON_TINT,
  OPACITY,
  onOf,
  PERSONA_COLORS,
  RADIUS,
  SHADOW,
  SPACE,
  scaleType,
  TERMINAL,
  TINT_VALUES,
  TINTS,
  TYPE,
  typeAt,
} from "../src/index.ts";

describe("the scales are design.html's", () => {
  test("TY-1: the app row, the panel row and the named sizes, no others", () => {
    const { panel, inks, ...app } = TYPE;
    expect(Object.values(app).map((role) => role.size)).toEqual([11, 12, 13, 15, 17, 20, 28, 120]);
    expect(Object.values(panel).map((role) => role.size)).toEqual([10.5, 11.5, 12.5, 13.5, 18]);
    expect(Object.values(inks).map((role) => role.size)).toEqual([9.5, 10.5, 12.5]);
    for (const role of [...Object.values(app), ...Object.values(panel)]) if (role !== TYPE.clock) expect(role.line).toBeGreaterThan(role.size);
  });
  test("TK-1: spacing, radii, shadows, opacity and motion", () => {
    expect(Object.values(SPACE)).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24]);
    expect([RADIUS.thumb, RADIUS.check, RADIUS.row, RADIUS.control, RADIUS.card, RADIUS.sheet]).toEqual([2, 4, 5, 7, 10, 12]);
    expect([RADIUS.menu, RADIUS.panelCard, RADIUS.panel, RADIUS.capsuleCard, RADIUS.dock, RADIUS.icon]).toEqual([10, 24, 28, 17.5, 18, 10.5]);
    expect(Object.values(SHADOW).sort()).toEqual(["lg", "sm", "xl"]);
    expect(Object.values(OPACITY)).toEqual([0.4, 0.5, 0.6, 0.75, 0.85]);
    expect(MOTION.step).toBe(80);
    expect(MOTION.long).toBe(300);
  });
});

describe("text size scales every role through one reader", () => {
  test("1 is TYPE itself, and halves stay halves", () => {
    expect(typeAt(1)).toBe(TYPE);
    expect(scaleType(10.5, 1)).toBe(10.5);
    expect(scaleType(13, 1.15)).toBe(15);
    expect(typeAt(1.5).body).toEqual({ size: 19.5, line: 25.5 });
    expect(typeAt(1.3).panel.name.size).toBe(17.5);
    expect(typeAt(1.3)).toBe(typeAt(1.3));
  });
});

describe("one on per mode (R2)", () => {
  test("the panel look's on is the guard's selection under onAccent, in Light and Dark", () => {
    expect(onOf(lightColors)).toEqual({ on: LIGHT_CONTROLS.on, onInk: LIGHT_CONTROLS.onInk });
    expect(onOf(darkColors)).toEqual({ on: DARK_CONTROLS.on, onInk: DARK_CONTROLS.onInk });
    expect(contrastRatio(DARK_CONTROLS.onInk, DARK_CONTROLS.on)).toBeGreaterThanOrEqual(4.5);
    // Control Center's off tile in Dark: the on fill still reads as a fill (3:1).
    expect(contrastRatio(DARK_CONTROLS.on, "#141417")).toBeGreaterThanOrEqual(3);
  });
  test("a picked accent reaches the panel look as it reaches every kit", () => {
    const momo = controlPalette(false, "#D9739A");
    expect(momo.on).not.toBe(LIGHT_CONTROLS.on);
    expect(contrastRatio(momo.onInk, momo.on)).toBeGreaterThanOrEqual(4.5);
    expect(controlPalette(true, null)).toBe(DARK_CONTROLS);
  });
});

describe("the sets moved into the theme hold their contrast", () => {
  test("words on a fill: danger, a tint, an agent's shiso, amber", () => {
    expect(contrastRatio(ON_DANGER, lightColors.umeFill)).toBeGreaterThanOrEqual(4.5);
    for (const tint of TINT_VALUES) expect(contrastRatio(ON_TINT, tint)).toBeGreaterThanOrEqual(3.5);
    expect(contrastRatio(ON_AGENT, lightColors.agent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(AMBER.ink, AMBER.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CAPTURE_AREA.labelInk, CAPTURE_AREA.labelGround)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ON_TINT, INK_TILE)).toBeGreaterThanOrEqual(4.5);
  });
  test("Terminal's ANSI colours are AA on their ground, but the ground's own side", () => {
    const side = { light: [7, 15], dark: [0] } as const;
    for (const mode of ["light", "dark"] as const) {
      const set = TERMINAL[mode];
      expect(set.ansi).toHaveLength(16);
      set.ansi.forEach((colour, index) => {
        if (!(side[mode] as readonly number[]).includes(index)) expect(contrastRatio(colour, set.ground)).toBeGreaterThanOrEqual(4.5);
      });
      expect(contrastRatio(set.ink, set.ground)).toBeGreaterThanOrEqual(7);
      // R5: the cursor is the grid's ink, never the accent.
      expect(set.cursor).toBe(set.ink);
    }
    expect(TERMINAL.light.ground).toBe(LIGHT_SURFACE.window);
  });
  test("the persona's colours carry white words, and the capsule's own inks read", () => {
    for (const colour of PERSONA_COLORS) {
      expect(contrastRatio("#ffffff", colour.from)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", colour.to)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(CAPSULE.white, CAPSULE.dashiFill)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(CAPSULE.okOnPaper, CAPSULE.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CAPSULE.okOnInk, CAPSULE.ink)).toBeGreaterThanOrEqual(4.5);
  });
  test("a file's category wears a tint, never a colour of its own", () => {
    expect(Object.values(FILE_TINTS).every((tint) => (Object.values(TINTS) as string[]).includes(tint))).toBe(true);
  });
});
