/** A view that takes dropped files (a folder tile or row, a sidebar place, the folder's background): its `onDrop`, and whether files are over it. */

import type { DropInfo } from "@mirinjs/metal";
import { useState } from "react";
import { useFiles } from "./context.ts";

export interface DropTarget {
  /** Spread on the view; empty when `dest` takes nothing. */
  props: { onDrop?: (event: DropInfo) => void };
  /** Files are over it now, to draw it highlighted. */
  over: boolean;
}

/** `dest`: the folder files dropped here go into, the Trash, or null for nowhere. A chooser (no ops) takes none. */
export function useDropTarget(dest: string | "trash" | null): DropTarget {
  const { ops, actions } = useFiles();
  const [over, setOver] = useState(false);
  if (dest === null || ops === null) return { props: {}, over: false };
  return {
    over,
    props: {
      onDrop: (event) => {
        if (event.phase === "enter") setOver(true);
        else if (event.phase === "leave") setOver(false);
        else if (event.phase === "drop") {
          setOver(false);
          void ops.drop(event.paths, dest, event);
          actions.refocus();
        }
      },
    },
  };
}
