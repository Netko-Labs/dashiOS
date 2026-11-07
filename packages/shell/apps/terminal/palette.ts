/**
 * The Terminal's colors: its ground and ink, and the 16 ANSI colors programs
 * name (`ls --color`, prompts, `git diff`), a light set and a dark set made
 * from Dashi's ingredients: red from ume, yellow from broth, green from moss,
 * cyan from kombu, magenta from shiso. dashi-term resolves programs' colors
 * through them (the `colors` message); a program can still set its own
 * (OSC 4, 10, 11), and the view draws whatever ground and ink the engine
 * reports. docs/design.html, "Terminal colors", lists them.
 *
 * Every color a program writes text in is AA (4.5:1) on its ground, except
 * the one that is the ground's own side (white, and bright white, in Light
 * Mode; black in Dark Mode). In Light Mode the bright colors are a step
 * darker, not lighter, so they stay readable.
 */

export interface TerminalPalette {
  ground: string;
  ink: string;
  /** The cursor: kombu, deep enough in Light Mode and light enough in Dark Mode that the ground's color on it (the letter under a block cursor) is AA. */
  cursor: string;
  /** Black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: readonly string[];
}

export const ANSI_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright black",
  "bright red",
  "bright green",
  "bright yellow",
  "bright blue",
  "bright magenta",
  "bright cyan",
  "bright white",
] as const;

export const LIGHT_TERMINAL: TerminalPalette = {
  ground: "#fbfaf7",
  ink: "#1d1d1f",
  cursor: "#357a64",
  ansi: [
    "#1d1d1f",
    "#b23a50",
    "#3d7a2e",
    "#866000",
    "#2c5faf",
    "#6a4fc4",
    "#22786a",
    "#d6d3cc",
    "#636260",
    "#a8304a",
    "#336b26",
    "#755400",
    "#244f96",
    "#5a40ae",
    "#1b665a",
    "#f3f1ec",
  ],
};

export const DARK_TERMINAL: TerminalPalette = {
  ground: "#1c1c1e",
  ink: "#e8e8ea",
  cursor: "#5fae95",
  ansi: [
    "#3a3a3d",
    "#f07a8f",
    "#7fc46a",
    "#e5b13f",
    "#6fa3ef",
    "#a897f0",
    "#5fbfa6",
    "#d8d8dc",
    "#8e8e93",
    "#ff97a8",
    "#9cd988",
    "#f5cd6a",
    "#93bbf6",
    "#c2b5f8",
    "#86d6c0",
    "#f5f5f7",
  ],
};

export function terminalPalette(dark: boolean): TerminalPalette {
  return dark ? DARK_TERMINAL : LIGHT_TERMINAL;
}

/** The ANSI colors that sit on the ground's own side, so text in them isn't held to AA. */
export function groundSide(dark: boolean): readonly number[] {
  return dark ? [0] : [7, 15];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio between two `#rrggbb` colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
