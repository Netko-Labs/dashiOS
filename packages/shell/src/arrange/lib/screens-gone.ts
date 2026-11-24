/**
 * A screen went (unplugged, turned off, the lid closed on it, mirroring
 * another) or came back (decisions.md D533). Every window on a screen that
 * went is moved to the nearest screen left, keeping its place there (its
 * tile there, if tiled or filled): the ones that show, the ones waiting on
 * another Desktop, the minimized and hidden ones, and the full-screen ones,
 * which stay full screen on the screen they move to. Each is remembered as
 * displaced; when its screen comes back (the same screen, by its identity),
 * it goes back where it was, unless it was moved, arranged or closed
 * meanwhile (arrange.ts forgets it then).
 */

import type { CompositorWindow } from "../../compositor/index.ts";
import { carryFrame, fitFrame, type Output, type Rect, type Tile, tileFrame } from "../../layout.ts";
import type { ArrangeContext } from "./arrange-frames.ts";

/** A window moved off a screen that went, and how to put it back. */
export interface Displaced {
  /** The screen it was on (its identity, else its name). */
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

/** The screen among `screens` that holds the frame's center, or null. */
export function holdingScreen(frame: Rect, screens: readonly Output[]): Output | null {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  return screens.find(({ frame: screen }) => cx >= screen.x && cx < screen.x + screen.width && cy >= screen.y && cy < screen.y + screen.height) ?? null;
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

/** A full-screen window to another screen: out, framed there, and in again (it covers the screen its frame is on). */
async function fullscreenAt(context: ArrangeContext, id: number, frame: Rect): Promise<void> {
  await context.compositor.fullscreen({ window: id, on: false });
  await context.frame(id, frame, null);
  await context.compositor.fullscreen({ window: id, on: true });
  context.beforeFullscreen.set(id, frame);
}

/** Move one window off `screen` (which went) to `target`, and remember where it was. */
async function moveOff(context: ScreensContext, window: CompositorWindow, at: Rect, screen: Output, target: Output): Promise<void> {
  const tile = context.arranged.get(window.id)?.tile ?? null;
  const fullscreen = window.fullscreen === true;
  const own = fullscreen ? (context.beforeFullscreen.get(window.id) ?? at) : at;
  context.displaced.set(window.id, { screen: keyOf(screen), frame: relative(own, screen.frame), tile, fullscreen });
  const carried = carryFrame(own, screen.usable, target.usable);
  if (fullscreen) await fullscreenAt(context, window.id, carried);
  else await context.frame(window.id, tile ? tileFrame(tile, target.usable) : carried, tile);
}

/** Put a displaced window back on `screen`, which came back. */
async function bringBack(context: ScreensContext, window: CompositorWindow, displaced: Displaced, screen: Output): Promise<void> {
  if ((window.fullscreen === true) !== displaced.fullscreen) return;
  const frame = fitFrame(absolute(displaced.frame, screen.frame), screen.usable);
  if (displaced.fullscreen) await fullscreenAt(context, window.id, frame);
  else await context.frame(window.id, displaced.tile ? tileFrame(displaced.tile, screen.usable) : frame, displaced.tile);
}

/**
 * The screens changed from `before` to `context.outputs`: windows of the
 * screens that came back go back, and windows of the screens that went move
 * to the nearest one left.
 */
export async function screensChanged(context: ScreensContext, before: readonly Output[]): Promise<void> {
  const after = context.outputs;
  const gone = screensMissing(before, after);
  const came = screensMissing(after, before);
  if (gone.length === 0 && came.length === 0) return;
  const windows = await context.compositor.windows();
  let back = 0;
  let moved = 0;
  for (const window of windows) {
    const displaced = context.displaced.get(window.id);
    const screen = displaced && came.find((output) => keyOf(output) === displaced.screen);
    if (!displaced || !screen) continue;
    context.displaced.delete(window.id);
    await bringBack(context, window, displaced, screen);
    back++;
  }
  for (const window of windows) {
    const at = whereItIs(window);
    const screen = at && holdingScreen(at, gone);
    const target = screen && nearestScreen(screen, after);
    if (!at || !screen || !target) continue;
    await moveOff(context, window, at, screen, target);
    moved++;
  }
  // One line per change, so a report from real hardware says what happened (decisions.md D9).
  const names = (outputs: readonly Output[]) => outputs.map((output) => output.name).join(", ") || "none";
  console.error(`dashi-shell: screens: gone ${names(gone)}, came ${names(came)}; ${moved} windows moved off, ${back} back (${context.displaced.size} away from their screen)`);
}
