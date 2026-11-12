/** Text Editor's toolbar glyphs, on the kit's 16-unit grid and tinted by the Svg `color`. */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A page with a folded corner and a plus: New. */
export const NEW = svg(
  `${stroke("M9 1.8H4.2a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.8z", 1.3)}${stroke("M9 1.8v4h4", 1.2)}${stroke("M8 8.2v4M6 10.2h4", 1.3)}`,
);

/** An open folder: Open. */
export const OPEN = svg(
  `${stroke("M1.8 12.4V3.8a1 1 0 0 1 1-1h3.4L7.6 4.4h4.6a1 1 0 0 1 1 1V6.6", 1.3)}${stroke("M1.8 12.4l1.9-5a1 1 0 0 1 .9-.7h9.5a.6.6 0 0 1 .6.8l-1.8 4.9a1 1 0 0 1-.9.6H1.8z", 1.3)}`,
);

/** A page with a folded corner and a check: Save (a tray with an arrow into it is Download's). */
export const SAVE = svg(
  `${stroke("M9 1.8H4.2a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.8z", 1.3)}${stroke("M9 1.8v4h4", 1.2)}${stroke("M5.7 10.1l1.6 1.6 3-3.3", 1.4)}`,
);
