/**
 * The ⇧❖5 toolbar's glyphs (recorder/lib/toolbar.tsx), in the style of Dashi's
 * command glyphs (16 × 16, round ends): the screen, the front window and an
 * area to capture, the two ways to record, the microphone, and close. The
 * launcher's Screenshot of the Screen and Screenshot of an Area rows wear
 * the screen's and the area's (launcher/command-glyphs.ts).
 */

import type { CaptureMode } from "./types.ts";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const line = (d: string, width = 1.4): string =>
  `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const frame = (dash: boolean): string =>
  `<rect x="1.8" y="3" width="12.4" height="10" rx="1.6" fill="none" stroke="#000" stroke-width="1.3"${dash ? ' stroke-dasharray="2 1.6"' : ""}/>`;
const recordDot = `<circle cx="11.6" cy="11.4" r="3.2" fill="#000"/>`;

/** Each of the toolbar's modes: a screen's frame, the window's (with its title bar), the area's dashed, and the recordings' with their dot. */
export const CAPTURE_GLYPHS: Readonly<Record<CaptureMode, string>> = {
  screen: svg(frame(false)),
  window: svg(`${frame(false)}${line("M1.8 5.8h12.4", 1.2)}`),
  area: svg(frame(true)),
  "record-screen": svg(`${line("M1.8 4.6a1.6 1.6 0 0 1 1.6-1.6h9.2a1.6 1.6 0 0 1 1.6 1.6V8M7 13H3.4a1.6 1.6 0 0 1-1.6-1.6V4.6", 1.3)}${recordDot}`),
  "record-area": svg(
    `<path d="M7 13H3.4a1.6 1.6 0 0 1-1.6-1.6V4.6A1.6 1.6 0 0 1 3.4 3h9.2a1.6 1.6 0 0 1 1.6 1.6V8" fill="none" stroke="#000" stroke-width="1.3" stroke-dasharray="2 1.6"/>${recordDot}`,
  ),
};

/** Record with sound: a microphone. */
export const MICROPHONE = svg(
  `<rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2" fill="none" stroke="#000" stroke-width="1.3"/>${line("M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.2", 1.3)}`,
);

/** Close the toolbar: a cross. */
export const CLOSE = svg(line("M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6", 1.6));
