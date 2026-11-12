/**
 * The screen the person is working on: where the pointer is, else where the
 * focused window is. New windows, the launcher, the shortcut sheet, the
 * switcher, and notification banners open there rather than on whichever
 * screen the compositor happens to list first.
 *
 * The compositor answers `session` with `pointer` {x, y} in global logical
 * pixels (null while the session is locked); the screens' frames come from
 * `outputs` (displays.ts), in the same space.
 */

import type { Compositor, Frame, Output, Point } from "./compositor/index.ts";
import { screensOf } from "./displays.ts";

/** A screen's name and where it sits, in the space the pointer is reported in. */
export interface Placed {
  name: string;
  frame: Frame;
}

/** The screens that say where they are. */
export function placedScreens(outputs: readonly Output[]): Placed[] {
  return screensOf(outputs).flatMap((screen) => (screen.frame ? [{ name: screen.name, frame: screen.frame }] : []));
}

/** The screen holding `point` (its left and top edges belong to it, its right and bottom do not); null when none does. */
export function screenAt(point: Point, screens: readonly Placed[]): string | null {
  const holding = screens.find(({ frame }) => point.x >= frame.x && point.x < frame.x + frame.width && point.y >= frame.y && point.y < frame.y + frame.height);
  return holding?.name ?? null;
}

/**
 * Where things should open: the pointer's screen, else the screen holding
 * the center of the focused window, else `undefined` (the compositor's
 * choice). With one screen there is nothing to choose, so `undefined` too.
 */
export function chooseScreen(screens: readonly Placed[], pointer: Point | null, focused: Frame | null): string | undefined {
  if (screens.length < 2) return undefined;
  if (pointer) {
    const found = screenAt(pointer, screens);
    if (found) return found;
  }
  if (focused) return screenAt({ x: focused.x + focused.width / 2, y: focused.y + focused.height / 2 }, screens) ?? undefined;
  return undefined;
}

/** The screen the person is on now (see `chooseScreen`); `undefined` when the compositor can't say. */
export async function activeScreen(compositor: Pick<Compositor, "outputs" | "session" | "windows">): Promise<string | undefined> {
  try {
    const [outputs, session] = await Promise.all([compositor.outputs(), compositor.session().catch(() => null)]);
    const screens = placedScreens(outputs);
    const pointer = session?.pointer ?? null;
    // The windows are only asked when the pointer didn't say, and fail while locked.
    const focused =
      pointer && screenAt(pointer, screens) !== null
        ? null
        : await compositor
            .windows()
            .then((windows) => windows.find((window) => window.focused && window.state === "normal")?.frame ?? null)
            .catch(() => null);
    return chooseScreen(screens, pointer, focused);
  } catch {
    return undefined;
  }
}
