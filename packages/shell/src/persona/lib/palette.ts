/**
 * The six colours Dashi's capsule, questions and jobs may wear (docs/decisions.md D71). Fixed and
 * measured (test/persona-palette.test.ts keeps the design's contrast.md): white words on both ends
 * at least 4.5 to 1, the soft words at least 4.5, the amber disc at least 3 against the fill. No
 * free colour: ink is dictation's, amber needs you, green is on, red records. Copied from the
 * design's data by a script. settings.json `persona.colour` holds `to`, the `#rrggbb` the
 * capsule and the bar read (shared/pill/persona.ts).
 */

export interface Colour {
  id: ColourId;
  /** As the pane's swatch is called. */
  name: string;
  /** The fill, from one end to the other. */
  from: string;
  to: string;
  /** Words on white buttons, and the mark in the white disc. */
  deep: string;
  /** Quiet words on the fill. */
  soft: string;
  glow: string;
}

export const COLOUR_IDS = ["violet", "blue", "teal", "moss", "berry", "cocoa"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];

export const COLOURS: readonly Colour[] = [
  { id: "violet", name: "Violet", from: "#3f2a9e", to: "#5b41c4", deep: "#2f2080", soft: "#d9d2fb", glow: "#a58bff80" },
  { id: "blue", name: "Blue", from: "#17479e", to: "#2558b8", deep: "#123a82", soft: "#d3e2fb", glow: "#7fb0ff80" },
  { id: "teal", name: "Teal", from: "#0c5560", to: "#136770", deep: "#0a4750", soft: "#cdeef0", glow: "#6fd3dc80" },
  { id: "moss", name: "Moss", from: "#3f5220", to: "#4d6326", deep: "#34451a", soft: "#e1edc8", glow: "#b5d67a80" },
  { id: "berry", name: "Berry", from: "#8a1f4f", to: "#9f2a5f", deep: "#701840", soft: "#fbd5e4", glow: "#ff8fbc80" },
  { id: "cocoa", name: "Cocoa", from: "#4e3629", to: "#6f4d3c", deep: "#432e23", soft: "#f1dfd3", glow: "#e0b29880" },
];

/** Violet: Dashi's own, and what the capsule wears while nothing is chosen. */
export const VIOLET: Colour = COLOURS[0] as Colour;

export const colourById = (id: unknown): Colour | undefined => COLOURS.find((each) => each.id === id);

/** The colour a `#rrggbb` of settings.json names; undefined for any other colour, which is not worn. */
export const colourOfHex = (hex: unknown): Colour | undefined => (typeof hex === "string" ? COLOURS.find((each) => each.to === hex.toLowerCase()) : undefined);
