/**
 * The clipboard's glyphs, in the style of Dashi's command glyphs
 * (launcher/lib/command-glyphs.ts: 16 × 16, 1.4 strokes, round ends), drawn in
 * ink on a neutral tile: a clipboard (copied text, the history's chip), a
 * page of files, and a snippet's brackets.
 */

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A clipboard: its board and its clip. */
export const CLIPBOARD = svg(
  stroke("M5.4 3H4.2a1.2 1.2 0 0 0-1.2 1.2v8.6A1.2 1.2 0 0 0 4.2 14h7.6a1.2 1.2 0 0 0 1.2-1.2V4.2A1.2 1.2 0 0 0 11.8 3h-1.2") +
    stroke("M6 2h4v2.2H6z") +
    stroke("M5.6 7.6h4.8M5.6 10.2h3.2"),
);

/** Files: a page with its corner turned. */
export const FILES = svg(stroke("M4 2h5.2L12 4.8V14H4z") + stroke("M9 2v3h3"));

/** A snippet: a text cursor between brackets. */
export const SNIPPET = svg(stroke("M4.4 3.4L2 8l2.4 4.6M11.6 3.4L14 8l-2.4 4.6") + stroke("M8 4.6v6.8"));
