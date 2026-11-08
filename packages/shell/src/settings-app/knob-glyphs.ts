/**
 * The glyphs on Settings' knobs (the sidebar's pills and the rows'), as the
 * approved design draws them (docs/design.html, "Settings"): 1.75 strokes
 * on a 24-unit grid, round caps, tinted by the Svg `color`. A drop for
 * Accent, keyboard keys as dashes, a shield for Privacy.
 */

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const SEARCH = svg(`<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>`);
export const CONTRAST = svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="#000"/>`);
export const IMAGE = svg(`<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/>`);
export const DISPLAY = svg(`<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>`);
export const DOCK = svg(`<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 16h10"/>`);
export const WIFI = svg(`<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/>`);
export const BLUETOOTH = svg(`<path d="M7 7l10 10-5 4V3l5 4L7 17"/>`);
export const VOLUME = svg(`<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6"/>`);
export const BATTERY = svg(
  `<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3"/><rect x="5" y="9.5" width="10" height="5" rx="1" fill="#000" stroke="none"/>`,
);
export const GPU = svg(`<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="9" cy="12" r="2.5"/>`);
export const KEYBOARD = svg(`<rect x="2.5" y="7" width="19" height="11" rx="2"/><path d="M5.5 10.5h1.5M9 10.5h1.5M12.5 10.5h1.5M16 10.5h2.5M7 14.5h10"/>`);
export const DROP = svg(`<path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.5-6.3 6-10.5z"/>`);
export const TRACKPAD = svg(`<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15h16M12 15v5"/>`);
export const MOUSE = svg(`<rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 3.5v5"/>`);
export const USER = svg(`<circle cx="12" cy="9" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>`);
export const CLOCK = svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`);
export const GLOBE = svg(`<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>`);
export const LOCK = svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`);
export const BELL = svg(`<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5h4"/>`);
export const KEY = svg(`<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2"/>`);
export const SPARK = svg(`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>`);
export const SHIELD = svg(`<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>`);
export const GRID = svg(
  `<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>`,
);
export const SUN = svg(
  `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
);
export const NIGHT_SHIFT = svg(`<path d="M3 17h18M7 13a5 5 0 0 1 10 0"/><path d="M12 4v3"/>`);
export const GAUGE = svg(`<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>`);
export const PLUG = svg(`<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>`);
export const MOON = svg(`<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`);
export const TEXT = svg(`<path d="M5 7V5h14v2M12 5v14M9 19h6"/>`);
/** About: an i in a circle. */
export const INFO = svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="#000"/>`);
/** Recently changed: a clock whose rim turns back. */
export const HISTORY = svg(`<path d="M4.5 9.5a8 8 0 1 1-.3 4.2"/><path d="M3.5 5v4.5H8"/><path d="M12 8v4l2.5 1.8"/>`);
/** A pointer, for the pointer size. */
export const POINTER = svg(`<path d="M6 3.5l12 8.2-5.3 1.1 3.1 6.1-2.4 1.2-3.1-6.1L6.5 17.5z"/>`);
/** Motion: a ball with its trail. */
export const MOTION = svg(`<circle cx="15.5" cy="12" r="4.5"/><path d="M3 9h5M4 12h4M3 15h5"/>`);
/** A window with its corner rounded. */
export const CORNER = svg(`<path d="M5 19V11a6 6 0 0 1 6-6h8"/>`);
/** A ring round a window: the active window's highlight. */
export const RING = svg(`<rect x="4" y="5" width="16" height="14" rx="3"/><rect x="1.5" y="2.5" width="21" height="19" rx="5" stroke-dasharray="2 2.5"/>`);
/** The Dock's and the Desktops' rows. */
export const DESKTOPS = svg(`<rect x="3" y="6" width="13" height="10" rx="2"/><path d="M8 19h11a2 2 0 0 0 2-2V9"/>`);
/** A speaker over a microphone: Sound's input. */
export const MIC = svg(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>`);
/** A photo for the account picture, a video for live wallpaper. */
export const VIDEO = svg(`<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>`);
/** The processor: a chip with its pins. */
export const CHIP = svg(`<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>`);
/** The lid: a laptop half closed. */
export const LID = svg(`<path d="M5 16l2.5-10h9L19 16"/><path d="M3 19h18"/>`);
/** The power button. */
export const POWER = svg(`<path d="M12 3v8"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0"/>`);
/** A link out, a refresh: two arrows chasing. */
export const REFRESH = svg(`<path d="M19 8a7.5 7.5 0 0 0-13.5 1M5 16a7.5 7.5 0 0 0 13.5-1"/><path d="M19 3.5V8h-4.5M5 20.5V16h4.5"/>`);
/** A copy on the clipboard. */
export const CLIPBOARD = svg(`<rect x="5" y="5" width="14" height="16" rx="2.5"/><path d="M9 5V3.5h6V5"/>`);
/** A card for payments. */
export const CARD = svg(`<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 14.5h3"/>`);
/** Ethernet: a plug's face. */
export const ETHERNET = svg(`<rect x="4" y="5" width="16" height="12" rx="2"/><path d="M9 17v3h6v-3M8 9v3M11 9v3M13 9v3M16 9v3"/>`);
/** Hands for the agents' kept answers. */
export const CHECKLIST = svg(`<path d="M4 7l2 2 3.5-3.5M4 15l2 2 3.5-3.5M13 8h7M13 16h7"/>`);
/** Scrolling: up and down. */
export const SCROLL = svg(`<path d="M12 3.5v17M8 7.5l4-4 4 4M8 16.5l4 4 4-4"/>`);
/** A tap: a finger's press, ringed. */
export const TAP = svg(`<circle cx="12" cy="10" r="2.5"/><path d="M7 10a5 5 0 0 1 10 0"/><path d="M12 12.5V21"/>`);
/** A keyboard key held: repeat. */
export const REPEAT = svg(
  `<path d="M17 4.5l2.5 2.5L17 9.5"/><path d="M4.5 12V10a3 3 0 0 1 3-3h12M7 19.5L4.5 17 7 14.5"/><path d="M19.5 12v2a3 3 0 0 1-3 3h-12"/>`,
);
/** Languages: an A and a stroke of another script. */
export const LANGUAGE = svg(`<path d="M3.5 18l4.5-11 4.5 11M5.3 14h5.4"/><path d="M14 6.5h6.5M17.2 4.5v2c0 4-1.7 7-4.2 8.5M15.2 10c1.1 2 2.9 3.6 5.3 4.5"/>`);
/** A calendar page: dates, the first day of the week. */
export const CALENDAR = svg(`<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>`);
