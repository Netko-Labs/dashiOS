/** Preview's toolbar glyphs, on the kit's 16-unit grid (tinted by the Svg `color`). */

export { INFO } from "@dashi/ui";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.5): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

export const CHEVRON_LEFT = svg(stroke("M10 3 5 8l5 5", 1.7));
export const CHEVRON_RIGHT = svg(stroke("M6 3l5 5-5 5", 1.7));
export const ZOOM_OUT = svg(stroke("M3.5 8h9", 1.7));
export const ZOOM_IN = svg(stroke("M3.5 8h9M8 3.5v9", 1.7));
/** Four corners: fit to the window. */
export const FIT = svg(stroke("M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10", 1.5));
/** "1:1": one picture pixel to one screen pixel (not a frame, so it never reads as Zoom to Fit). */
export const ACTUAL = svg(
  `${stroke("M3 5.6 4.9 4.2v7.6M10.6 5.6l1.9-1.4v7.6", 1.4)}<circle cx="7.9" cy="6.6" r="0.95" fill="#000"/><circle cx="7.9" cy="10" r="0.95" fill="#000"/>`,
);
const turn = stroke("M3.2 8.2A4.9 4.9 0 1 0 5 4.4") + stroke("M3 2.2v3.4h3.4", 1.5);
export const ROTATE_LEFT = svg(turn);
export const ROTATE_RIGHT = svg(`<g transform="translate(16 0) scale(-1 1)">${turn}</g>`);
/** A page with a folded corner: an empty state. */
export const PICTURE = svg(
  `${stroke("M2.5 3.5h11v9h-11z", 1.2)}<circle cx="10.6" cy="6.4" r="1.2" fill="#000"/>${stroke("M2.8 12l3.6-3.8 2.4 2.4 1.6-1.6 2.8 3", 1.2)}`,
);
export const DOCUMENT = svg(stroke("M4 1.8h5.4L12.2 4.6V14.2H4z", 1.3) + stroke("M9.2 1.9v2.9h2.9M6 8h4M6 10.4h4", 1.2));
/** A bin: Move to Trash. */
export const TRASH = svg(stroke("M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4 4.2l.6 9h6.8l.6-9", 1.4) + stroke("M6.6 6.6v4.4M9.4 6.6v4.4", 1.3));
