/** Sidebar glyphs for the machine panes, on the same 16-unit grid as glyphs.ts. */

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Network: Wi-Fi arcs over a dot. */
export const NETWORK = svg(
  `${stroke("M1.8 6.2a8.4 8.4 0 0 1 12.4 0", 1.5)}${stroke("M3.9 8.7a5.4 5.4 0 0 1 8.2 0", 1.5)}${stroke("M6 11.1a2.4 2.4 0 0 1 4 0", 1.5)}<circle cx="8" cy="13" r="1.1" fill="#000"/>`,
);

/** Sound: a speaker with two waves. */
export const SPEAKER = svg(
  `<path d="M2.2 6.2h2.4L8 3.2v9.6L4.6 9.8H2.2z" fill="#000"/>${stroke("M10.4 5.8a3.2 3.2 0 0 1 0 4.4", 1.4)}${stroke("M12.2 4a5.6 5.6 0 0 1 0 8", 1.4)}`,
);

/** Battery & Power: a battery on its side with a bolt. */
export const BATTERY = svg(
  `${stroke("M2.4 4.8h9a1 1 0 0 1 1 1v4.4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1z", 1.3)}<rect x="13.2" y="7" width="1.4" height="2" rx=".5" fill="#000"/><path d="M7.6 5.8L5.6 8.2h2.4L6.4 10.4" stroke="#000" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
);

/** Users & Accounts: a head and shoulders. */
export const PERSON = svg(`<circle cx="8" cy="5.4" r="2.6" fill="#000"/><path d="M2.8 13.6c0-2.9 2.3-4.6 5.2-4.6s5.2 1.7 5.2 4.6z" fill="#000"/>`);

/** A microphone, for the Sound pane's inputs. */
export const MICROPHONE = svg(
  `<rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2" fill="#000"/>${stroke("M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.4M5.6 14.4h4.8", 1.3)}`,
);
