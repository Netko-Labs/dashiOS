/**
 * The screen the person is working on: where the pointer is, else where the
 * focused window is. New windows, the launcher, the shortcut sheet, the
 * switcher, and notification banners open there rather than on whichever
 * screen the compositor happens to list first.
 *
 * The compositor answers `session` with `pointer` {x, y} in global logical
 * pixels (null while the session is locked); the screens' frames come from
 * `outputs` (displays.ts), in the same space. The choice itself is layout.ts's
 * `chooseScreen`, pure, so placing a window (arrange/) makes it the same way.
 */

import type { Compositor, Frame, Output } from "./compositor/index.ts";
import { screensOf } from "./displays.ts";
import { chooseScreen, screenAt } from "./layout.ts";

/** A screen's name and where it sits, in the space the pointer is reported in. */
export interface Placed {
  name: string;
  frame: Frame;
}

/** The screens that say where they are. */
export function placedScreens(outputs: readonly Output[]): Placed[] {
  return screensOf(outputs).flatMap((screen) => (screen.frame ? [{ name: screen.name, frame: screen.frame }] : []));
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
