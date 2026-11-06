/**
 * Opening an app that is already open brings its window forward instead of
 * starting it again, as a click on its Dock icon does (apps.ts
 * `clickAction`): a key or a link that opens it (actions/sources/apps.ts),
 * and an agent's `launch_app` (agents/run.ts). The compositor's `focus`
 * raises the window, restores it when minimized or hidden, and switches to
 * its Space.
 */

/** What this needs of a compositor window. */
export interface FrontCandidate {
  focused: boolean;
  state: "normal" | "minimized" | "hidden";
}

/** The window to bring forward of an app's open windows: the focused one, else one on screen, else a minimized or hidden one. */
export function windowToFront<T extends FrontCandidate>(windows: readonly T[]): T | undefined {
  return windows.find((window) => window.focused) ?? windows.find((window) => window.state === "normal") ?? windows[0];
}
