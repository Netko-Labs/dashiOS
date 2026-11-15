/**
 * What a view may know of the window it is drawn in, beyond its own events:
 * whether its Metal host says where a scroll view stands and takes a scroll
 * from the app (mirin's `onScroll` and `ViewHandle`; a host's `protocol`
 * line says `scroll`). On a host from before that, `onScroll` never comes
 * and `scrollTo` does nothing, so a view that needs them goes without
 * (Files' marquee and the keyboard's reveal, src/shared/file-browser/lib/marquee/).
 * Whoever opens the window provides it (the app kit's `runApp`, the portal's sheets).
 */

import type { NativeTransport } from "@mirinjs/metal";
import { createContext } from "react";

export interface WindowSurface {
  /** Whether the host reports scroll offsets and scrolls when asked. */
  scrolls(): boolean;
}

export const Surface = createContext<WindowSurface | null>(null);

/** The surface of the window `host` draws. A host says its `protocol` once, and to a listener that comes later too. */
export function windowSurface(host: Pick<NativeTransport, "onEvent">): WindowSurface {
  let scrolls = false;
  host.onEvent((event) => {
    if (event.type === "protocol") scrolls = event.scroll === true;
  });
  return { scrolls: () => scrolls };
}
