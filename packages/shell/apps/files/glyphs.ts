/** Files' own glyphs: 16-unit outlines, tinted by the Svg `color` (like the kit's). */

import type { GlyphName } from "./location.ts";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (cx: number, cy: number, r = 0.9): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000"/>`;

export const BACK = svg(stroke("M10 3.2L5.2 8L10 12.8", 1.7));
export const FORWARD = svg(stroke("M6 3.2L10.8 8L6 12.8", 1.7));
export const CHEVRON = svg(stroke("M6 4L10 8L6 12", 1.5));
export const CLOSE = svg(stroke("M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6", 1.6));
export const MORE = svg(`${dot(3.2, 8, 1.2)}${dot(8, 8, 1.2)}${dot(12.8, 8, 1.2)}`);
export const GRID = svg(
  `<g fill="none" stroke="#000" stroke-width="1.4" stroke-linejoin="round"><rect x="2.4" y="2.4" width="4.4" height="4.4" rx="1"/><rect x="9.2" y="2.4" width="4.4" height="4.4" rx="1"/><rect x="2.4" y="9.2" width="4.4" height="4.4" rx="1"/><rect x="9.2" y="9.2" width="4.4" height="4.4" rx="1"/></g>`,
);
export const LIST = svg(`${stroke("M5.6 4h8M5.6 8h8M5.6 12h8")}${dot(2.8, 4, 1)}${dot(2.8, 8, 1)}${dot(2.8, 12, 1)}`);
export const FOLDER_PLUS = svg(
  `${stroke("M1.8 5V3.9a1 1 0 0 1 1-1h3l1.4 1.6h5.6a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z", 1.3)}${stroke("M8 7v3.6M6.2 8.8h3.6", 1.3)}`,
);
export const LINK_BADGE = svg(stroke("M4 12L12 4M6.4 4H12v5.6", 1.8));
export const EJECT = svg(`${stroke("M8 3L13 9H3z", 1.4)}${stroke("M3.4 12.4h9.2", 1.6)}`);
export const COMPUTER = svg(
  `<rect x="2" y="3" width="12" height="7.6" rx="1.4" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M5.5 13h5M8 10.6V13", 1.4)}`,
);

const SIDEBAR: Record<GlyphName, string> = {
  recents: svg(`<circle cx="8" cy="8" r="5.8" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M8 4.6V8l2.4 1.6", 1.4)}`),
  home: svg(stroke("M2.2 8L8 2.8L13.8 8M3.8 7v6.2h3V9.6h2.4v3.6h3V7", 1.4)),
  desktop: COMPUTER,
  documents: svg(`${stroke("M4 1.8h5.2L12.4 5v8.2H4z", 1.3)}${stroke("M9 1.9V5.2h3.3M6 8h4.4M6 10.6h4.4", 1.2)}`),
  downloads: svg(`<circle cx="8" cy="8" r="5.8" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M8 4.8v5M5.7 8.2L8 10.5l2.3-2.3", 1.4)}`),
  pictures: svg(
    `<rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="#000" stroke-width="1.4"/>${dot(5.6, 6.2, 1.1)}${stroke("M2.6 11.6l3.6-3.4 2.6 2.4 2-1.8 2.6 2.4", 1.3)}`,
  ),
  music: svg(
    `${stroke("M6.2 11.6V3.6l6.4-1.4v8", 1.4)}<circle cx="4.6" cy="11.8" r="1.8" fill="none" stroke="#000" stroke-width="1.3"/><circle cx="11" cy="10.4" r="1.8" fill="none" stroke="#000" stroke-width="1.3"/>`,
  ),
  videos: svg(`<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M6.6 6l3.4 2-3.4 2z", 1.2)}`),
  drive: svg(
    `<rect x="1.8" y="6" width="12.4" height="5.6" rx="1.6" fill="none" stroke="#000" stroke-width="1.4"/>${dot(11.4, 8.8, 0.9)}${stroke("M3.4 6l1.2-2.8h6.8L12.6 6", 1.3)}`,
  ),
  usb: svg(`<rect x="1.8" y="5.4" width="9.6" height="5.2" rx="1.6" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M11.4 8h2.8M4.6 8h3", 1.3)}`),
  trash: svg(`${stroke("M2.8 4.4h10.4M6.2 4.4V2.8h3.6v1.6", 1.3)}${stroke("M4 4.4l.6 8.6h6.8l.6-8.6M6.6 6.8v4M9.4 6.8v4", 1.3)}`),
  network: svg(
    `<circle cx="8" cy="8" r="5.8" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M2.4 8h11.2M8 2.2c-2 2-2 9.6 0 11.6M8 2.2c2 2 2 9.6 0 11.6", 1.1)}`,
  ),
  folder: svg(stroke("M1.8 4.4a1 1 0 0 1 1-1h3l1.4 1.6h5a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z", 1.3)),
};

export function sidebarGlyph(name: GlyphName): string {
  return SIDEBAR[name];
}
