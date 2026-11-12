/**
 * Files dropped on Preview's window: the one it opens. Preview shows one
 * file per window, so of several it takes the first it can show by its name
 * (an image or a PDF), else the first, and the viewer says why that one
 * can't be shown. Nothing dropped (an empty list) opens nothing.
 */

import type { DropInfo } from "@mirinjs/metal";
import { useState } from "react";
import { kindOf } from "../../../src/shared/files/kinds.ts";

export function droppedFile(paths: readonly string[]): string | null {
  return paths.find((path) => kindOf(path) !== null) ?? paths[0] ?? null;
}

export interface DropArea {
  /** Spread on the view that takes the drop. */
  onDrop: (event: DropInfo) => void;
  /** Files are over it now: draw the area as the target. */
  over: boolean;
}

/** The whole window's drop target: `open` gets the file a drop brings. */
export function useDropArea(open: (path: string) => void): DropArea {
  const [over, setOver] = useState(false);
  return {
    over,
    onDrop: (event) => {
      if (event.phase === "enter" || event.phase === "over") setOver(true);
      else if (event.phase === "leave") setOver(false);
      else {
        setOver(false);
        const path = droppedFile(event.paths);
        if (path) open(path);
      }
    },
  };
}
