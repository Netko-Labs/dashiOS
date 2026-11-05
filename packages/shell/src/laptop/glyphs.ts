/** The laptop's glyphs: the power mode's gauge, the keyboard light, the graphics card. 16-point, drawn in black and tinted by the view. */

import type { Mode } from "../power/modes/types.ts";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A gauge whose needle points low, middle, or high. */
export function modeGlyph(mode: Mode): string {
  const angle = mode === "low-power" ? -150 : mode === "balanced" ? -90 : -30;
  const radians = (angle * Math.PI) / 180;
  const tip = `${(8 + 4.4 * Math.cos(radians)).toFixed(2)} ${(10 + 4.4 * Math.sin(radians)).toFixed(2)}`;
  return svg(`${stroke("M2.2 11.6a6 6 0 1 1 11.6 0")}${stroke(`M8 10L${tip}`, 1.6)}<circle cx="8" cy="10" r="1.3" fill="#000"/>`);
}

/** A key with light rays above it; no rays when off. */
export function keyboardLightGlyph(on: boolean): string {
  const rays = on ? stroke("M8 1.6v1.8M3.6 3.4l1.2 1.2M12.4 3.4l-1.2 1.2") : "";
  return svg(`<rect x="2.4" y="7.2" width="11.2" height="6.4" rx="1.4" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M5 10.4h6", 1.4)}${rays}`);
}

/** A graphics card: a board with a fan, crossed out when it isn't responding. */
export function graphicsGlyph(lost = false): string {
  const cross = lost ? stroke("M2 2l12 12", 1.6) : "";
  return svg(
    `<rect x="1.6" y="4.4" width="12.8" height="7.6" rx="1.4" stroke="#000" stroke-width="1.4" fill="none"/><circle cx="6.4" cy="8.2" r="2" stroke="#000" stroke-width="1.3" fill="none"/>${stroke("M10.6 6.8v2.8M12.4 6.8v2.8", 1.2)}${cross}`,
  );
}
