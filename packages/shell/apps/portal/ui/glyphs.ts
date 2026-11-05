/** The portal's own glyphs, 16 × 16 strokes, tinted where they are drawn. */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" fill="none" stroke="#000" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const FOLDER = svg(stroke("M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.4 1.6h5.4c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"));
export const FILE = svg(stroke("M4 1.8h5.2L12.4 5v8.2c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1zM9 1.8V5h3.4"));
export const CLOCK = svg(`<circle cx="8" cy="8" r="6.2" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M8 4.6V8l2.4 1.6")}`);
export const HOME = svg(stroke("M2.4 7.4L8 2.6l5.6 4.8M4 6.2v7.2h3V10h2v3.4h3V6.2"));
export const CAMERA = svg(
  stroke("M2 5.2c0-.6.4-1 1-1h2l1.2-1.6h3.6L11 4.2h2c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z") +
    `<circle cx="8" cy="8.4" r="2.4" fill="none" stroke="#000" stroke-width="1.4"/>`,
);
export const PRINTER = svg(stroke("M4.4 6V2h7.2v4M4.4 11.4H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v3.4c0 .6-.4 1-1 1h-1.4M4.4 9.4h7.2V14H4.4z"));
export const PERSON = svg(
  `<circle cx="8" cy="5.4" r="2.8" fill="none" stroke="#000" stroke-width="1.4"/>${stroke("M2.6 14c.6-2.8 2.8-4.4 5.4-4.4s4.8 1.6 5.4 4.4")}`,
);
