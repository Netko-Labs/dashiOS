/**
 * Files' menus in Dashi's menu bar (the kit's useAppMenus): File, Edit, View,
 * and Go. What can be chosen follows the selection and where the window is.
 * The ❖ shortcuts are real: the shell matches a chord against the enabled rows
 * (app-menus/shortcut.ts). Enclosing Folder (❖↑) has none: the keymap keeps it.
 */

import type { MenuSpec } from "../kit/index.ts";
import type { WindowActions } from "./context.ts";
import { favorites } from "./location.ts";
import { mayOpen } from "./open.ts";
import type { Operations } from "./operations.ts";
import type { FilesState, FilesStore } from "./store.ts";

const SEPARATOR = { type: "separator" } as const;
const SORTS = [["name", "Name"], ["modified", "Date Modified"], ["size", "Size"], ["kind", "Kind"]] as const;

export function menuSpecs(state: FilesState, store: FilesStore, ops: Operations): MenuSpec[] {
  const selected = store.selectedItems();
  const one = selected.length === 1;
  const any = selected.length > 0;
  const trash = state.location.kind === "trash";
  const writable = ops.writable;
  const places = favorites(store.env.dirs, store.env.home);
  return [
    {
      id: "file",
      items: [
        { id: "new-folder", shortcut: "⇧❖N", label: "New Folder…", enabled: writable },
        { id: "open", shortcut: "❖O", label: "Open", enabled: any && selected.every((item) => mayOpen(item).ok) },
        { id: "open-with", label: "Open With…", enabled: one && selected[0]?.kind === "file" },
        { id: "info", shortcut: "❖I", label: "Get Info", enabled: one },
        SEPARATOR,
        ...(trash
          ? [
              { id: "put-back", label: "Put Back", enabled: any },
              { id: "delete-now", label: "Delete Immediately…", enabled: any },
              { id: "empty-trash", label: "Empty Trash…", enabled: state.items.length > 0 },
            ]
          : [
              { id: "rename", label: "Rename…", enabled: one && writable },
              { id: "duplicate", shortcut: "❖D", label: "Duplicate", enabled: any && writable },
              { id: "compress", label: "Compress", enabled: any && ops.canCompress },
              SEPARATOR,
              { id: "trash", label: "Move to Trash", enabled: any },
            ]),
      ],
    },
    {
      id: "edit",
      items: [
        { id: "cut", shortcut: "❖X", label: "Cut", enabled: any && !trash },
        { id: "copy", shortcut: "❖C", label: "Copy", enabled: any },
        { id: "paste", shortcut: "❖V", label: "Paste", enabled: writable },
        SEPARATOR,
        { id: "select-all", shortcut: "❖A", label: "Select All", enabled: true },
      ],
    },
    {
      id: "view",
      items: [
        { id: "view-icons", shortcut: "❖1", label: "as Icons", checked: state.view === "icons" },
        { id: "view-list", shortcut: "❖2", label: "as List", checked: state.view === "list" },
        SEPARATOR,
        { id: "hidden", shortcut: "⇧❖.", label: "Show Hidden Files", checked: state.showHidden },
        SEPARATOR,
        ...SORTS.map(([key, title]) => ({ id: `sort-${key}`, label: `Sort by ${title}`, checked: state.sort.key === key })),
        SEPARATOR,
        { id: "refresh", shortcut: "❖R", label: "Refresh" },
      ],
    },
    {
      id: "go",
      title: "Go",
      items: [
        { id: "back", shortcut: "❖[", label: "Back", enabled: state.canBack },
        { id: "forward", shortcut: "❖]", label: "Forward", enabled: state.canForward },
        { id: "up", label: "Enclosing Folder", enabled: state.location.kind !== "folder" || state.location.path !== "/" },
        SEPARATOR,
        ...places.map((place) => ({ id: `go:${place.id}`, label: place.name })),
        { id: "go-trash", label: "Trash" },
        SEPARATOR,
        { id: "go-folder", shortcut: "⇧❖G", label: "Go to Folder…" },
      ],
    },
  ];
}

/** What a chosen menu item does. Unknown ids are ignored: the shell hands back only ids that were published, but an id is still untrusted text. */
export function chooseMenu(id: string, store: FilesStore, ops: Operations, actions: WindowActions): void {
  const selected = store.selectedItems();
  const first = selected[0];
  switch (id) {
    case "new-folder":
      return actions.newFolder();
    case "open":
      return store.openSelection();
    case "open-with":
      return first && actions.openWith(first.path);
    case "info":
      return first && actions.info(first.path);
    case "rename":
      return first && actions.rename(first.path);
    case "duplicate":
      return void ops.duplicateSelection();
    case "compress":
      return void ops.compress();
    case "trash":
      return void ops.trash();
    case "put-back":
      return void ops.putBack();
    case "delete-now":
      return actions.confirmDelete(selected.map((item) => item.path));
    case "empty-trash":
      return actions.confirmEmptyTrash();
    case "cut":
      return ops.cut();
    case "copy":
      return ops.copy();
    case "paste":
      return void ops.paste();
    case "select-all":
      return store.selectAll();
    case "view-icons":
      return store.setView("icons");
    case "view-list":
      return store.setView("list");
    case "hidden":
      return store.toggleHidden();
    case "refresh":
      return store.reload();
    case "back":
      return store.goBack();
    case "forward":
      return store.goForward();
    case "up":
      return store.goUp();
    case "go-trash":
      return store.go({ kind: "trash" });
    case "go-folder":
      return actions.goToFolder();
    default:
      break;
  }
  if (id.startsWith("sort-")) {
    const key = id.slice("sort-".length);
    if (SORTS.some(([name]) => name === key)) store.setSort({ key, ascending: key === "name" || key === "kind" });
    return;
  }
  if (id.startsWith("go:")) {
    const place = favorites(store.env.dirs, store.env.home).find((each) => each.id === id.slice(3));
    if (place) store.go(place.location);
  }
}

