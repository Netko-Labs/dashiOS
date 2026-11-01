/** Calendar's glyphs, on the kit's 16-unit grid and tinted by the Svg `color`. */

export { CHECK } from "../../src/glyphs.ts";
export { CHEVRON_LEFT, CHEVRON_RIGHT } from "../../src/control-center/glyphs.ts";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** New Event. */
export const PLUS = svg(stroke("M8 3v10M3 8h10", 1.7));
/** A tray with an arrow into it: Import. */
export const IMPORT = svg(`${stroke("M8 2.6v7.2M5.2 7.2L8 10l2.8-2.8")}${stroke("M2.6 10.4v1.8a1.2 1.2 0 0 0 1.2 1.2h8.4a1.2 1.2 0 0 0 1.2-1.2v-1.8")}`);
/** The page-and-rings calendar mark, for an empty state. */
export const CALENDAR = svg(`${stroke("M3.2 3.4h9.6a1.2 1.2 0 0 1 1.2 1.2v7.8a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.4V4.6a1.2 1.2 0 0 1 1.2-1.2z", 1.3)}${stroke("M2 6.8h12M5.4 2v2.6M10.6 2v2.6", 1.3)}`);
export const TRASH = svg(`${stroke("M2.6 4.2h10.8M6.2 4.2V2.8h3.6v1.4")}${stroke("M4 4.2l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4")}${stroke("M6.7 6.8v4M9.3 6.8v4", 1.2)}`);
export const LOCATION = svg(`${stroke("M8 14s4.4-4 4.4-7.2A4.4 4.4 0 0 0 3.6 6.8C3.6 10 8 14 8 14z", 1.3)}<circle cx="8" cy="6.8" r="1.5" fill="#000"/>`);
export const BELL = svg(`${stroke("M4 11.2V7.4a4 4 0 0 1 8 0v3.8l1 1H3z", 1.3)}${stroke("M6.6 13.6a1.5 1.5 0 0 0 2.8 0", 1.3)}`);
export const REPEAT = svg(`${stroke("M3 7.4V6.6A2 2 0 0 1 5 4.6h7.4M10.4 2.6l2 2-2 2")}${stroke("M13 8.6v.8a2 2 0 0 1-2 2H3.6M5.6 13.4l-2-2 2-2")}`);
export const CLOSE = svg(stroke("M4 4l8 8M12 4l-8 8", 1.6));
/** Three dots: a row's menu. */
export const ELLIPSIS = svg(`<circle cx="3.6" cy="8" r="1.25" fill="#000"/><circle cx="8" cy="8" r="1.25" fill="#000"/><circle cx="12.4" cy="8" r="1.25" fill="#000"/>`);
