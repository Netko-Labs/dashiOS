/**
 * The frames arrange.ts works out, apart from the compositor it asks: the
 * screens that can be placed on, the drag zones they offer, where a new
 * window opens, and the frame a window is given back after a screen change
 * or full screen. What Arranger remembers of a window is `Arranged`.
 */

import type { Compositor, CompositorEvent, CompositorWindow, Placing, Output as Screen } from "./compositor.ts";
import {
  carryFrame,
  dragZones,
  fitFrame,
  frameUnderPointer,
  keepLeast,
  type Output,
  placeNew,
  type Rect,
  sameRect,
  screenFor,
  type Tile,
  tileFrame,
  usableFor,
} from "./layout.ts";
import { type Arrow, arrowStep, screenToward } from "./tiling.ts";

/** How long the pointer rests in a drag zone before its preview shows. */
export const DWELL_MS = 150;

/** The screens that say where they are and what is usable (src/compositor/outputs.ts). */
export function placedOutputs(screens: readonly Screen[]): Output[] {
  return screens.flatMap((screen) =>
    screen.frame && screen.usable ? [{ name: screen.name, frame: screen.frame, usable: screen.usable, scale: screen.scale }] : [],
  );
}

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

/** The drag-to-tile zones the screens offer, each with the usable area of its screen. */
export function zonesOf(outputs: readonly Output[]): Array<ReturnType<typeof dragZones>[number] & { usable: Rect }> {
  return outputs.flatMap((output) => dragZones(output).map((zone) => ({ ...zone, usable: output.usable })));
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
 * The usable area of the screen a new window opens on: the screen with the
 * pointer (`session` says where it is), else the screen of the window that
 * has the keyboard; with one screen, or nothing known, the first.
 */
export async function usableForNew(compositor: Pick<Compositor, "session" | "windows">, outputs: readonly Output[], placing: number): Promise<Rect | null> {
  const first = outputs[0]?.usable ?? null;
  if (outputs.length < 2) return first;
  const pointer = (await compositor.session().catch(() => null))?.pointer ?? null;
  // A zero-size frame at the pointer: the screen holding that point.
  if (pointer) return usableFor({ ...pointer, width: 0, height: 0 }, outputs);
  try {
    const windows = await compositor.windows();
    const target = windows.find((candidate) => candidate.focused && candidate.id !== placing && candidate.state === "normal");
    return target?.frame ? usableFor(target.frame, outputs) : first;
  } catch {
    // The session is locked: the first screen is still a place.
    return first;
  }
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

/** What placing, fitting and full screen need of the Arranger (arrange.ts), as it is now. */
export interface ArrangeContext {
  compositor: Pick<Compositor, "session" | "windows" | "place" | "fullscreen">;
  desktops: FullscreenDesktopsHook | null;
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

/** Where a new window goes, as any other; `next` counts the cascade (also for a claimed one that could not be placed its own way). */
export async function placeWindow(context: ArrangeContext, window: Placing, next: () => number): Promise<void> {
  const usable = await usableForNew(context.compositor, context.outputs, window.id);
  if (!usable) return;
  // Where new windows go, kept inside the usable area: a window taller or
  // wider than it is shrunk to fit once placed (not left under the Dock).
  // An app that asked for a spot (X11 apps do) gets it; the rest cascade.
  const { x, y } = window.position ?? placeNew(window, usable, next());
  const fitted = fitFrame({ x, y, width: window.width, height: window.height }, usable);
  // While a full-screen Desktop shows, another app's window opens on the Desktop it came from.
  const space = (await context.desktops?.spaceFor(window).catch(() => null)) ?? null;
  await context.compositor.place({ window: window.id, x: fitted.x, y: fitted.y, ...(space === null ? {} : { space }) });
  if (fitted.width !== window.width || fitted.height !== window.height) await context.frame(window.id, fitted, null);
  if (space !== null) await context.desktops?.opened(space);
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

/** Drag-to-tile: the zones last sent, and where each dragged window was as its drag began (its own frame, if the drag ends in a tile). */
export class DragTiling {
  /** The zones last sent, in order: which tile each is, on which screen. */
  zones: Array<{ tile: Tile; frame: Rect; usable: Rect }> = [];
  private readonly from = new Map<number, Rect>();

  /**
   * A drag began from `from`. Dragged out of a tile or Fill (`own` is the frame
   * it had before), the window gets its own size back under the pointer: that
   * frame, to ask for; otherwise null.
   */
  grabbed(window: number, from: Rect, own: Rect | undefined, pointer: EventOf<"window-grab">["pointer"]): Rect | null {
    const frame = own ? frameUnderPointer(from, own, pointer) : from;
    this.from.set(window, frame);
    return own ? frame : null;
  }

  forget(window: number): void {
    this.from.delete(window);
  }

  /** A drag let go in a zone: the tile and its screen, and where the drag began; null if the zone is gone (zones sent again since the drag began). */
  dropped(event: EventOf<"window-drop">): { tile: Tile; usable: Rect; from: Rect | undefined } | null {
    const zone = this.zones[event.zone];
    const from = this.from.get(event.window);
    this.from.delete(event.window);
    if (!zone || !sameRect(zone.frame, event.frame)) return null;
    return { tile: zone.tile, usable: zone.usable, from };
  }
}
