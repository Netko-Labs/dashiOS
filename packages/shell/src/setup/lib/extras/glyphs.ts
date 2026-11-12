/** The Extras and Installing pages' heading glyphs, on the settings glyphs' 16-unit grid. */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A box with its lid: software to add. */
export const PACKAGE = svg(`${stroke("M8 1.8l5.6 2.8v6.8L8 14.2l-5.6-2.8V4.6z")}${stroke("M2.4 4.6L8 7.4l5.6-2.8M8 7.4v6.8")}`);

/** An arrow into a tray: downloading and installing. */
export const DOWNLOAD = svg(`${stroke("M8 2v8M4.8 7L8 10.2 11.2 7", 1.5)}${stroke("M2.6 11v1.6a.8.8 0 0 0 .8.8h9.2a.8.8 0 0 0 .8-.8V11", 1.4)}`);
