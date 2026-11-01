/** The screens: pictures of them, and their size and scale. */

import { SCALES } from "../../displays.ts";
import { fail, isCallError, type ToolDef, whole, windowArg, windowProp } from "./define.ts";
import type { CallError, Rect } from "./types.ts";

/** Screen points are whole numbers well inside this; the compositor takes 32-bit ones. */
const POINTS_MAX = 100_000;

const RECT_HELP =
  "`rect` needs whole-number x, y, width, and height in screen points, width and height at least 1; list_displays gives each screen's frame.";

function parseRect(value: unknown): Rect | CallError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(RECT_HELP);
  const fields = value as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => !["x", "y", "width", "height"].includes(key));
  if (extra) return fail(`\`rect\` has no \`${extra}\`; it is x, y, width, and height.`);
  const within = (n: unknown, min: number): number | null =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= POINTS_MAX ? n : null;
  const x = within(fields.x, -POINTS_MAX);
  const y = within(fields.y, -POINTS_MAX);
  const width = within(fields.width, 1);
  const height = within(fields.height, 1);
  return x === null || y === null || width === null || height === null ? fail(RECT_HELP) : { x, y, width, height };
}

const displayProp = { type: "string", description: 'A screen name from list_displays, like "eDP-1".' };

/** The `name` of a screen: a short non-empty string (the compositor's own list is what it is checked against). */
function displayArg(args: Record<string, unknown>): string | CallError {
  const display = typeof args.name === "string" ? args.name : "";
  return display === "" || display.length > 64 ? fail('`name` is required: a screen name from list_displays, like "eDP-1".') : display;
}

export const screenTools: readonly ToolDef[] = [
  {
    name: "screenshot",
    title: "Take a screenshot",
    description:
      "A PNG of the whole screen, of one window's content when `window` is given (minimized and hidden windows too), or of an area when `rect` is given (screen points, from list_displays' frames). " +
      "One image pixel is one point times the scale reported with it.",
    scope: "screen",
    readOnly: true,
    destructive: false,
    properties: {
      window: windowProp,
      rect: {
        type: "object",
        description: "An area of the screen in points: x and y of its top left corner, and its width and height.",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
          width: { type: "integer", minimum: 1 },
          height: { type: "integer", minimum: 1 },
        },
        required: ["x", "y", "width", "height"],
        additionalProperties: false,
      },
    },
    parse: (args) => {
      if (args.window !== undefined && args.rect !== undefined) return fail("Give `window` or `rect`, not both.");
      if (args.rect !== undefined) {
        const rect = parseRect(args.rect);
        return isCallError(rect) ? rect : { name: "screenshot", window: null, rect };
      }
      if (args.window === undefined) return { name: "screenshot", window: null };
      const window = windowArg(args);
      return typeof window === "number" ? { name: "screenshot", window } : window;
    },
  },
  {
    name: "list_displays",
    title: "List screens",
    description:
      "Every screen: name, whether it is the laptop's own panel, its frame in points (where it sits and how big it is, the coordinates screenshot's `rect` uses), its size in pixels, its scale, and the scales it can take. " +
      "Screens that have an EDID also say make and model; `primary` marks the main display (menu bar and Dock), `rotation` a screen turned on its side, `refreshHz` its rate, and `modes` the resolutions and rates it can run (\"2560x1440@59.95\"). A monitor that is off is listed with enabled false.",
    scope: "see",
    readOnly: true,
    destructive: false,
    properties: {},
    parse: () => ({ name: "list_displays" }),
  },
  {
    name: "set_display_scale",
    title: "Scale a screen",
    description:
      "Make a screen's contents larger or smaller (1 is one pixel per point). Only the listed scales are offered, and not one that would leave the screen too small to use; list_displays says which fit. Windows on the screen are resized to match.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: {
      name: { type: "string", description: 'A screen name from list_displays, like "eDP-1".' },
      scale: { type: "number", enum: SCALES },
    },
    required: ["name", "scale"],
    parse: (args) => {
      const display = typeof args.name === "string" ? args.name : "";
      if (display === "" || display.length > 64) return fail("`name` is required: a screen name from list_displays, like \"eDP-1\".");
      const scale = SCALES.find((candidate) => candidate === args.scale);
      return scale === undefined ? fail(`\`scale\` must be one of: ${SCALES.join(", ")}.`) : { name: "set_display_scale", display, scale };
    },
  },
  {
    name: "set_display_mode",
    title: "Change a screen's resolution",
    description:
      "Run a screen at another resolution (and refresh rate in hertz, if you name one; otherwise its native or fastest rate). Only a mode in the screen's `modes` from list_displays works. " +
      "The change is tried first: the person is asked on screen to keep it and, with no answer in 15 seconds, the old mode comes back. The call waits for that and says which happened.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: {
      name: displayProp,
      width: { type: "integer", minimum: 1, description: "Pixels across, as in list_displays `modes`." },
      height: { type: "integer", minimum: 1, description: "Pixels down." },
      refresh_hz: { type: "number", minimum: 1, description: "Refresh rate in hertz, such as 59.94 or 120. Optional." },
    },
    required: ["name", "width", "height"],
    parse: (args) => {
      const display = displayArg(args);
      if (typeof display !== "string") return display;
      const width = whole(args.width, 1, 16_384);
      const height = whole(args.height, 1, 16_384);
      if (width === null || height === null) return fail("`width` and `height` must be whole numbers of pixels, like 2560 and 1440.");
      if (args.refresh_hz === undefined) return { name: "set_display_mode", display, width, height };
      const hertz = args.refresh_hz;
      if (typeof hertz !== "number" || !Number.isFinite(hertz) || hertz < 1 || hertz > 1000) return fail("`refresh_hz` must be a number of hertz from 1 to 1000, like 59.94.");
      return { name: "set_display_mode", display, width, height, refreshMhz: Math.round(hertz * 1000) };
    },
  },
  {
    name: "set_display_rotation",
    title: "Rotate a screen",
    description:
      "Turn a screen on its side or upside down: rotation 0 (normal), 90, 180, or 270 degrees counter-clockwise. Windows on it are moved to fit. " +
      "The change is tried first: the person is asked on screen to keep it and, with no answer in 15 seconds, it goes back. The call waits for that and says which happened.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { name: displayProp, rotation: { type: "integer", enum: [0, 90, 180, 270] } },
    required: ["name", "rotation"],
    parse: (args) => {
      const display = displayArg(args);
      if (typeof display !== "string") return display;
      const rotation = ([0, 90, 180, 270] as const).find((candidate) => candidate === args.rotation);
      return rotation === undefined ? fail("`rotation` must be one of: 0, 90, 180, 270.") : { name: "set_display_rotation", display, rotation };
    },
  },
  {
    name: "set_primary_display",
    title: "Choose the main display",
    description: "Make a screen the main display: the menu bar's first screen and the Dock move to it.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { name: displayProp },
    required: ["name"],
    parse: (args) => {
      const display = displayArg(args);
      return typeof display === "string" ? { name: "set_primary_display", display } : display;
    },
  },
  {
    name: "arrange_display",
    title: "Move a screen in the arrangement",
    description:
      "Put a screen's top-left corner at x, y in screen points (the coordinates list_displays `frame` uses). Screens never overlap and always touch an edge of another, so the spot may be moved to the nearest one that does; list_displays shows where it landed.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { name: displayProp, x: { type: "integer" }, y: { type: "integer" } },
    required: ["name", "x", "y"],
    parse: (args) => {
      const display = displayArg(args);
      if (typeof display !== "string") return display;
      const x = whole(args.x, -POINTS_MAX, POINTS_MAX);
      const y = whole(args.y, -POINTS_MAX, POINTS_MAX);
      return x === null || y === null ? fail("`x` and `y` must be whole numbers of points.") : { name: "arrange_display", display, x, y };
    },
  },
];
