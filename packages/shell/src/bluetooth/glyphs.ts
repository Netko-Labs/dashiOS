/** One glyph per kind of device, drawn like the rest of the shell's icons (tinted by the Svg `color`). */

import { BLUETOOTH } from "../control-center/glyphs.ts";
import type { DeviceKind } from "./types.ts";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.3) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d: string) => `<path d="${d}" fill="#000"/>`;

const GLYPHS: Record<DeviceKind, string> = {
  // A band over two ear cups.
  headphones: svg(
    stroke("M2.8 10.2V8a5.2 5.2 0 0 1 10.4 0v2.2") +
      fill("M2.2 9.6h2.2a.8.8 0 0 1 .8.8v2.6a.8.8 0 0 1-.8.8H3.4a1.2 1.2 0 0 1-1.2-1.2z") +
      fill("M13.8 9.6h-2.2a.8.8 0 0 0-.8.8v2.6a.8.8 0 0 0 .8.8h1a1.2 1.2 0 0 0 1.2-1.2z"),
  ),
  // A box with a large and a small driver.
  speaker: svg(
    stroke("M4.6 1.8h6.8a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z") +
      `<circle cx="8" cy="9.6" r="2.3" fill="#000"/><circle cx="8" cy="4.6" r=".9" fill="#000"/>`,
  ),
  mouse: svg(stroke("M8 1.8c-2.5 0-4 1.6-4 4v4.4c0 2.6 1.6 4 4 4s4-1.4 4-4V5.8c0-2.4-1.5-4-4-4zM8 1.8v4.2")),
  keyboard: svg(
    stroke("M2.6 4.4h10.8a1.1 1.1 0 0 1 1.1 1.1v5a1.1 1.1 0 0 1-1.1 1.1H2.6a1.1 1.1 0 0 1-1.1-1.1v-5a1.1 1.1 0 0 1 1.1-1.1z") +
      stroke("M4.2 7h.1M6.4 7h.1M8.6 7h.1M10.8 7h.1M4.2 9.2h.1M11.8 9.2h.1M6 9.2h4", 1.5),
  ),
  phone: svg(stroke("M5.4 1.6h5.2a1.2 1.2 0 0 1 1.2 1.2v10.4a1.2 1.2 0 0 1-1.2 1.2H5.4a1.2 1.2 0 0 1-1.2-1.2V2.8a1.2 1.2 0 0 1 1.2-1.2zM7 12.2h2")),
  generic: BLUETOOTH,
};

export const deviceGlyph = (kind: DeviceKind): string => GLYPHS[kind];
