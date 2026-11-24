/**
 * The six colours Dashi's capsule, questions and jobs may wear (docs/decisions.md D59). Fixed and
 * measured (test/persona-palette.test.ts keeps the design's contrast.md): white words on both ends
 * at least 4.5 to 1, the soft words at least 4.5, the amber disc at least 3 against the fill. No
 * free colour: ink is dictation's, amber needs you, green is on, red records. Copied from the
 * design's data by a script. settings.json `persona.colour` holds `to`, the `#rrggbb` the
 * capsule and the bar read (shared/pill/persona.ts).
 */

import { PERSONA_COLORS, type PersonaColor } from "@dashi/ui";

export type Colour = PersonaColor;

export const COLOUR_IDS = ["violet", "blue", "teal", "moss", "berry", "cocoa"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];

export const COLOURS: readonly Colour[] = PERSONA_COLORS;

/** Violet: Dashi's own, and what the capsule wears while nothing is chosen. */
export const VIOLET: Colour = COLOURS[0] as Colour;

export const colourById = (id: unknown): Colour | undefined => COLOURS.find((each) => each.id === id);

/** The colour a `#rrggbb` of settings.json names; undefined for any other colour, which is not worn. */
export const colourOfHex = (hex: unknown): Colour | undefined => (typeof hex === "string" ? COLOURS.find((each) => each.to === hex.toLowerCase()) : undefined);
