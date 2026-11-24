/**
 * Where a new window opens (the answer to `window-placing`), as decided in
 * decisions.md D530 to D532:
 *
 *   - a dialog (a window with a parent) over its parent, on the parent's screen;
 *   - an app's further window beside its front window, a step down and right,
 *     on that window's screen;
 *   - an app's first window where its last one was (memory.ts), pulled inside
 *     what the bar and Dock leave free; when that screen is gone, on the
 *     screen the person works on at the same size;
 *   - anything else on the screen the person works on (active-screen.ts: the
 *     pointer's, else the focused window's), centered a third of the way down
 *     and cascading.
 *
 * An app that asked for a spot (X11 apps do) gets it, on any screen.
 */

import type { Compositor, CompositorWindow, Placing } from "../../compositor/index.ts";
import { chooseScreen, fitFrame, type Output, placeNew, type Rect, type Tile, usableFor } from "../../layout.ts";
import type { ArrangeContext } from "./arrange-frames.ts";
import { recall, type WindowMemory } from "./memory.ts";

/** How far an app's further window steps from its front one. */
const STEP = 28;

/** Where the window opens, and how it is arranged there. */
export interface Placement {
  frame: Rect;
  tile: Tile | null;
  fullscreen: boolean;
  /** It came from the app's memory. */
  recalled: boolean;
}

/** What placing reads: the screens, the windows (front to back), the pointer. */
export interface PlacingWorld {
  outputs: readonly Output[];
  windows: readonly CompositorWindow[];
  pointer: { x: number; y: number } | null;
}

/** The usable area of the screen the person works on: the pointer's, else the focused window's, else the first. */
export function activeUsable(world: PlacingWorld, placing: number): Rect | null {
  const first = world.outputs[0]?.usable ?? null;
  const focused = world.windows.find((window) => window.focused && window.id !== placing && window.state === "normal")?.frame ?? null;
  const name = chooseScreen(world.outputs, world.pointer, focused);
  return world.outputs.find((output) => output.name === name)?.usable ?? first;
}

/**
 * Windows that are no app's own: the portal's dialogs, sheets of another
 * app's window (`PORTAL_APP_ID`, shared/portal-host/protocol.ts), and the
 * window wl-copy maps for a moment (`CLIPBOARD_HELPER_APP_ID`, toplevels.ts).
 * Named here, not imported: the agents' MCP server loads the arranger, and
 * neither module belongs in it.
 */
const NOT_APPS: ReadonlySet<string> = new Set(["dev.dashi.portal", "io.github.bugaevc.wl-clipboard"]);

/** Whether a window may take its app's memory, and leave one when it closes: an app's own window, with no parent and no spot asked. */
export function remembers(window: Placing): boolean {
  return window.appId !== "" && !NOT_APPS.has(window.appId) && window.parent === undefined && window.position === undefined;
}

/** The other windows of the same app, front first. */
function siblings(world: PlacingWorld, window: Placing): CompositorWindow[] {
  return window.appId === "" ? [] : world.windows.filter((other) => other.id !== window.id && other.appId === window.appId);
}

/** A frame of `size` over `parent`: centered across, a third of the way down its free height, inside `usable`. */
function overParent(size: { width: number; height: number }, parent: Rect, usable: Rect): Rect {
  const x = parent.x + Math.floor((parent.width - size.width) / 2);
  const y = parent.y + Math.floor(Math.max(parent.height - size.height, 0) / 3);
  return fitFrame({ x, y, width: size.width, height: size.height }, usable);
}

/**
 * Where `window` opens; `memory` is its app's (null for none), `next` counts
 * the cascade of windows opened on the active screen. Null when there is no
 * screen to open on.
 */
export function placement(world: PlacingWorld, window: Placing, memory: WindowMemory | null, next: () => number): Placement | null {
  const size = { width: window.width, height: window.height };
  const plain = (frame: Rect): Placement => ({ frame, tile: null, fullscreen: false, recalled: false });
  const parent = window.parent === undefined ? undefined : world.windows.find((other) => other.id === window.parent);
  if (parent?.frame) {
    const usable = usableFor(parent.frame, world.outputs);
    if (usable) return plain(overParent(size, parent.frame, usable));
  }
  if (window.position) {
    const at = { ...window.position, ...size };
    const usable = usableFor(at, world.outputs);
    return usable ? plain(fitFrame(at, usable)) : null;
  }
  const others = siblings(world, window);
  const front = others.find((other) => other.state === "normal" && other.frame);
  if (front?.frame) {
    const usable = usableFor(front.frame, world.outputs);
    if (usable) return plain(fitFrame({ x: front.frame.x + STEP, y: front.frame.y + STEP, ...size }, usable));
  }
  const active = activeUsable(world, window.id);
  if (!active) return null;
  if (memory && others.length === 0 && remembers(window)) return { ...recall(memory, world.outputs, active), recalled: true };
  return plain(fitFrame({ ...placeNew(size, active, next()), ...size }, active));
}

/** The screens, windows and pointer, as placing reads them; a locked session (no windows, no pointer) still places. */
export async function placingWorld(compositor: Pick<Compositor, "session" | "windows">, outputs: readonly Output[]): Promise<PlacingWorld> {
  const [session, windows] = await Promise.all([compositor.session().catch(() => null), compositor.windows().catch(() => [])]);
  return { outputs, windows, pointer: session?.pointer ?? null };
}

/**
 * Place a new window (also a claimed one that could not be placed its own
 * way): where `placement` says, on the Space it belongs on, at the size it
 * was given there. A window taller or wider than the usable area is shrunk
 * to fit once placed (not left under the Dock). Returns where it went, or
 * null when there was no screen.
 */
export async function placeWindow(context: ArrangeContext, window: Placing, memory: WindowMemory | null, next: () => number): Promise<Placement | null> {
  const world = await placingWorld(context.compositor, context.outputs);
  const placed = placement(world, window, memory, next);
  if (!placed) return null;
  const { frame, tile } = placed;
  // While a full-screen Desktop shows, another app's window opens on the Desktop it came from.
  // An agent at work on another Desktop: its window opens there, and the screen stays where it is.
  const away = (await context.elsewhere?.(window).catch(() => null)) ?? null;
  const space = away ?? (await context.desktops?.spaceFor(window).catch(() => null)) ?? null;
  await context.compositor.place({ window: window.id, x: frame.x, y: frame.y, ...(space === null ? {} : { space }) });
  if (tile || frame.width !== window.width || frame.height !== window.height) await context.frame(window.id, frame, tile);
  if (space !== null && away === null) await context.desktops?.opened(space);
  return placed;
}
