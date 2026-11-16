/**
 * Elements with no DOM inside to read or click by number (a <canvas>, a chess
 * board drawn by script): look at one element only, and click a point of it
 * as fractions of its box. What this doesn't solve: knowing what the drawing
 * means (the picture has to be read), drags, and pages that ignore a click
 * made by page events (inside frames).
 */

import type { ToolDef } from "../define.ts";
import { custom, tool } from "./args.ts";
import { refArg, tabArg } from "./browser.ts";

const fraction = (name: "x" | "y", description: string) =>
  custom<number>(
    { type: "number", minimum: 0, maximum: 1, description },
    (value) => (typeof value === "number" && value >= 0 && value <= 1 ? value : null),
    `\`${name}\` is a fraction of the element's box, from 0 to 1.`,
  );

export const canvasTools: readonly ToolDef[] = [
  tool({
    name: "screenshot_element",
    title: "Picture one element of a web page",
    description:
      "A PNG of one element read_page numbered (a canvas, a game board, a chart), not the whole screen: brought into view, cropped to its box. Refused when a password, card or code field is inside it.",
    scope: "web",
    readOnly: true,
    destructive: false,
    args: { ref: refArg(), tab: tabArg() },
    build: ({ ref, tab }) => ({ name: "screenshot_element", ref, tab: tab ?? null }),
  }),
  tool({
    name: "click_in_element",
    title: "Click a point of a web page element",
    description:
      "Click inside an element at `x`, `y` as fractions of its box (0,0 its top left, 1,1 its bottom right): a square of a board, a spot on a canvas. " +
      "A real click with Dashi's pointer when it can be placed; by page events inside frames. For a chess board from White's side, file a is x 0.0625, rank 1 is y 0.9375.",
    scope: "web",
    readOnly: false,
    destructive: false,
    args: { ref: refArg(), x: fraction("x", "Across, 0 to 1."), y: fraction("y", "Down, 0 to 1."), tab: tabArg() },
    build: ({ ref, x, y, tab }) => ({ name: "click_in_element", ref, x, y, tab: tab ?? null }),
  }),
];
