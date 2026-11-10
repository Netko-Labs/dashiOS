/** The screens: pictures of them, and their size and scale. */

import { isRecord, obj, optional } from "@dashi/shape";
import { SCALES } from "../../../displays.ts";
import { fail, type ToolDef, whole } from "../define.ts";
import { arg, custom, tool, wholeArg, windowId } from "./args.ts";

/** Screen points are whole numbers well inside this; the compositor takes 32-bit ones. */
const POINTS_MAX = 100_000;

const RECT_HELP = "`rect` needs whole-number x, y, width, and height in screen points, width and height at least 1; list_displays gives each screen's frame.";

const within =
  (min: number) =>
  (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= POINTS_MAX ? value : null;

/** A rectangle of the screen in points: `x` and `y` of its top left corner, then its `width` and `height` (the listing's words, the check's numbers). */
const rect = arg(
  obj({
    x: custom({ type: "integer" }, within(-POINTS_MAX), RECT_HELP),
    y: custom({ type: "integer" }, within(-POINTS_MAX), RECT_HELP),
    width: custom({ type: "integer", minimum: 1 }, within(1), RECT_HELP),
    height: custom({ type: "integer", minimum: 1 }, within(1), RECT_HELP),
  }),
  (given) => {
    const extra = isRecord(given) ? Object.keys(given).find((key) => !["x", "y", "width", "height"].includes(key)) : undefined;
    return extra ? `\`rect\` has no \`${extra}\`; it is x, y, width, and height.` : RECT_HELP;
  },
  "An area of the screen in points: x and y of its top left corner, and its width and height.",
);

const PIXELS_SAY = "`width` and `height` must be whole numbers of pixels, like 2560 and 1440.";
const POINTS_SAY = "`x` and `y` must be whole numbers of points.";

const DISPLAY_SAYS = '`name` is required: a screen name from list_displays, like "eDP-1".';

/** The `name` of a screen: a short non-empty string (the compositor's own list is what it is checked against). */
const displayName = custom(
  { type: "string", description: 'A screen name from list_displays, like "eDP-1".' },
  (value) => (typeof value === "string" && value !== "" && value.length <= 64 ? value : null),
  DISPLAY_SAYS,
);

export const screenTools: readonly ToolDef[] = [
  tool({
    name: "screenshot",
    title: "Take a screenshot",
    description:
      "A PNG of the whole screen, of one window's content when `window` is given (minimized and hidden windows too), or of an area when `rect` is given (screen points, from list_displays' frames). " +
      "One image pixel is one point times the scale reported with it.",
    scope: "screen",
    readOnly: true,
    destructive: false,
    args: { window: optional(windowId), rect: optional(rect) },
    build: ({ window, rect }) => {
      if (window !== undefined && rect !== undefined) return fail("Give `window` or `rect`, not both.");
      if (rect !== undefined) return { name: "screenshot", window: null, rect };
      return window === undefined ? { name: "screenshot", window: null } : { name: "screenshot", window };
    },
  }),
  tool({
    name: "record_screen",
    title: "Record the screen",
    description:
      "Record a video of a whole screen (`name`, else the main display) or of an area (`rect`, screen points) for `seconds`, saved to the person's Videos/Screen Recordings folder. " +
      "Use it to see what happens over time, such as an animation or a drag, which a screenshot can't catch: do the other calls while it records (it returns when the time is up). " +
      "Returns the video's path and `frames` stills taken evenly through the recording. The menu bar shows the recording's stop button, and the person may stop it early.",
    scope: "screen",
    readOnly: false,
    destructive: false,
    args: {
      seconds: optional(wholeArg(1, 60, "`seconds` must be a whole number from 1 to 60.", "How long to record, 1 to 60 seconds. Default 5.")),
      name: optional(displayName),
      rect: optional(rect),
      frames: optional(wholeArg(0, 8, "`frames` must be a whole number from 0 to 8.", "Stills to return, 0 to 8. Default 3.")),
    },
    build: ({ seconds, name, rect, frames }) => {
      if (name !== undefined && rect !== undefined) return fail("Give `name` or `rect`, not both.");
      const taken = { seconds: seconds ?? 5, frames: frames ?? 3 };
      if (rect !== undefined) return { name: "record_screen", ...taken, display: null, rect };
      return { name: "record_screen", ...taken, display: name ?? null };
    },
  }),
  tool({
    name: "list_displays",
    title: "List screens",
    description:
      "Every screen: name, whether it is the laptop's own panel, its frame in points (where it sits and how big it is, the coordinates screenshot's `rect` uses), its size in pixels, its scale, and the scales it can take. " +
      'Screens that have an EDID also say make and model; `primary` marks the main display (menu bar and Dock), `rotation` a screen turned on its side, `refreshHz` its rate, and `modes` the resolutions and rates it can run ("2560x1440@59.95"). A monitor that is off is listed with enabled false.',
    scope: "see",
    readOnly: true,
    destructive: false,
    args: {},
    build: () => ({ name: "list_displays" }),
  }),
  tool({
    name: "set_display_scale",
    title: "Scale a screen",
    description:
      "Make a screen's contents larger or smaller (1 is one pixel per point). Only the listed scales are offered, and not one that would leave the screen too small to use; list_displays says which fit. Windows on the screen are resized to match.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {
      name: displayName,
      scale: custom(
        { type: "number", enum: SCALES },
        (value) => SCALES.find((candidate) => candidate === value) ?? null,
        `\`scale\` must be one of: ${SCALES.join(", ")}.`,
      ),
    },
    build: ({ name, scale }) => ({ name: "set_display_scale", display: name, scale }),
  }),
  tool({
    name: "set_display_mode",
    title: "Change a screen's resolution",
    description:
      "Run a screen at another resolution (and refresh rate in hertz, if you name one; otherwise its native or fastest rate). Only a mode in the screen's `modes` from list_displays works. " +
      "The change is tried first: the person is asked on screen to keep it and, with no answer in 15 seconds, the old mode comes back. The call waits for that and says which happened. " +
      "On a laptop's own screen with Automatic refresh rate, the rate you set holds until the computer is next plugged in or unplugged; then Automatic picks again.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {
      name: displayName,
      width: custom(
        { type: "integer", minimum: 1, description: "Pixels across, as in list_displays `modes`." },
        (value) => whole(value, 1, 16_384),
        PIXELS_SAY,
      ),
      height: custom({ type: "integer", minimum: 1, description: "Pixels down." }, (value) => whole(value, 1, 16_384), PIXELS_SAY),
      refresh_hz: optional(
        custom(
          { type: "number", minimum: 1, description: "Refresh rate in hertz, such as 59.94 or 120. Optional." },
          (value) => (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 1000 ? value : null),
          "`refresh_hz` must be a number of hertz from 1 to 1000, like 59.94.",
        ),
      ),
    },
    build: ({ name, width, height, refresh_hz }) => ({
      name: "set_display_mode",
      display: name,
      width,
      height,
      ...(refresh_hz === undefined ? {} : { refreshMhz: Math.round(refresh_hz * 1000) }),
    }),
  }),
  tool({
    name: "set_display_rotation",
    title: "Rotate a screen",
    description:
      "Turn a screen on its side or upside down: rotation 0 (normal), 90, 180, or 270 degrees counter-clockwise. Windows on it are moved to fit. " +
      "The change is tried first: the person is asked on screen to keep it and, with no answer in 15 seconds, it goes back. The call waits for that and says which happened.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {
      name: displayName,
      rotation: custom(
        { type: "integer", enum: [0, 90, 180, 270] },
        (value) => ([0, 90, 180, 270] as const).find((candidate) => candidate === value) ?? null,
        "`rotation` must be one of: 0, 90, 180, 270.",
      ),
    },
    build: ({ name, rotation }) => ({ name: "set_display_rotation", display: name, rotation }),
  }),
  tool({
    name: "set_primary_display",
    title: "Choose the main display",
    description: "Make a screen the main display: the menu bar's first screen and the Dock move to it.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: { name: displayName },
    build: ({ name }) => ({ name: "set_primary_display", display: name }),
  }),
  tool({
    name: "arrange_display",
    title: "Move a screen in the arrangement",
    description:
      "Put a screen's top-left corner at x, y in screen points (the coordinates list_displays `frame` uses). Screens never overlap and always touch an edge of another, so the spot may be moved to the nearest one that does; list_displays shows where it landed.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {
      name: displayName,
      x: custom({ type: "integer" }, (value) => whole(value, -POINTS_MAX, POINTS_MAX), POINTS_SAY),
      y: custom({ type: "integer" }, (value) => whole(value, -POINTS_MAX, POINTS_MAX), POINTS_SAY),
    },
    build: ({ name, x, y }) => ({ name: "arrange_display", display: name, x, y }),
  }),
];
