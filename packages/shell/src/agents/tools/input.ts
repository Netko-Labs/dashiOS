/**
 * Hands: pointer and keyboard input in one window, on the agent's own seat
 * (so the person's pointer and focus stay where they are). Coordinates are
 * logical pixels from the top left of the window's content, the origin of a
 * window screenshot.
 */

import { isRecord, obj, optional } from "@dashi/shape";
import { arg, custom, tool, wholeArg, windowId } from "./args.ts";
import { fail, type ToolDef } from "./define.ts";
import { type Chord, parseKeys } from "./keys.ts";
import type { Button } from "./types.ts";

/** Nothing real is further than this from a window's corner. */
const REACH = 100_000;
export const MAX_TEXT = 4096;
const BUTTONS: readonly Button[] = ["left", "right", "middle"];

const POINT_HELP = "x and y are numbers, in logical pixels from the top left of the window's content (a window screenshot's top left).";

const number = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

/** A number a pointer can be at: finite, and within `REACH` of the window's corner. */
const reach = (value: unknown): number | null => number(value, -REACH, REACH);

const X = { type: "number", description: "Pixels from the left of the window's content." };
const Y = { type: "number", description: "Pixels from the top of the window's content." };

/** `x` and `y` as arguments of their own (click, scroll). */
const at = {
  x: custom(X, reach, `\`x\` and \`y\` are required: ${POINT_HELP}`),
  y: custom(Y, reach, `\`x\` and \`y\` are required: ${POINT_HELP}`),
};

/** A point as one argument (drag): `{x, y}`, described as `description`. */
const pointArg = (what: string, description: string) =>
  arg(
    obj({ x: custom(X, reach, `\`${what}\`: ${POINT_HELP}`), y: custom(Y, reach, `\`${what}\`: ${POINT_HELP}`) }),
    (given) => {
      if (!isRecord(given)) return `\`${what}\` needs ${POINT_HELP}`;
      const extra = Object.keys(given).find((key) => key !== "x" && key !== "y");
      return extra ? `\`${what}\` has no \`${extra}\`; it is x and y.` : `\`${what}\`: ${POINT_HELP}`;
    },
    description,
  );

const SCROLL_SAYS = "`dx` and `dy` are numbers from -10000 to 10000.";

/** Control characters other than Enter and Tab are not text: press_keys sends keys. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** What typing `given` is refused for. */
function typingSays(given: unknown): string {
  if (typeof given !== "string" || given === "") return "`text` is required: what to type.";
  if (given.length > MAX_TEXT) return `\`text\` is at most ${MAX_TEXT} characters; type it in pieces.`;
  return "`text` holds a control character; use press_keys for keys like Escape.";
}

/** What pressing `given` is refused for. */
function keysSays(given: unknown): string {
  if (typeof given !== "string") return '`keys` is required: chords like "❖S" or "⌥←".';
  const chords = parseKeys(given);
  return typeof chords === "string" ? chords : "`keys` is not chords.";
}

export const inputTools: readonly ToolDef[] = [
  tool({
    name: "click",
    title: "Click in a window",
    description:
      "Click at a point in a window, with the agent's own pointer: the person's pointer and focus don't move, and the window doesn't come forward (focus_window does that). " +
      "`count` 2 double-clicks, 3 triple-clicks. If the person is using that window, it answers so and does nothing; wait a moment or work elsewhere.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      window: windowId,
      ...at,
      button: optional(
        custom(
          { type: "string", enum: BUTTONS },
          (value) => BUTTONS.find((candidate) => candidate === value) ?? null,
          `\`button\` must be one of: ${BUTTONS.join(", ")}.`,
        ),
      ),
      count: optional(wholeArg(1, 3, "`count` must be 1, 2, or 3.")),
    },
    build: ({ window, x, y, button, count }) => ({ name: "click", window, x, y, button: button ?? "left", count: count ?? 1 }),
  }),
  tool({
    name: "scroll",
    title: "Scroll in a window",
    description:
      "Scroll with the mouse wheel at a point in a window. `dy` is in logical pixels, positive down; `dx` positive right. About 15 pixels is one wheel notch.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      window: windowId,
      ...at,
      dx: optional(
        custom({ type: "number", description: "Horizontal pixels; positive scrolls right." }, (value) => number(value, -10_000, 10_000), SCROLL_SAYS),
      ),
      dy: optional(custom({ type: "number", description: "Vertical pixels; positive scrolls down." }, (value) => number(value, -10_000, 10_000), SCROLL_SAYS)),
    },
    build: ({ window, x, y, dx = 0, dy = 0 }) => (dx === 0 && dy === 0 ? fail("Give a nonzero `dx` or `dy`.") : { name: "scroll", window, x, y, dx, dy }),
  }),
  tool({
    name: "drag",
    title: "Drag in a window",
    description:
      "Press the left button at `from`, move to `to` in small steps, and let go: selecting text, moving a slider, dragging an item inside one window. " +
      "If the person starts using the window midway, it lets go at once and says so.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: { window: windowId, from: pointArg("from", "Where the press happens."), to: pointArg("to", "Where the button is let go.") },
    build: ({ window, from, to }) => ({ name: "drag", window, from, to }),
  }),
  tool({
    name: "type_text",
    title: "Type text",
    description:
      "Type text into a window the way a keyboard would, wherever its keyboard focus is (click a field first if needed); the person's focus doesn't move. " +
      `Up to ${MAX_TEXT} characters; a newline presses Return and a tab presses Tab. Characters the keyboard layout can't type are refused before anything is typed. ` +
      "Never type a password or other secret for the person.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      window: windowId,
      text: custom(
        { type: "string", minLength: 1, maxLength: MAX_TEXT },
        (value) => (typeof value === "string" && value !== "" && value.length <= MAX_TEXT && !CONTROL.test(value) ? value : null),
        typingSays,
      ),
    },
    build: ({ window, text }) => ({ name: "type_text", window, text }),
  }),
  tool({
    name: "press_keys",
    title: "Press keys",
    description:
      'Press shortcuts and keys in a window, in Dashi\'s notation: "❖S" (❖ plays Command: it becomes the app\'s own Ctrl+S, and Ctrl+Shift+S in terminals), "⌥←", "⌃⇧Tab", "Return", "F5". ' +
      'Modifiers are ❖ ⌃ ⌥ ⇧ before the key, or words joined by +: "ctrl+shift+Tab". Several chords in a row are separated by spaces: "❖A ❖C". ' +
      "Chords the desktop keeps for itself (❖Q, ❖Tab, ⌃❖Esc) are refused; use the window tools. Use type_text for text.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      window: windowId,
      keys: custom<{ keys: string; chords: Chord[] }>(
        { type: "string", description: 'Chords like "❖S" or "⌥← ⌥←".' },
        (value) => {
          const chords = typeof value === "string" ? parseKeys(value) : "";
          return typeof value === "string" && typeof chords !== "string" ? { keys: value.trim(), chords } : null;
        },
        keysSays,
      ),
    },
    build: ({ window, keys }) => ({ name: "press_keys", window, keys: keys.keys, chords: keys.chords }),
  }),
];
