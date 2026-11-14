/**
 * What a persona looks like, as data every piece can draw (docs/night-0.9-contract.md, "persona";
 * docs/decisions.md D71): the eight glyphs for Dashi's disc and the six shapes of its five dots.
 * Copied from the design's data (dashi-0.9.0-design/persona/src/40-persona-data.js) by a script;
 * the spark is the one the shell already draws, so a Dashi nobody changed looks as it did. Ids
 * only travel in settings.json and in a character's file: no SVG is ever read from either.
 */

import { SPARK } from "../settings/index.ts";
import type { PersonaDots, PersonaGlyph, PersonaMark } from "./persona.ts";

const glyph = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">${body}</svg>`;

const GLYPHS: Readonly<Record<PersonaGlyph, string>> = {
  spark: SPARK,
  bowl: glyph(
    `<path d="M2.500 11.500h19c0 5.200-4.200 9-9.500 9s-9.500-3.800-9.500-9Z"/><rect x="7" y="3" width="2" height="5.500" rx="1"/><rect x="11" y="2" width="2" height="6.500" rx="1"/><rect x="15" y="3" width="2" height="5.500" rx="1"/>`,
  ),
  dot: glyph(`<circle cx="12" cy="12" r="7.500"/>`),
  moon: glyph(`<path d="M20.500 14.600A9 9 0 1 1 9.400 3.500a7.200 7.200 0 0 0 11.100 11.100Z"/>`),
  leaf: glyph(`<path d="M20.500 3.500c.300 10-5 16-13.300 16l-1.700 2.200-1.600-1.300 1.500-2C4.700 10.500 10.500 3.800 20.500 3.500Z"/>`),
  drop: glyph(`<path d="M12 2c3.800 4.500 7 8.300 7 12a7 7 0 0 1-14 0c0-3.700 3.200-7.500 7-12Z"/>`),
  flame: glyph(
    `<path d="M12.800 1.500c.600 3.600 5.700 6 5.700 11.900a6.500 6.500 0 0 1-13 .200c0-2.500 1.100-4.400 2.500-5.800.300 1.700 1.100 2.800 2.200 3.400-.300-3.500.600-7.300 2.600-9.700Z"/>`,
  ),
  paw: glyph(
    `<circle cx="5.600" cy="10.600" r="2.200"/><circle cx="9.700" cy="6.200" r="2.300"/><circle cx="14.300" cy="6.200" r="2.300"/><circle cx="18.400" cy="10.600" r="2.200"/><path d="M12 11.400c3.200 0 6 3.100 6 5.800 0 2-1.700 2.900-3.200 2.900-1.100 0-1.800-.600-2.800-.600s-1.700.600-2.800.600c-1.500 0-3.200-.900-3.200-2.900 0-2.700 2.800-5.800 6-5.800Z"/>`,
  ),
};

/** As the pane's buttons are called. */
export const GLYPH_NAMES: Readonly<Record<PersonaGlyph, string>> = {
  spark: "Spark",
  bowl: "Bowl",
  dot: "Dot",
  moon: "Moon",
  leaf: "Leaf",
  drop: "Drop",
  flame: "Flame",
  paw: "Paw",
};

/** The glyph a mark draws in the disc; the spark for `dots`, which has no disc where the capsule leads with its dots. */
export const markSvg = (mark: PersonaMark): string => (mark === "dots" ? GLYPHS.spark : GLYPHS[mark]);

/** Five dots at rest: how far each sits from the middle line (points, down is +) and how wide each is. */
export interface DotShape {
  id: PersonaDots;
  /** As the pane's button is called. */
  name: string;
  dy: readonly [number, number, number, number, number];
  size: readonly [number, number, number, number, number];
}

/** The design's four (its 6 px dot is 4 points), and two more so each of the six characters has a face of its own. */
export const DOT_SHAPES: readonly DotShape[] = [
  { id: "line", name: "In a line", dy: [0, 0, 0, 0, 0], size: [4, 4, 4, 4, 4] },
  { id: "smile", name: "A smile", dy: [-2, 0.5, 2, 0.5, -2], size: [4, 4, 4, 4, 4] },
  { id: "wave", name: "A wave", dy: [-2, 2, -2, 2, -2], size: [4, 4, 4, 4, 4] },
  { id: "pearls", name: "Pearls", dy: [0, 0, 0, 0, 0], size: [2.5, 4, 6, 4, 2.5] },
  { id: "steps", name: "Steps", dy: [2, 1, 0, -1, -2], size: [4, 4, 4, 4, 4] },
  { id: "hop", name: "A hop", dy: [1, 1, -3, 1, 1], size: [4, 4, 5, 4, 4] },
];

export const dotShape = (id: PersonaDots): DotShape => DOT_SHAPES.find((shape) => shape.id === id) ?? (DOT_SHAPES[0] as DotShape);
