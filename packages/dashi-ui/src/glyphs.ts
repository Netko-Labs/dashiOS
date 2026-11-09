/** Dashi UI's glyphs, on a 16-unit grid and tinted by the Svg `color` (as the shell's own). */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.5): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A circle with an x: a field's clear button (outlines only: the Svg tints every fill one color). */
export const CLEAR = svg(`<circle cx="8" cy="8" r="6.2" stroke="#000" stroke-width="1.3" fill="none"/>${stroke("M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2", 1.4)}`);
/** An x: dismiss a notice. */
export const CLOSE = svg(stroke("M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6", 1.6));
export const CHEVRON_UP = svg(stroke("M4.5 10l3.5-3.5 3.5 3.5", 1.6));
export const CHEVRON_DOWN = svg(stroke("M4.5 6.5l3.5 3.5 3.5-3.5", 1.6));
/** Three dots: "More" where there is no room for the word (a toolbar's, the menu bar's, a row's). One glyph everywhere. */
export const MORE = svg(
  '<circle cx="3.5" cy="8" r="1.3" fill="#000"/><circle cx="8" cy="8" r="1.3" fill="#000"/><circle cx="12.5" cy="8" r="1.3" fill="#000"/>',
);
/** A chevron up over a chevron down: a pop-up button, whose menu opens over it. */
export const CHEVRON_UP_DOWN = svg(stroke("M5.2 6.2L8 3.4l2.8 2.8", 1.5) + stroke("M5.2 9.8L8 12.6l2.8-2.8", 1.5));
/** An octagon with an x: stop (quit) a process. */
export const STOP = svg(`${stroke("M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z", 1.4)}${stroke("M6 6l4 4M10 6l-4 4", 1.5)}`);
export const WARNING = svg(`${stroke("M8 2.2l6.2 11H1.8z", 1.4)}${stroke("M8 6.4v3.2", 1.6)}<circle cx="8" cy="11.5" r=".9" fill="#000"/>`);
export const LOCK = svg(`${stroke("M4.6 7.2V5.4a3.4 3.4 0 0 1 6.8 0v1.8", 1.4)}<rect x="3.4" y="7.2" width="9.2" height="6.8" rx="1.6" fill="#000"/>`);

export const INFO = svg(
  `<circle cx="8" cy="8" r="6" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M8 7.2v3.8", 1.5)}<circle cx="8" cy="5" r=".95" fill="#000"/>`,
);

export const SEARCH = svg(`<circle cx="7" cy="7" r="4.4" stroke="#000" stroke-width="1.5" fill="none"/>${stroke("M10.4 10.4l3.2 3.2", 1.6)}`);

/** A check mark: the chosen row in a menu, the connected network. */
export const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5L6.6 11.6L12.5 4.6" stroke="#000" stroke-opacity="1" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Power: Sleep (a crescent), Restart (an arrow coming round), Shut Down (the power symbol). */
export const SLEEP = svg(`<path d="M12.9 9.7A5.6 5.6 0 0 1 6.3 3.1a5.6 5.6 0 1 0 6.6 6.6z" fill="#000"/>`);
export const RESTART = svg(stroke("M12.6 8.6A4.7 4.7 0 1 1 11.2 4.7", 1.6) + stroke("M11.6 2.2v2.8H8.8", 1.6));
export const SHUT_DOWN = svg(stroke("M8 2.2v5.4", 1.6) + stroke("M4.9 4.4a4.8 4.8 0 1 0 6.2 0", 1.6));
