/** Control Center's tile glyphs (the Wi-Fi, speaker, and sun glyphs are glyphs.ts's). */

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

export const BLUETOOTH = svg(stroke("M4.4 5.2L11 10.8L8 13.6V2.4L11 5.2L4.4 10.8", 1.4));

/** Do Not Disturb: a crescent moon. */
export const MOON = svg(`<path d="M12.9 9.7A5.6 5.6 0 0 1 6.3 3.1a5.6 5.6 0 1 0 6.6 6.6z" fill="#000"/>`);

/** Dark Mode: a circle with its right half filled. */
export const CONTRAST = svg(`<circle cx="8" cy="8" r="5.6" stroke="#000" stroke-width="1.4" fill="none"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="#000"/>`);

export const LOCK = svg(`<rect x="3.4" y="7.2" width="9.2" height="6.6" rx="1.6" fill="#000"/>${stroke("M5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8", 1.5)}`);

/** Night Shift: a sun half set behind the horizon. */
export const SUNSET = svg(
  `${stroke("M2.4 11.6H13.6", 1.4)}<path d="M4.6 11.6a3.4 3.4 0 0 1 6.8 0z" fill="#000"/>${stroke("M8 3.2V4.8M3.2 6.4L4.3 7.5M12.8 6.4L11.7 7.5", 1.3)}`,
);

/** Opens a tile's detail page. */
export const CHEVRON_RIGHT = svg(stroke("M6 3.4L10.6 8L6 12.6", 1.6));

/** Back from a detail page. */
export const CHEVRON_LEFT = svg(stroke("M10 3.4L5.4 8L10 12.6", 1.6));
