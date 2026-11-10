/**
 * What a key the listing got does (keys.ts says which key is which): open,
 * go up or back, rename in place, move to the Trash, peek, clear the
 * selection; and text that is a list of files pasted, or a name to jump to.
 */

import type { FileItem } from "../../../src/shared/files/items.ts";
import { looksLikeUriList, parseUriList } from "./clipboard.ts";
import type { WindowActions } from "./context.ts";
import type { BrowserKey } from "./keys.ts";
import type { Operations } from "./operations/operations.ts";
import type { FilesStore } from "./store/store.ts";

export function runBrowserKey(
  key: BrowserKey,
  { store, ops, actions, peek }: { store: FilesStore; ops: Operations; actions: WindowActions; peek: () => void },
): void {
  const { location } = store.getSnapshot();
  const selected = store.selectedItems();
  switch (key.kind) {
    case "text": {
      if (key.text.length > 1 && looksLikeUriList(key.text) && ops.writable && location.kind === "folder") {
        void ops.transfer(parseUriList(key.text), location.path, "copy");
      } else if (key.text.trim() !== "") {
        store.typeAhead(key.text);
      }
      return;
    }
    case "open":
      return store.openSelection();
    case "enclosing":
      return store.goUp();
    case "back":
      return store.goBack();
    case "rename":
      if (selected.length === 1 && location.kind !== "trash") store.startRename((selected[0] as FileItem).path);
      return;
    case "trash":
      if (selected.length === 0) return;
      if (location.kind === "trash") return actions.confirmDelete(selected.map((item) => item.path));
      return void ops.trash(selected);
    case "peek":
      if (selected.length > 0) peek();
      return;
    case "clear":
      return store.select([]);
    case "move":
      return;
  }
}
