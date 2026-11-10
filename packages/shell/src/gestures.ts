/**
 * The desktop's touchpad gestures, macOS-style: three fingers up opens
 * Mission Control, three fingers down closes it, and three fingers sideways
 * move to the next Space, the windows following the fingers
 * (spaces/swipe.ts). The shell claims three-finger swipes from dashi-comp
 * (IPC `gestures {swipe: [3]}`), so apps never see them; every other gesture
 * (two-finger scrolling, pinching, four-finger swipes) still goes to the app
 * under the pointer.
 */

import type { Compositor, CompositorEvent } from "./compositor.ts";
import type { SpacesState } from "./spaces/model.ts";
import { type SwipeStep, SwipeTracker } from "./spaces/swipe.ts";

export interface GestureActions {
  /** Mission Control: open it (up) or close it (down). */
  overview(open: boolean): void;
  /** Spaces (spaces/controller.ts): a sideways swipe holds the switch where the fingers are, then lets it finish or go back. */
  spaces?: {
    getSnapshot(): SpacesState;
    hold(target: number, progress: number): void;
    release(space: number): Promise<void>;
  };
}

/** Claims three-finger swipes and carries them out; returns a stop function. */
export function startGestures(compositor: Pick<Compositor, "gestures" | "on">, actions: GestureActions): () => void {
  compositor.gestures({ swipe: [3] }).catch((error) => console.error("dashi-shell: touchpad gestures are off:", error));
  const tracker = new SwipeTracker();
  const stop = compositor.on((event: CompositorEvent) => {
    if (event.event !== "gesture") return;
    const spaces = actions.spaces;
    let step: SwipeStep = { kind: "none" };
    if (event.phase === "begin") tracker.begin(spaces?.getSnapshot() ?? { count: 1, current: 0 });
    else if (event.phase === "update") step = tracker.update(event.dx, event.dy);
    else step = tracker.end(event.cancelled);
    switch (step.kind) {
      case "overview":
        actions.overview(step.open);
        break;
      case "space-hold":
        spaces?.hold(step.target, step.progress);
        break;
      case "space-finish":
        void spaces?.release(step.target);
        break;
      case "space-back":
        void spaces?.release(step.origin);
        break;
    }
  });
  return () => {
    stop();
    compositor.gestures({ swipe: [] }).catch(() => {});
  };
}
