import { expect, test } from "bun:test";
import { darkColors, lightColors, TINT_VALUES, TINTS, tintFor } from "@dashi/ui";
import { PANES } from "../src/shared/settings/panes.ts";

// The job colors: kombu (selected), ume (destroy), broth (warning), moss (success), shiso (agents), and the shell's red.
const JOBS = ["#3E8A72", "#D0596F", "#E5B13F", "#4F9A3E", lightColors.agent, darkColors.agent, lightColors.critical, darkColors.critical].map((hex) =>
  hex.toLowerCase(),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const onWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05);

test("Dashi's tints leave out every job color, and white reads on each", () => {
  for (const value of Object.values(TINTS)) {
    expect(JOBS).not.toContain(value.toLowerCase());
    expect(onWhite(value)).toBeGreaterThanOrEqual(3.5);
  }
  expect(new Set(TINT_VALUES).size).toBe(Object.keys(TINTS).length);
});

test("a letter tile's tint is the same for the same name", () => {
  expect(tintFor("VLC")).toBe(tintFor("VLC"));
  expect(TINT_VALUES).toContain(tintFor("Applet"));
  expect(TINT_VALUES).toContain(tintFor(""));
});

test("Settings' glyphs: Passwords isn't Lock Screen's padlock, and every pane has its own", () => {
  const glyph = (id: string) => PANES.find((pane) => pane.id === id)?.glyph;
  expect(glyph("passwords")).not.toBe(glyph("lock-screen"));
  expect(new Set(PANES.map((pane) => pane.glyph)).size).toBe(PANES.length);
});
