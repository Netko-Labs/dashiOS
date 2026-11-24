/**
 * The screens changed: one went (unplugged, turned off, the lid closed on it,
 * mirroring another), came back, moved in the arrangement, or changed its
 * size or scale (decisions.md D533, D537). Every window follows its screen,
 * on every Desktop, shown or not: the ones that show, the ones waiting on
 * another Desktop, the minimized and hidden ones, and the full-screen ones.
 *
 *   - A window on a screen that went moves to the nearest screen left, at
 *     its place there (its tile there, if tiled or filled; full screen there,
 *     if it was), and is remembered as displaced: when its screen comes back
 *     (the same screen, by its identity), it goes back where it was.
 *   - A window on a screen that is still here goes where the screen went
 *     (the same place from its top left), its tile on it as it is now, full
 *     screen over it as it is now, and inside what the bar and Dock leave
 *     free. One the screen had no room for (it shrank, or its scale grew) is
 *     shrunk and remembered as displaced too: it gets its own size back when
 *     there is room again, and its memory (remember.ts) keeps that size, not
 *     the one a screen still settling gave it.
 *
 * A window moved, arranged or closed meanwhile is no longer displaced
 * (arrange.ts forgets it then): it stays where the person put it.
 */

import type { CompositorWindow } from "../../compositor/index.ts";
import { fitFrame, keepLeast, type Output, type Rect, sameRect, screenFor, type Tile, tileFrame } from "../../layout.ts";
import type { ArrangeContext } from "./arrange-frames.ts";

/** A window not where it wants to be (its screen went, or had no room for it), and where that is. */
export interface Displaced {
  /** The screen it wants to be on (its identity, else its name). */
  screen: string;
  /** Its frame there, from the screen's top left (a full-screen window's frame from before). */
  frame: Rect;
  tile: Tile | null;
  fullscreen: boolean;
}

/** What screen changes need beyond the arranging context: the displaced windows, kept by the arranger. */
export interface ScreensContext extends ArrangeContext {
  displaced: Map<number, Displaced>;
}

const keyOf = (output: Output): string => output.identity ?? output.name;

/** The screens in `from` that are not in `to`, by identity. */
export function screensMissing(from: readonly Output[], to: readonly Output[]): Output[] {
  const kept = new Set(to.map(keyOf));
  return from.filter((output) => !kept.has(keyOf(output)));
}

/** Where a window is or waits: on screen, on another Desktop, or where it comes back from the Dock; at the size it is being asked to take. */
export function whereItIs(window: CompositorWindow): Rect | null {
  const frame = window.frame ?? window.away ?? window.parked ?? null;
  return frame ? { ...frame, ...window.configuring } : null;
}

/** Of `screens`, the one whose center is nearest `gone`'s. */
export function nearestScreen(gone: Output, screens: readonly Output[]): Output | null {
  const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const from = center(gone.frame);
  const distance = (screen: Output) => Math.hypot(center(screen.frame).x - from.x, center(screen.frame).y - from.y);
  return screens.reduce<Output | null>((nearest, screen) => (nearest === null || distance(screen) < distance(nearest) ? screen : nearest), null);
}

const relative = (frame: Rect, screen: Rect): Rect => ({ ...frame, x: frame.x - screen.x, y: frame.y - screen.y });
const absolute = (frame: Rect, screen: Rect): Rect => ({ ...frame, x: frame.x + screen.x, y: frame.y + screen.y });
/** The same place from the top left of a screen that moved from `from` to `to`. */
const along = (frame: Rect, from: Rect, to: Rect): Rect => absolute(relative(frame, from), to);

/** A full-screen window to a screen as it is now: out, framed there, and in again (it covers the screen its frame is on). */
async function fullscreenAt(context: ArrangeContext, id: number, frame: Rect): Promise<void> {
  await context.compositor.fullscreen({ window: id, on: false });
  await context.frame(id, frame, null);
  await context.compositor.fullscreen({ window: id, on: true });
  context.beforeFullscreen.set(id, frame);
}

/** Ask for `frame` unless the window is there already. */
async function frameIfMoved(context: ArrangeContext, window: CompositorWindow, at: Rect, frame: Rect, tile: Tile | null): Promise<void> {
  if (!sameRect(frame, at)) await context.frame(window.id, frame, tile);
}

/** Move one window off `screen` (which went) to `target`, and remember where it was. */
async function moveOff(context: ScreensContext, window: CompositorWindow, at: Rect, screen: Output, target: Output): Promise<void> {
  const tile = context.arranged.get(window.id)?.tile ?? null;
  const fullscreen = window.fullscreen === true;
  const own = fullscreen ? (context.beforeFullscreen.get(window.id) ?? at) : at;
  const wanted = context.displaced.get(window.id);
  // Already displaced (from a screen that went before this, or one that had no room for it): that is still where it wants to be.
  if (!wanted) context.displaced.set(window.id, { screen: keyOf(screen), frame: relative(own, screen.frame), tile, fullscreen });
  const carried = fitFrame(along(own, screen.usable, target.usable), target.usable);
  if (fullscreen) await fullscreenAt(context, window.id, carried);
  else await context.frame(window.id, tile ? tileFrame(tile, target.usable) : carried, tile);
}

/** Put a displaced window where it wants to be on `screen`, as far as the screen has room; displaced no longer once it is all there. */
async function putBack(context: ScreensContext, window: CompositorWindow, at: Rect, displaced: Displaced, screen: Output): Promise<void> {
  const wanted = absolute(displaced.frame, screen.frame);
  const fitted = keepLeast(fitFrame(wanted, screen.usable), window.minSize, screen.usable);
  if (displaced.tile || displaced.fullscreen || sameRect(fitted, wanted)) context.displaced.delete(window.id);
  if (displaced.fullscreen) {
    if (!sameRect(at, screen.frame)) await fullscreenAt(context, window.id, fitted);
  } else await frameIfMoved(context, window, at, displaced.tile ? tileFrame(displaced.tile, screen.usable) : fitted, displaced.tile);
}

/** A window on a screen that is still here, `was` before and `now` after: where the screen went, as it is now. */
async function follow(context: ScreensContext, window: CompositorWindow, at: Rect, was: Output, now: Output): Promise<void> {
  if (window.fullscreen === true) {
    if (sameRect(was.frame, now.frame)) return;
    const own = context.beforeFullscreen.get(window.id) ?? at;
    return fullscreenAt(context, window.id, fitFrame(along(own, was.frame, now.frame), now.usable));
  }
  const tile = context.arranged.get(window.id)?.tile ?? null;
  if (tile) return frameIfMoved(context, window, at, tileFrame(tile, now.usable), tile);
  const moved = along(at, was.frame, now.frame);
  const fitted = keepLeast(fitFrame(moved, now.usable), window.minSize, now.usable);
  // No room for it here as it is: it gets its size back when there is.
  if (!sameRect(fitted, moved) && !context.displaced.has(window.id)) {
    context.displaced.set(window.id, { screen: keyOf(now), frame: relative(moved, now.frame), tile: null, fullscreen: false });
  }
  await frameIfMoved(context, window, at, fitted, null);
}

/** What happened to one window: moved off a screen that went, back on its own, or neither. */
type Outcome = "off" | "back" | null;

async function oneWindow(context: ScreensContext, window: CompositorWindow, before: readonly Output[], came: readonly Output[]): Promise<Outcome> {
  const at = whereItIs(window);
  if (!at) return null;
  const after = context.outputs;
  const displaced = context.displaced.get(window.id);
  const home = displaced && after.find((output) => keyOf(output) === displaced.screen);
  if (displaced && home) {
    if ((window.fullscreen === true) === displaced.fullscreen) {
      await putBack(context, window, at, displaced, home);
      return came.includes(home) ? "back" : null;
    }
    // In or out of full screen meanwhile: it stays as it is now.
    context.displaced.delete(window.id);
  }
  // Its screen as the frames were laid out (on the first look, the screens as they are).
  const was = screenFor(at, before.length > 0 ? before : after);
  if (!was) return null;
  const now = after.find((output) => keyOf(output) === keyOf(was));
  if (now) {
    await follow(context, window, at, was, now);
    return null;
  }
  const target = nearestScreen(was, after);
  if (!target) return null;
  await moveOff(context, window, at, was, target);
  return "off";
}

/**
 * The screens changed from `before` to `context.outputs`: every window
 * follows its screen, goes back to the screen it wants to be on, or leaves
 * a screen that went for the nearest one left.
 */
export async function screensChanged(context: ScreensContext, before: readonly Output[]): Promise<void> {
  const gone = screensMissing(before, context.outputs);
  const came = before.length > 0 ? screensMissing(context.outputs, before) : [];
  let back = 0;
  let moved = 0;
  for (const window of await context.compositor.windows()) {
    const outcome = await oneWindow(context, window, before, came);
    if (outcome === "back") back++;
    if (outcome === "off") moved++;
  }
  if (gone.length === 0 && came.length === 0) return;
  // One line per change, so a report from real hardware says what happened (decisions.md D9).
  const names = (outputs: readonly Output[]) => outputs.map((output) => output.name).join(", ") || "none";
  console.error(
    `dashi-shell: screens: gone ${names(gone)}, came ${names(came)}; ${moved} windows moved off, ${back} back (${context.displaced.size} away from their screen)`,
  );
}
