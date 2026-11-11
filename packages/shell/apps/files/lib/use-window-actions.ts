/**
 * What the rest of the window asks of the window itself (context.ts): open a
 * sheet or a menu, rename in place, go to a folder. Also the menu bar's File,
 * Edit, View and Go, which are Files' own while it is in front, and Get Info
 * for the item `--info` names.
 */

import { useUndo } from "@dashi/ui";
import { useEffect, useMemo, useRef } from "react";
import type { WindowActions } from "../../../src/shared/file-browser/context.ts";
import type { Operations } from "../../../src/shared/file-browser/operations.ts";
import type { FilesStore } from "../../../src/shared/file-browser/store.ts";
import type { FilesState } from "../../../src/shared/file-browser/store-state.ts";
import type { FileItem } from "../../../src/shared/files/index.ts";
import { useAppMenus } from "../../kit/index.ts";
import { chooseMenu, menuSpecs } from "./appmenus.ts";
import { editText } from "./omnibox/omnibox.tsx";
import type { Overlays } from "./use-overlays.ts";

export function useWindowActions({
  store,
  ops,
  state,
  overlays,
  setEditing,
  info,
}: {
  store: FilesStore;
  ops: Operations;
  state: FilesState;
  overlays: Overlays;
  /** The omnibox's text while it is being edited (null: the crumbs). */
  setEditing: (text: string | null) => void;
  /** `--info` (the file manager service's ShowItemProperties): the path to show Get Info for. */
  info?: string | undefined;
}): WindowActions {
  const { setSheet, setMenu, refocus } = overlays;
  const find = (path: string): FileItem | undefined => store.visible().find((item) => item.path === path);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `find` reads the store's latest list when called; the store is what changes
  const actions = useMemo<WindowActions>(
    () => ({
      // Renaming happens on the name itself (rename-field.tsx).
      rename: (path) => store.startRename(path),
      info: (path) => {
        const item = find(path);
        if (item) setSheet({ kind: "info", item });
      },
      openWith: (path) => {
        const item = find(path);
        if (!item) return;
        setSheet({ kind: "open-with", item, apps: null });
        void ops.appsFor(item).then((apps) => setSheet((now) => (now?.kind === "open-with" && now.item.path === item.path ? { ...now, apps } : now)));
      },
      // "untitled folder" at once, its name a field (no sheet).
      newFolder: () => void ops.newFolder(),
      goToFolder: () => setEditing(editText(store.getSnapshot().location, store.env.home)),
      find: () => setEditing(store.getSnapshot().query),
      confirmEmptyTrash: () => setSheet({ kind: "empty-trash" }),
      confirmDelete: (paths) => setSheet({ kind: "delete", items: paths.flatMap((path) => find(path) ?? []) }),
      menu: (point, kind) => setMenu({ ...point, kind }),
      refocus,
    }),
    [store, ops, refocus],
  );

  // Edit's Undo names the last write.
  const undo = useUndo(ops.undo);
  useAppMenus(menuSpecs(state, store, ops, undo), (id) => chooseMenu(id, store, ops, actions));

  const infoShown = useRef(info === undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: waits for the listing; the sheet opens once
  useEffect(() => {
    if (infoShown.current || state.loading || info === undefined) return;
    infoShown.current = true;
    actions.info(info);
  }, [state.loading, state.items]);

  return actions;
}
