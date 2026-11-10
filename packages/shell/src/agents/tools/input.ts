/**
 * Hands: pointer and keyboard input in one window, on the agent's own seat
 * (so the person's pointer and focus stay where they are). Coordinates are
 * logical pixels from the top left of the window's content, the origin of a
 * window screenshot.
 */

import { isRecord } from "@dashi/shape";
import { type Args, fail, isCallError, type ToolDef, whole, windowArg, windowProp } from "./define.ts";
import { type Chord, parseKeys } from "./keys.ts";
import type { Button, CallError, Point } from "./types.ts";

/** Nothing real is further than this from a window's corner. */
const REACH = 100_000;
export const MAX_TEXT = 4096;
const BUTTONS: readonly Button[] = ["left", "right", "middle"];

const POINT_HELP = "x and y are numbers, in logical pixels from the top left of the window's content (a window screenshot's top left).";

const number = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

function point(args: unknown, what: string): Point | CallError {
  if (!isRecord(args)) return fail(`\`${what}\` needs ${POINT_HELP}`);
  const extra = Object.keys(args).find((key) => key !== "x" && key !== "y");
  if (extra) return fail(`\`${what}\` has no \`${extra}\`; it is x and y.`);
  const x = number(args.x, -REACH, REACH);
  const y = number(args.y, -REACH, REACH);
  return x === null || y === null ? fail(`\`${what}\`: ${POINT_HELP}`) : { x, y };
}

const xyProps = {
  x: { type: "number", description: "Pixels from the left of the window's content." },
  y: { type: "number", description: "Pixels from the top of the window's content." },
};

const pointProp = (description: string) => ({
  type: "object",
  description,
  properties: xyProps,
  required: ["x", "y"],
  additionalProperties: false,
});

/** `x` and `y` as arguments of their own (click, scroll). */
function atPoint(args: Args): Point | CallError {
  const x = number(args.x, -REACH, REACH);
  const y = number(args.y, -REACH, REACH);
  return x === null || y === null ? fail(`\`x\` and \`y\` are required: ${POINT_HELP}`) : { x, y };
}

export const inputTools: readonly ToolDef[] = [
  {
    name: "click",
    title: "Click in a window",
    description:
      "Click at a point in a window, with the agent's own pointer: the person's pointer and focus don't move, and the window doesn't come forward (focus_window does that). " +
      "`count` 2 double-clicks, 3 triple-clicks. If the person is using that window, it answers so and does nothing; wait a moment or work elsewhere.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: {
      window: windowProp,
      ...xyProps,
      button: { type: "string", enum: BUTTONS },
      count: { type: "integer", minimum: 1, maximum: 3 },
    },
    required: ["window", "x", "y"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const at = atPoint(args);
      if (isCallError(at)) return at;
      const button = args.button === undefined ? "left" : BUTTONS.find((candidate) => candidate === args.button);
      if (button === undefined) return fail(`\`button\` must be one of: ${BUTTONS.join(", ")}.`);
      const count = args.count === undefined ? 1 : whole(args.count, 1, 3);
      if (count === null) return fail("`count` must be 1, 2, or 3.");
      return { name: "click", window, ...at, button, count };
    },
  },
  {
    name: "scroll",
    title: "Scroll in a window",
    description:
      "Scroll with the mouse wheel at a point in a window. `dy` is in logical pixels, positive down; `dx` positive right. About 15 pixels is one wheel notch.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: {
      window: windowProp,
      ...xyProps,
      dx: { type: "number", description: "Horizontal pixels; positive scrolls right." },
      dy: { type: "number", description: "Vertical pixels; positive scrolls down." },
    },
    required: ["window", "x", "y"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const at = atPoint(args);
      if (isCallError(at)) return at;
      const dx = args.dx === undefined ? 0 : number(args.dx, -10_000, 10_000);
      const dy = args.dy === undefined ? 0 : number(args.dy, -10_000, 10_000);
      if (dx === null || dy === null) return fail("`dx` and `dy` are numbers from -10000 to 10000.");
      if (dx === 0 && dy === 0) return fail("Give a nonzero `dx` or `dy`.");
      return { name: "scroll", window, ...at, dx, dy };
    },
  },
  {
    name: "drag",
    title: "Drag in a window",
    description:
      "Press the left button at `from`, move to `to` in small steps, and let go: selecting text, moving a slider, dragging an item inside one window. " +
      "If the person starts using the window midway, it lets go at once and says so.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: {
      window: windowProp,
      from: pointProp("Where the press happens."),
      to: pointProp("Where the button is let go."),
    },
    required: ["window", "from", "to"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const from = point(args.from, "from");
      if (isCallError(from)) return from;
      const to = point(args.to, "to");
      if (isCallError(to)) return to;
      return { name: "drag", window, from, to };
    },
  },
  {
    name: "type_text",
    title: "Type text",
    description:
      "Type text into a window the way a keyboard would, wherever its keyboard focus is (click a field first if needed); the person's focus doesn't move. " +
      `Up to ${MAX_TEXT} characters; a newline presses Return and a tab presses Tab. Characters the keyboard layout can't type are refused before anything is typed. ` +
      "Never type a password or other secret for the person.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: { window: windowProp, text: { type: "string", minLength: 1, maxLength: MAX_TEXT } },
    required: ["window", "text"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      if (typeof args.text !== "string" || args.text === "") return fail("`text` is required: what to type.");
      if (args.text.length > MAX_TEXT) return fail(`\`text\` is at most ${MAX_TEXT} characters; type it in pieces.`);
      // Control characters other than Enter and Tab are not text: press_keys sends keys.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(args.text)) return fail("`text` holds a control character; use press_keys for keys like Escape.");
      return { name: "type_text", window, text: args.text };
    },
  },
  {
    name: "press_keys",
    title: "Press keys",
    description:
      'Press shortcuts and keys in a window, in Dashi\'s notation: "❖S" (❖ plays Command: it becomes the app\'s own Ctrl+S, and Ctrl+Shift+S in terminals), "⌥←", "⌃⇧Tab", "Return", "F5". ' +
      'Modifiers are ❖ ⌃ ⌥ ⇧ before the key, or words joined by +: "ctrl+shift+Tab". Several chords in a row are separated by spaces: "❖A ❖C". ' +
      "Chords the desktop keeps for itself (❖Q, ❖Tab, ⌃❖Esc) are refused; use the window tools. Use type_text for text.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: { window: windowProp, keys: { type: "string", description: 'Chords like "❖S" or "⌥← ⌥←".' } },
    required: ["window", "keys"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      if (typeof args.keys !== "string") return fail('`keys` is required: chords like "❖S" or "⌥←".');
      const chords: Chord[] | string = parseKeys(args.keys);
      return typeof chords === "string" ? fail(chords) : { name: "press_keys", window, keys: args.keys.trim(), chords };
    },
  },
];
