/** Software's glyphs, on a 16-unit grid and tinted by the Svg `color` (outlines only: the Svg tints every fill one color). */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

export const BACK = svg(stroke("M10 3.2L5.2 8l4.8 4.8", 1.7));
/** Discover: a four-point star. */
export const DISCOVER = svg(stroke("M8 1.8l1.6 4.6 4.6 1.6-4.6 1.6L8 14.2 6.4 9.6 1.8 8l4.6-1.6z", 1.3));
/** Installed: a tray with a check. */
export const INSTALLED = svg(`${stroke("M2.4 9.4V12a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V9.4", 1.4)}${stroke("M5.4 5.6L7.4 7.6 11 3.6", 1.6)}`);
/** Updates: an arrow down into a line. */
export const UPDATES = svg(`${stroke("M8 2.4v7.4M4.9 6.9L8 10l3.1-3.1", 1.6)}${stroke("M3 13.2h10", 1.5)}`);
/** The seal of a verified developer: a check in a circle (its fill is the badge color, set by the caller). */
export const VERIFIED = svg(`<circle cx="8" cy="8" r="7" fill="#000"/>`);
export const VERIFIED_CHECK = svg(stroke("M4.8 8.3l2.2 2.2 4.2-4.6", 1.9));
export const RESTART = svg(`${stroke("M13 8a5 5 0 1 1-1.6-3.7", 1.5)}${stroke("M12.2 1.8v2.8H9.4", 1.5)}`);
export const OFFLINE = svg(`${stroke("M2 6.2a8.4 8.4 0 0 1 12 0M4.3 8.6a5.2 5.2 0 0 1 7.4 0M6.6 11a2 2 0 0 1 2.8 0", 1.4)}${stroke("M3 13.4l10-10.8", 1.5)}`);
export const REFRESH = svg(`${stroke("M13.4 8A5.4 5.4 0 1 1 11.8 4.2", 1.5)}${stroke("M13.6 2.2v3.4H10.2", 1.5)}`);

/** Category glyphs: white on the colored tile. */
export const CATEGORY_GLYPHS: Readonly<Record<string, string>> = {
  AudioVideo: svg(`<path d="M5.4 3.4l7.2 4.6-7.2 4.6z" fill="#000"/>`),
  Development: svg(stroke("M5.6 4.4L2 8l3.6 3.6M10.4 4.4L14 8l-3.6 3.6M9 3l-2 10", 1.5)),
  Education: svg(`${stroke("M1.8 6L8 3l6.2 3L8 9z", 1.4)}${stroke("M4.4 7.6v3c0 .9 1.6 1.8 3.6 1.8s3.6-.9 3.6-1.8v-3", 1.4)}`),
  Game: svg(
    `${stroke("M4.4 5h7.2a3 3 0 0 1 3 3.2l-.3 2.4a1.9 1.9 0 0 1-3.2 1.1L9.6 10.6H6.4l-1.5 1.1a1.9 1.9 0 0 1-3.2-1.1l-.3-2.4A3 3 0 0 1 4.4 5z", 1.3)}${stroke("M5 6.8v2.4M3.8 8h2.4", 1.3)}`,
  ),
  Graphics: svg(
    `${stroke("M2.4 2.8h11.2a.8.8 0 0 1 .8.8v8.8a.8.8 0 0 1-.8.8H2.4a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8z", 1.3)}<circle cx="10.6" cy="6" r="1.2" fill="#000"/>${stroke("M1.8 12l3.6-3.8 2.8 2.8 2.2-1.8 3.8 3.6", 1.3)}`,
  ),
  Network: svg(
    `<circle cx="8" cy="8" r="6.2" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M1.9 8h12.2", 1.2)}${stroke("M8 1.8c-2 1.8-2.9 3.9-2.9 6.2S6 12.4 8 14.2c2-1.8 2.9-3.9 2.9-6.2S10 3.6 8 1.8z", 1.2)}`,
  ),
  Office: svg(`${stroke("M4 1.8h5.2L12.4 5v9.2H4z", 1.4)}${stroke("M9 1.9V5h3.2M6 8h4M6 10.6h4", 1.3)}`),
  Science: svg(`${stroke("M6.2 2h3.6M6.9 2v4.4L3 13a.9.9 0 0 0 .8 1.4h8.4A.9.9 0 0 0 13 13L9.1 6.4V2", 1.4)}${stroke("M4.8 10.4h6.4", 1.3)}`),
  System: svg(
    `${stroke("M4.6 4.6h6.8v6.8H4.6z", 1.4)}${stroke("M6.6 2v2.6M9.4 2v2.6M6.6 11.4V14M9.4 11.4V14M2 6.6h2.6M2 9.4h2.6M11.4 6.6H14M11.4 9.4H14", 1.3)}`,
  ),
  Utility: svg(
    `${stroke("M2.6 4.8h10.8M2.6 8h10.8M2.6 11.2h10.8", 1.4)}<g fill="#000"><circle cx="10.4" cy="4.8" r="1.5"/><circle cx="5.6" cy="8" r="1.5"/><circle cx="9.2" cy="11.2" r="1.5"/></g>`,
  ),
};

/** A tile color for each category. */
export const CATEGORY_TINTS: Readonly<Record<string, string>> = {
  AudioVideo: "#d4483b",
  Development: "#5b6ad0",
  Education: "#c7892b",
  Game: "#6E56CF",
  Graphics: "#d0527f",
  Network: "#3b8fd0",
  Office: "#d97a2c",
  Science: "#2f9d8f",
  System: "#7a7a82",
  Utility: "#4f8f4f",
};
