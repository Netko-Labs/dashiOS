/**
 * What a view may ask of the window it is drawn in, beyond its own events:
 * where its nodes are painted now, and to scroll one of its scroll views.
 * Metal reports no scroll position and takes no scroll from the app, so
 * both go through the host's simulation channel (`simulate`), as Calendar's
 * scroll to "now" does: `layout` answers every painted node's bounds, and
 * `scroll` moves a scroll view by pixels. Whoever opens the window provides
 * it (the app kit's `runApp`, the portal's sheets); a view that finds none
 * goes without (Files' marquee, src/shared/file-browser/lib/marquee/).
 */

import type { Bounds, NativeRoot, NativeTransport } from "@mirinjs/metal";
import { createContext } from "react";

export interface WindowSurface {
  /** Where the nodes with these `testID`s are painted, in window pixels; null for one that is not painted now (or not mounted). */
  bounds(testIDs: readonly string[]): Promise<(Bounds | null)[]>;
  /** Scroll the scroll view with this `testID` down by `dy` pixels (negative: up). The host keeps it inside its range. */
  scrollBy(testID: string, dy: number): void;
}

export const Surface = createContext<WindowSurface | null>(null);

/** The surface of the window `host` draws; `root` is asked late, since the tree is mounted after the host is spawned. */
export function windowSurface(host: Pick<NativeTransport, "simulate" | "onEvent">, root: () => Pick<NativeRoot, "nodeId"> | null): WindowSurface {
  // Each `layout` asked for is answered in turn, oldest first.
  const waiting: ((nodes: ReadonlyMap<string, Bounds>) => void)[] = [];
  host.onEvent((event) => {
    if (event.type !== "layout") return;
    const painted = new Map<string, Bounds>(event.nodes.map((node) => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }]));
    waiting.shift()?.(painted);
  });
  return {
    bounds(testIDs) {
      return new Promise((resolve) => {
        waiting.push((painted) => {
          const mounted = root();
          resolve(
            testIDs.map((testID) => {
              const id = mounted?.nodeId(testID);
              return (id !== undefined && painted.get(id)) || null;
            }),
          );
        });
        host.simulate({ kind: "layout" });
      });
    },
    scrollBy(testID, dy) {
      const id = root()?.nodeId(testID);
      if (id !== undefined && dy !== 0) host.simulate({ kind: "scroll", id, dy });
    },
  };
}
