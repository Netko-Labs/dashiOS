/** The context menus' contents, decided from the selection and where the window is looking, in groups (PA-9). */

import { MENU_SEPARATOR, type MenuEntry } from "@dashi/ui";
import type { WindowActions } from "./context.ts";
import { formatCount } from "./format.ts";
import type { FileItem } from "./items.ts";
import { mayOpen } from "./open.ts";
import type { Operations } from "./operations.ts";
import type { FilesStore } from "./store.ts";

interface Deps {
  store: FilesStore;
  ops: Operations;
  actions: WindowActions;
}

const noun = (items: readonly FileItem[]): string => (items.length === 1 ? "Item" : formatCount(items.length));

/** The menu for a right-click on `items` (the selection). */
export function itemMenu({ store, ops, actions }: Deps, items: readonly FileItem[]): MenuEntry[] {
  const state = store.getSnapshot();
  const only = items.length === 1 ? (items[0] as FileItem) : null;
  const inTrash = state.location.kind === "trash" || only?.path.startsWith(`${store.env.trash.files}/`);
  const paths = items.map((item) => item.path);
  if (inTrash) {
    return [
      ...(state.location.kind === "trash" ? [{ label: "Put Back", onPress: () => void ops.putBack(items) }] : []),
      { label: "Open", onPress: () => store.openSelection(), disabled: only === null || !mayOpen(only).ok },
      { label: "Get Info", onPress: () => only && actions.info(only.path), disabled: only === null },
      MENU_SEPARATOR,
      ...(state.location.kind === "trash" ? [{ label: "Delete Immediately…", onPress: () => actions.confirmDelete(paths) }] : []),
    ];
  }
  const writable = ops.writable;
  const fromList = state.found !== null || state.location.kind === "recents";
  return [
    { label: "Open", onPress: () => store.openSelection(), disabled: items.some((item) => !mayOpen(item).ok) },
    { label: "Open With…", onPress: () => only && actions.openWith(only.path), disabled: only === null || only.kind !== "file" || !mayOpen(only).ok },
    ...(fromList ? [{ label: "Show in Folder", onPress: () => only && store.reveal(only), disabled: only === null }] : []),
    MENU_SEPARATOR,
    { label: "Get Info", onPress: () => only && actions.info(only.path), disabled: only === null },
    { label: "Rename…", onPress: () => only && actions.rename(only.path), disabled: only === null || (!writable && !fromList) },
    { label: "Duplicate", onPress: () => void ops.duplicateSelection(), disabled: !writable && !fromList },
    { label: ops.canCompress ? "Compress" : "Compress (needs zip)", onPress: () => void ops.compress(items), disabled: !ops.canCompress },
    MENU_SEPARATOR,
    { label: "Copy", onPress: () => ops.copy(items) },
    { label: "Cut", onPress: () => ops.cut(items) },
    MENU_SEPARATOR,
    { label: `Move ${noun(items)} to Trash`, onPress: () => void ops.trash(items) },
  ];
}

/** The menu for a right-click on empty space. */
export function backgroundMenu({ store, ops, actions }: Deps): MenuEntry[] {
  const state = store.getSnapshot();
  if (state.location.kind === "trash") {
    return [
      { label: "Empty Trash…", onPress: () => actions.confirmEmptyTrash(), disabled: state.items.length === 0 },
      MENU_SEPARATOR,
      { label: "Select All", onPress: () => store.selectAll() },
    ];
  }
  const writable = ops.writable;
  return [
    { label: "New Folder…", onPress: () => actions.newFolder(), disabled: !writable },
    MENU_SEPARATOR,
    { label: "Paste", onPress: () => void ops.paste(), disabled: !writable },
    { label: "Select All", onPress: () => store.selectAll() },
    MENU_SEPARATOR,
    { label: "Show Hidden Files", onPress: () => store.toggleHidden(), checked: state.showHidden },
    { label: "View as Icons", onPress: () => store.setView("icons"), checked: state.view === "icons" },
    { label: "View as List", onPress: () => store.setView("list"), checked: state.view === "list" },
    MENU_SEPARATOR,
    { label: "Refresh", onPress: () => store.reload() },
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
    { label: "New Folder…", onPress: () => actions.newFolder(), disabled: !writable },
    { label: "Go to Folder…", onPress: () => actions.goToFolder() },
    MENU_SEPARATOR,
    { label: "Paste", onPress: () => void ops.paste(), disabled: !writable },
    { label: "Select All", onPress: () => store.selectAll() },
    MENU_SEPARATOR,
    { label: "Show Hidden Files", onPress: () => store.toggleHidden(), checked: state.showHidden },
    MENU_SEPARATOR,
    ...sorts.map(([key, title]) => ({
      label: `Sort by ${title}`,
      checked: state.sort.key === key,
      onPress: () => store.setSort({ key, ascending: key === "name" || key === "kind" }),
    })),
    ...(state.location.kind === "trash"
      ? [MENU_SEPARATOR, { label: "Empty Trash…", onPress: () => actions.confirmEmptyTrash(), disabled: state.items.length === 0 }]
      : []),
  ];
}
