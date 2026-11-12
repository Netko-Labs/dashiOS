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

/** The battery row's glyph: an outline with a fill; the bolt alone while charging (bolt only, never both). */
export const BATTERY = svg(
  `<rect x="1.4" y="4.6" width="11.4" height="6.8" rx="1.8" stroke="#000" stroke-width="1.3" fill="none"/><path d="M14.4 7v2" stroke="#000" stroke-width="1.3" stroke-linecap="round"/><rect x="3.1" y="6.3" width="6.6" height="3.4" rx="0.8" fill="#000"/>`,
);

/** Charging: a bolt. */
export const BOLT = svg(`<path d="M8.9 1.6L2.9 9.4h4.6l-.7 5 6-7.8H8.2z" fill="#000"/>`);

/** A real lock: a shackle over a body (Lock Screen). */
export const PADLOCK = svg(
  `<rect x="3.2" y="7.2" width="9.6" height="6.8" rx="1.6" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M5.4 7.2V5.2a2.6 2.6 0 0 1 5.2 0v2", 1.4)}`,
);

/** Mirroring: two screens, the same picture on each. */
export const MIRROR = svg(
  `<rect x="1.4" y="3" width="7" height="5.2" rx="1" stroke="#000" stroke-width="1.3" fill="none"/><rect x="7.6" y="7.8" width="7" height="5.2" rx="1" stroke="#000" stroke-width="1.3" fill="none"/>${stroke("M3.4 6.6l1.5-1.1 1.5 1.1M9.6 11.4l1.5-1.1 1.5 1.1", 1.1)}`,
);

/** A lit lid: the open lid with a bar of light across it (an applet's lid light). */
export const LID_LIGHT = svg(`${stroke("M2.4 13.2h11.2M3.8 13.2l1.4-9.4h5.6l1.4 9.4")}${stroke("M6 9.6l4-1.6", 1.9)}`);

/** Personal Hotspot: a dot with waves on either side. */
export const HOTSPOT = svg(
  `<circle cx="8" cy="8.4" r="1.5" fill="#000"/>${stroke("M5.3 11a3.8 3.8 0 0 1 0-5.2M10.7 5.8a3.8 3.8 0 0 1 0 5.2M3.1 13.1a6.8 6.8 0 0 1 0-9.4M12.9 3.7a6.8 6.8 0 0 1 0 9.4", 1.3)}`,
);

/** Edit mode's marks: take a tile away, put one in. */
export const MINUS = svg(stroke("M4 8h8", 1.8));
export const PLUS = svg(stroke("M8 4v8M4 8h8", 1.8));

/** An applet's control without an icon of its own: a neutral puzzle piece, never Dashi's mark. */
export const PUZZLE = svg(stroke("M3 5.5h2.6a1.6 1.6 0 1 1 3 0H11v2.4a1.6 1.6 0 1 1 0 3V13H8.4a1.6 1.6 0 1 0-3 0H3v-2.4a1.6 1.6 0 1 0 0-3z", 1.3));
