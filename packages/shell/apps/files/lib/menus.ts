/** The context menus' contents, decided from the selection and where the window is looking, in groups (PA-9); each row shows its menu-bar key from the one table (UI-17). */

import { MENU_SEPARATOR, type MenuEntry } from "@dashi/ui";
import type { WindowActions } from "../../../src/shared/file-browser/context.ts";
import type { Operations } from "../../../src/shared/file-browser/operations.ts";
import type { FilesStore } from "../../../src/shared/file-browser/store.ts";
import { type FileItem, mayOpen } from "../../../src/shared/files/index.ts";
import { KEYS } from "./shortcuts.ts";

interface Deps {
  store: FilesStore;
  ops: Operations;
  actions: WindowActions;
}

/** The menu for a right-click on `items` (the selection). */
export function itemMenu({ store, ops, actions }: Deps, items: readonly FileItem[]): MenuEntry[] {
  const state = store.getSnapshot();
  const only = items.length === 1 ? (items[0] as FileItem) : null;
  const inTrash = state.location.kind === "trash" || only?.path.startsWith(`${store.env.trash.files}/`);
  const paths = items.map((item) => item.path);
  if (inTrash) {
    return [
      ...(state.location.kind === "trash" ? [{ label: "Put Back", onPress: () => void ops.putBack(items) }] : []),
      { label: "Open", keys: KEYS.open, onPress: () => store.openSelection(), disabled: only === null || !mayOpen(only).ok },
      { label: "Get Info", keys: KEYS.info, onPress: () => only && actions.info(only.path), disabled: only === null },
      MENU_SEPARATOR,
      ...(state.location.kind === "trash" ? [{ label: "Delete Immediately…", onPress: () => actions.confirmDelete(paths) }] : []),
    ];
  }
  const writable = ops.writable;
  const fromList = state.found !== null || state.location.kind === "recents";
  return [
    { label: "Open", keys: KEYS.open, onPress: () => store.openSelection(), disabled: items.some((item) => !mayOpen(item).ok) },
    { label: "Open With…", onPress: () => only && actions.openWith(only.path), disabled: only === null || only.kind !== "file" || !mayOpen(only).ok },
    ...(fromList ? [{ label: "Show in Folder", onPress: () => only && store.reveal(only), disabled: only === null }] : []),
    MENU_SEPARATOR,
    { label: "Get Info", keys: KEYS.info, onPress: () => only && actions.info(only.path), disabled: only === null },
    { label: "Rename", onPress: () => only && actions.rename(only.path), disabled: only === null || (!writable && !fromList) },
    { label: "Duplicate", keys: KEYS.duplicate, onPress: () => void ops.duplicateSelection(), disabled: !writable && !fromList },
    // Without zip or bsdtar there is no Compress, rather than a row that names a package.
    ...(ops.canCompress ? [{ label: "Compress", onPress: () => void ops.compress(items) }] : []),
    MENU_SEPARATOR,
    { label: "Cut", keys: KEYS.cut, onPress: () => ops.cut(items) },
    { label: "Copy", keys: KEYS.copy, onPress: () => ops.copy(items) },
    { label: "Paste", keys: KEYS.paste, onPress: () => void ops.paste(), disabled: !writable },
    MENU_SEPARATOR,
    { label: "Move to Trash", keys: KEYS.trash, onPress: () => void ops.trash(items) },
  ];
}

/** The menu for a right-click on empty space. */
export function backgroundMenu({ store, ops, actions }: Deps): MenuEntry[] {
  const state = store.getSnapshot();
  if (state.location.kind === "trash") {
    return [
      { label: "Empty Trash…", onPress: () => actions.confirmEmptyTrash(), disabled: state.items.length === 0 },
      MENU_SEPARATOR,
      { label: "Select All", keys: KEYS.selectAll, onPress: () => store.selectAll() },
    ];
  }
  const writable = ops.writable;
  return [
    { label: "New Folder", keys: KEYS.newFolder, onPress: () => actions.newFolder(), disabled: !writable },
    MENU_SEPARATOR,
    { label: "Paste", keys: KEYS.paste, onPress: () => void ops.paste(), disabled: !writable },
    { label: "Select All", keys: KEYS.selectAll, onPress: () => store.selectAll() },
    MENU_SEPARATOR,
    { label: "Show Hidden Files", keys: KEYS.hidden, onPress: () => store.toggleHidden(), checked: state.showHidden },
    { label: "View as Icons", keys: KEYS.viewIcons, onPress: () => store.setView("icons"), checked: state.view === "icons" },
    { label: "View as List", keys: KEYS.viewList, onPress: () => store.setView("list"), checked: state.view === "list" },
    MENU_SEPARATOR,
    { label: "Refresh", keys: KEYS.refresh, onPress: () => store.reload() },
  ];
}

/** The toolbar's "…" menu: things about the window rather than an item. */
export function actionMenu({ store, ops, actions }: Deps): MenuEntry[] {
  const state = store.getSnapshot();
  const writable = ops.writable;
  const sorts = [
    ["name", "Name"],
    ["modified", "Date Modified"],
    ["size", "Size"],
    ["kind", "Kind"],
  ] as const;
  return [
    { label: "New Folder", keys: KEYS.newFolder, onPress: () => actions.newFolder(), disabled: !writable },
    { label: "Go to Folder…", keys: KEYS.goToFolder, onPress: () => actions.goToFolder() },
    MENU_SEPARATOR,
    { label: "Paste", keys: KEYS.paste, onPress: () => void ops.paste(), disabled: !writable },
    { label: "Select All", keys: KEYS.selectAll, onPress: () => store.selectAll() },
    MENU_SEPARATOR,
    { label: "Show Hidden Files", keys: KEYS.hidden, onPress: () => store.toggleHidden(), checked: state.showHidden },
    MENU_SEPARATOR,
    ...sorts.map(([key, title]) => ({
      label: `Sort by ${title}`,
      checked: state.sort.key === key,
      onPress: () => store.setSort({ key, ascending: key === state.sort.key ? state.sort.ascending : key === "name" || key === "kind" }),
    })),
    { label: "Reverse Order", checked: !(store.effectiveSort() ?? state.sort).ascending, onPress: () => store.reverseSort() },
    ...(state.location.kind === "trash"
      ? [MENU_SEPARATOR, { label: "Empty Trash…", onPress: () => actions.confirmEmptyTrash(), disabled: state.items.length === 0 }]
      : []),
  ];
}
