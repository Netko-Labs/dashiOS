/** The kit's glyphs, on a 16-unit grid and tinted by the Svg `color` (as the shell's own). */

export { INFO, SEARCH } from "../../src/settings-app/glyphs.ts";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.5): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A circle with an x: a field's clear button (outlines only: the Svg tints every fill one color). */
export const CLEAR = svg(`<circle cx="8" cy="8" r="6.2" stroke="#000" stroke-width="1.3" fill="none"/>${stroke("M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2", 1.4)}`);
export const CHEVRON_UP = svg(stroke("M4.5 10l3.5-3.5 3.5 3.5", 1.6));
export const CHEVRON_DOWN = svg(stroke("M4.5 6.5l3.5 3.5 3.5-3.5", 1.6));
/** An octagon with an x: stop (quit) a process. */
export const STOP = svg(`${stroke("M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z", 1.4)}${stroke("M6 6l4 4M10 6l-4 4", 1.5)}`);
export const WARNING = svg(`${stroke("M8 2.2l6.2 11H1.8z", 1.4)}${stroke("M8 6.4v3.2", 1.6)}<circle cx="8" cy="11.5" r=".9" fill="#000"/>`);
export const LOCK = svg(`${stroke("M4.6 7.2V5.4a3.4 3.4 0 0 1 6.8 0v1.8", 1.4)}<rect x="3.4" y="7.2" width="9.2" height="6.8" rx="1.6" fill="#000"/>`);
