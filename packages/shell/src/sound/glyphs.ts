/**
 * The output glyphs for the Sound page's list (the speaker and Bluetooth
 * glyphs are shared with the status items and Control Center).
 */

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

const cup = (x: number) => `<rect x="${x}" y="8.8" width="3.2" height="5" rx="1.3" fill="#000"/>`;

/** Headphones: a band over the head and a cup on each side. */
export const HEADPHONES = svg(`${stroke("M2.8 9.4V8a5.2 5.2 0 0 1 10.4 0v1.4")}${cup(1.9)}${cup(10.9)}`);

/** A monitor, for an HDMI or DisplayPort output. */
export const DISPLAY = svg(
  `<rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.4" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M5.6 13.6h4.8M8 11v2.6")}`,
);
