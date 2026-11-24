/**
 * The frames arrange.ts works out, apart from the compositor it asks: the
 * frame
 * a window is given back after a screen change or full screen (where a new
 * window opens is placing.ts). What Arranger remembers of a window is `Arranged`.
 */

import type { Compositor, CompositorEvent, CompositorWindow, Placing } from "../../compositor/index.ts";
import { carryFrame, fitFrame, keepLeast, type Output, type Rect, sameRect, screenFor, type Tile, tileFrame, usableFor } from "../../layout.ts";
import { type Arrow, arrowStep, screenToward } from "../tiling.ts";

/** A window the shell arranged: how, and the frame it had before (what Back gives back). */
export interface Arranged {
  tile: Tile;
  own: Rect;
}

export type EventOf<Name extends CompositorEvent["event"]> = Extract<CompositorEvent, { event: Name }>;

/** Full-screen windows' own Desktops (spaces/fullscreen.ts). */
export interface FullscreenDesktopsHook {
  /** Enter or leave full screen around the window's own Desktop; `toggle` is the request and the frame after. */
  around(window: CompositorWindow, on: boolean, toggle: () => Promise<void>): Promise<void>;
  /** The Space a new window opens on; null for the one that shows. */
  spaceFor(window: Placing): Promise<number | null>;
  /** A new window opened on that Space (not the one that shows). */
  opened(space: number): Promise<void>;
}

/** A window's frame as it is about to be: where it is, at the size its app is being asked to take until it has drawn it. */
export function configuredFrame(window: CompositorWindow): Rect | null {
  return window.frame ? { ...window.frame, ...window.configuring } : null;
}

/**
 * The frame a window takes on its screen as it is now: its tile there if it is
 * tiled or filled, else moved in and shrunk if it must be; null off every screen.
 */
function fittedFrame(frame: Rect, tile: Tile | null, minSize: CompositorWindow["minSize"], outputs: readonly Output[]): Rect | null {
  const usable = usableFor(frame, outputs);
  if (!usable) return null;
  return keepLeast(tile ? tileFrame(tile, usable) : fitFrame(frame, usable), minSize, usable);
}

/** Out of full screen: the frame from before, or its tile there if it was tiled or filled. */
function frameBackFromFullscreen(before: Rect, tile: Tile | null, outputs: readonly Output[]): { frame: Rect; tile: Tile | null } {
  const usable = usableFor(before, outputs);
  return tile && usable ? { frame: tileFrame(tile, usable), tile } : { frame: before, tile: null };
}

/**
 * ⌃❖ and an arrow (tiling.ts): "back" to the window's own frame, the tile to
 * take in which usable area (remembering `own`), or null when nothing happens
 * (the last screen that way, or off every screen).
 */
export function arrowPlan(
  frame: Rect,
  arranged: Arranged | undefined,
  arrow: Arrow,
  outputs: readonly Output[],
): "back" | { tile: Tile; usable: Rect; own: Rect } | null {
  const step = arrowStep(arranged?.tile ?? null, arrow);
  if (step.kind === "restore") return "back";
  const screen = screenFor(frame, outputs);
  if (!screen) return null;
  const own = arranged?.own ?? frame;
  if (step.kind === "tile") return { tile: step.tile, usable: screen.usable, own };
  const next = screenToward(screen.frame, outputs, arrow);
  return next ? { tile: step.tile, usable: next.usable, own: carryFrame(own, screen.usable, next.usable) } : null;
}

/**
 * To the screen named `name` (the Window menu's Move to): the same place
 * there (carried from one usable area to the other, and fitted), the same
 * tile if it is tiled or filled; null when it is on that screen already, or
 * there is no such screen.
 */
export function screenPlan(
  frame: Rect,
  arranged: Arranged | undefined,
  name: string,
  outputs: readonly Output[],
): { frame: Rect; tile: Tile | null; usable: Rect; own: Rect } | null {
  const from = screenFor(frame, outputs);
  const to = outputs.find((output) => output.name === name);
  if (!from || !to || from === to) return null;
  const own = carryFrame(arranged?.own ?? frame, from.usable, to.usable);
  const tile = arranged?.tile ?? null;
  return { frame: tile ? tileFrame(tile, to.usable) : carryFrame(frame, from.usable, to.usable), tile, usable: to.usable, own };
}

/** What placing, fitting and full screen need of the Arranger (arrange.ts), as it is now. */
export interface ArrangeContext {
  compositor: Pick<Compositor, "session" | "windows" | "place" | "fullscreen">;
  desktops: FullscreenDesktopsHook | null;
  /** The Space an agent's window opens on (agents/desktop/elsewhere.ts); null for the usual one. */
  elsewhere: ((window: Placing) => Promise<number | null>) | null;
  outputs: readonly Output[];
  arranged: ReadonlyMap<number, Arranged>;
  /** The frame each full-screen window had before: given back when it leaves. */
  beforeFullscreen: Map<number, Rect>;
  frame(id: number, frame: Rect, tile: Tile | null): Promise<void>;
}

/** Out of full screen: the frame from before, or its tile there; nothing known (the shell restarted meanwhile), the compositor's own. */
function frameAfterFullscreen(context: ArrangeContext, id: number): { frame: Rect; tile: Tile | null } | null {
  const before = context.beforeFullscreen.get(id);
  context.beforeFullscreen.delete(id);
  return before ? frameBackFromFullscreen(before, context.arranged.get(id)?.tile ?? null, context.outputs) : null;
}

/** Put a window into full screen or out of it; false when there was nothing to do (not a normal window, or already so). */
export async function fullscreenWindow(context: ArrangeContext, id: number, on: boolean): Promise<boolean> {
  const window = (await context.compositor.windows()).find((candidate) => candidate.id === id);
  if (!window || window.state !== "normal" || (window.fullscreen ?? false) === on) return false;
  const before = on ? configuredFrame(window) : null;
  if (before) context.beforeFullscreen.set(id, before);
  // Leaving: the frame it goes back to is asked for at once, so nothing
  // meanwhile takes the full-screen size for its own.
  const back = on ? null : frameAfterFullscreen(context, id);
  const toggle = async () => {
    await context.compositor.fullscreen({ window: id, on });
    if (back) await context.frame(id, back.frame, back.tile);
  };
  await (context.desktops ? context.desktops.around(window, on, toggle) : toggle());
  return true;
}

/**
 * Windows that no longer fit their screen's usable area (a screen shrank,
 * or its scale grew) are moved in, and shrunk if they must; a tiled or
 * filled window takes its tile on the screen as it is now.
 */
export async function fitWindows(context: ArrangeContext): Promise<void> {
  for (const window of await context.compositor.windows()) {
    // A full-screen window fills its screen, whatever the bars leave free.
    const frame = configuredFrame(window);
    if (window.state !== "normal" || !frame || window.fullscreen) continue;
    const tile = context.arranged.get(window.id)?.tile ?? null;
    const fitted = fittedFrame(frame, tile, window.minSize, context.outputs);
    if (fitted && !sameRect(fitted, frame)) await context.frame(window.id, fitted, tile);
  }
}

/**
 * Ask for a frame (Fill also tells the app it is maximized; a tile says so for its
 * shadow, appearance/window-style.ts). Its size shows in `configuring` until the app has drawn it.
 * Never smaller than the app allows (`minSize`): a half too narrow for System Settings
 * takes its least width, grown away from the screen's edge.
 */
export async function askFrame(
  compositor: Pick<Compositor, "windows" | "frame">,
  outputs: readonly Output[],
  id: number,
  frame: Rect,
  tile: Tile | null,
): Promise<void> {
  const kind = tile === "fill" ? { maximized: true } : tile ? { tiled: true } : {};
  const least = (await compositor.windows()).find((window) => window.id === id)?.minSize;
  const usable = usableFor(frame, outputs);
  const kept = usable ? keepLeast(frame, least, usable) : frame;
  await compositor.frame({ window: id, x: kept.x, y: kept.y, width: kept.width, height: kept.height, ...kind });
}
