/** Notes' glyphs, on the kit's 16-unit grid and tinted by the Svg `color`. */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A page with a pencil: New Note. */
export const COMPOSE = svg(
  `${stroke("M8.4 3H4a1.4 1.4 0 0 0-1.4 1.4v7.6A1.4 1.4 0 0 0 4 13.4h7.6A1.4 1.4 0 0 0 13 12V7.6")}${stroke("M12.6 2.2a1.2 1.2 0 0 1 1.7 1.7L8.6 9.6 6.2 10.2l.6-2.4z", 1.3)}`,
);

export const TRASH = svg(
  `${stroke("M2.6 4.2h10.8M6.2 4.2V2.8h3.6v1.4")}${stroke("M4 4.2l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4")}${stroke("M6.7 6.8v4M9.3 6.8v4", 1.2)}`,
);

/** A pushpin, outline. */
export const PIN = svg(`${stroke("M6 2.4h4l-.5 3.3 2.2 2.1H4.3l2.2-2.1z", 1.3)}${stroke("M8 7.8v5.8")}`);
/** A pushpin, filled: the note is pinned. */
export const PIN_FILLED = svg(`<path d="M6 2.4h4l-.5 3.3 2.2 2.1H4.3l2.2-2.1z" fill="#000"/>${stroke("M8 7.8v5.8")}`);

export const FOLDER = svg(stroke("M1.8 4.4V12a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.6 3.4H2.8a1 1 0 0 0-1 1z", 1.3));
export const FOLDER_PLUS = svg(
  `${stroke("M1.8 4.4V12a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.6 3.4H2.8a1 1 0 0 0-1 1z", 1.3)}${stroke("M8 7.4v3.6M6.2 9.2h3.6", 1.3)}`,
);
/** Folder with an arrow: Move to. */
export const FOLDER_MOVE = svg(
  `${stroke("M1.8 4.4V12a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.6 3.4H2.8a1 1 0 0 0-1 1z", 1.3)}${stroke("M5.6 9.2h4.6M8.6 7.6l1.6 1.6-1.6 1.6", 1.3)}`,
);

/** All Notes: a stack of pages. */
export const NOTES = svg(
  `${stroke("M3.4 2.2h7.8a1.2 1.2 0 0 1 1.2 1.2v9.2a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z", 1.3)}${stroke("M5 5.4h4.6M5 8h4.6M5 10.6h2.6", 1.2)}`,
);
export const NOTE = NOTES;

/** A checklist: a box with a tick, and a line. */
export const CHECKLIST = svg(
  `${stroke("M2.2 3.4h3.4v3.4H2.2zM2.2 9.4h3.4v3.4H2.2z", 1.2)}${stroke("M2.8 5l.8.8 1.3-1.5", 1.1)}${stroke("M8 5h5.6M8 11h5.6", 1.4)}`,
);

/** Eye, Pencil: the Edit and Preview toggle. */
export const RESTORE = svg(`${stroke("M3 8a5 5 0 1 0 1.6-3.7")}${stroke("M3 2.6v2.8h2.8", 1.4)}`);

export const TICK = svg(stroke("M3.4 8.4l3 3 6.2-6.8", 1.9));
