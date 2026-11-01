/** The sidebar's glyphs, drawn on a 16-unit grid and tinted by the Svg `color`. */

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

export const DISPLAY = svg(`${stroke("M2.4 3h11.2a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H2.4a.8.8 0 0 1-.8-.8V3.8a.8.8 0 0 1 .8-.8z")}${stroke("M6 13.4h4M8 11v2.4")}`);

export const KEYBOARD = svg(
  `${stroke("M2.2 4h11.6a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H2.2a.8.8 0 0 1-.8-.8V4.8a.8.8 0 0 1 .8-.8z", 1.3)}` +
    `<g fill="#000"><rect x="3.4" y="5.9" width="1.5" height="1.3" rx=".3"/><rect x="6" y="5.9" width="1.5" height="1.3" rx=".3"/><rect x="8.6" y="5.9" width="1.5" height="1.3" rx=".3"/><rect x="11.2" y="5.9" width="1.5" height="1.3" rx=".3"/><rect x="4.6" y="9.1" width="6.8" height="1.3" rx=".3"/></g>`,
);

export const TRACKPAD = svg(`${stroke("M3 2.4h10a1.4 1.4 0 0 1 1.4 1.4v8.4A1.4 1.4 0 0 1 13 13.6H3a1.4 1.4 0 0 1-1.4-1.4V3.8A1.4 1.4 0 0 1 3 2.4z", 1.3)}${stroke("M1.8 10h12.4", 1.2)}`);

export const MOUSE = svg(`${stroke("M8 1.8c2.6 0 4 1.6 4 3.8v4.8c0 2.2-1.6 3.8-4 3.8s-4-1.6-4-3.8V5.6c0-2.2 1.4-3.8 4-3.8z", 1.3)}${stroke("M8 1.9v4.4M4.1 6.4h7.8", 1.2)}`);

export const BELL = svg(`${stroke("M3.6 11.2c.9-.9 1.2-1.9 1.2-3.2V6.6a3.2 3.2 0 0 1 6.4 0V8c0 1.3.3 2.3 1.2 3.2z", 1.4)}${stroke("M6.6 13.4a1.6 1.6 0 0 0 2.8 0", 1.3)}`);

/** Agents: a four-point sparkle and a small one. */
export const SPARKLE = svg(
  `<path d="M7 1.8l1.3 3.9 3.9 1.3-3.9 1.3L7 12.2 5.7 8.3 1.8 7l3.9-1.3z" fill="#000"/><path d="M12.4 9.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="#000"/>`,
);

/** Desktop & Dock: a screen with the Dock along its bottom. */
export const DOCK_GLYPH = svg(
  `${stroke("M2.4 2.6h11.2a.8.8 0 0 1 .8.8v9.2a.8.8 0 0 1-.8.8H2.4a.8.8 0 0 1-.8-.8V3.4a.8.8 0 0 1 .8-.8z", 1.3)}` +
    `<g fill="#000"><rect x="4.4" y="9.9" width="1.9" height="1.9" rx=".5"/><rect x="7.05" y="9.9" width="1.9" height="1.9" rx=".5"/><rect x="9.7" y="9.9" width="1.9" height="1.9" rx=".5"/></g>`,
);

/** Wallpaper: a framed picture with a sun and hills. */
export const PICTURE = svg(
  `${stroke("M2.4 2.8h11.2a.8.8 0 0 1 .8.8v8.8a.8.8 0 0 1-.8.8H2.4a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8z", 1.3)}` +
    `<circle cx="10.6" cy="6" r="1.3" fill="#000"/>${stroke("M1.8 12l3.6-3.8 2.8 2.8 2.2-1.8 3.8 3.6", 1.3)}`,
);

/** Date & Time: a clock face. */
export const CLOCK = svg(`<circle cx="8" cy="8" r="6.2" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M8 4.4V8l2.4 1.6", 1.4)}`);

/** Language & Region: a globe. */
export const GLOBE = svg(
  `<circle cx="8" cy="8" r="6.2" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M1.9 8h12.2", 1.2)}${stroke("M8 1.8c-2 1.8-2.9 3.9-2.9 6.2S6 12.4 8 14.2c2-1.8 2.9-3.9 2.9-6.2S10 3.6 8 1.8z", 1.2)}`,
);
