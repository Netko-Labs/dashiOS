/**
 * Whether the app's window can be seen (PA-15): the Metal host says when the
 * compositor suspends it (minimized, hidden, or on a Desktop that isn't
 * shown) and when it is seen again, so an app that polls can stop while no
 * one is looking. A window opens seen; only changes are reported.
 */

import type { NativeTransport } from "@mirinjs/metal";

/** Call `listener` with `false` when the window goes out of sight and `true` when it is seen again. */
export function onWindowVisibility(host: Pick<NativeTransport, "onEvent">, listener: (visible: boolean) => void): void {
  let visible = true;
  host.onEvent((event) => {
    if (event.type !== "visibility" || event.visible === visible) return;
    visible = event.visible;
    listener(visible);
  });
}
