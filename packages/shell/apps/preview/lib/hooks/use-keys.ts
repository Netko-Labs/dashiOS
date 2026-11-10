/**
 * What a key does in the window (keys.ts names the keys): the arrows and
 * Page keys scroll a PDF or step through the folder, Delete asks to trash the
 * file, Escape lets go of a selection. The window's key sink hands each
 * action here.
 */

import { type DocumentView, LINE_PX } from "../document.ts";
import type { KeyAction } from "../keys.ts";

export function useKeys({ doc, step, trash }: { doc: DocumentView; step: (delta: 1 | -1) => void; trash: () => void }): (action: KeyAction) => void {
  return (action) => {
    switch (action.kind) {
      case "scroll":
        return doc.scrollBy(0, action.direction * (action.by === "line" ? 2 * LINE_PX : Math.max(40, doc.area.height - 40)));
      case "end":
        return doc.scrollToTop(action.direction < 0 ? 0 : Number.MAX_SAFE_INTEGER);
      case "step":
        return step(action.direction);
      case "trash":
        trash();
        return;
      case "unselect":
        return doc.select(null);
    }
  };
}
