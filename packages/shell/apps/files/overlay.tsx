/**
 * What floats over the Files window: the sheet or menu that is open, or the
 * omnibox's list of folders.
 */

import { ConfirmSheet, type MenuEntry, PopupMenu } from "@dashi/ui";
import type { ReactElement } from "react";
import { baseName } from "../../src/shared/files/paths.ts";
import { ConflictSheet } from "./conflict-sheet.tsx";
import type { WindowActions } from "./context.ts";
import { formatCount } from "./format.ts";
import { actionMenu, backgroundMenu, itemMenu } from "./menus.ts";
import { SuggestionList, type Suggestions } from "./omnibox.tsx";
import type { Operations } from "./operations.ts";
import { Peek } from "./peek.tsx";
import { InfoSheet, OpenWithSheet } from "./sheets.tsx";
import type { FilesState, FilesStore } from "./store.ts";
import type { MenuState, Overlays } from "./use-overlays.ts";

export function filesOverlay({
  store,
  ops,
  actions,
  state,
  overlays,
  suggestions,
}: {
  store: FilesStore;
  ops: Operations;
  actions: WindowActions;
  state: FilesState;
  overlays: Overlays;
  suggestions: Suggestions | null;
}): ReactElement | undefined {
  const { sheet, menu, close } = overlays;
  const deps = { store, ops, actions };
  const menuItems = (kind: MenuState["kind"]): MenuEntry[] =>
    kind === "item" ? itemMenu(deps, store.selectedItems()) : kind === "background" ? backgroundMenu(deps) : actionMenu(deps);
  if (sheet?.kind === "conflict") {
    const dest = sheet.conflict.dest;
    return <ConflictSheet conflict={sheet.conflict} folderName={dest === store.env.home ? "Home" : baseName(dest)} onAnswer={sheet.answer} />;
  }
  if (sheet?.kind === "peek") return <Peek onClose={close} />;
  if (sheet?.kind === "info") return <InfoSheet item={sheet.item} home={store.env.home} onClose={close} />;
  if (sheet?.kind === "open-with") {
    return (
      <OpenWithSheet
        item={sheet.item}
        apps={sheet.apps}
        onCancel={close}
        onChoose={(app) => {
          void ops.openWith(app, sheet.item);
          close();
        }}
      />
    );
  }
  if (sheet?.kind === "empty-trash") {
    return (
      <ConfirmSheet
        testID="empty-trash"
        title="Empty the Trash?"
        message={`${formatCount(state.items.length)} will be deleted for good.`}
        confirmLabel="Empty Trash"
        danger
        onCancel={close}
        onConfirm={() => {
          void ops.emptyTrash();
          close();
        }}
      />
    );
  }
  if (sheet?.kind === "delete") {
    const names = sheet.items.length === 1 ? `“${sheet.items[0]?.name}”` : formatCount(sheet.items.length);
    return (
      <ConfirmSheet
        testID="delete-forever"
        title={`Delete ${names} immediately?`}
        message="You can’t undo this."
        confirmLabel="Delete"
        danger
        onCancel={close}
        onConfirm={() => {
          void ops.deleteForever(sheet.items);
          close();
        }}
      />
    );
  }
  if (menu) {
    // The menu keeps itself inside the window, flipped at the pointer when it would run off (PA-9).
    // "…"'s hangs by its right edge under the button, at the width it is drawn.
    return (
      <PopupMenu
        testID="menu"
        x={menu.x}
        y={menu.y}
        items={menuItems(menu.kind)}
        onClose={close}
        {...(menu.kind === "actions" ? { anchor: "end" as const } : {})}
      />
    );
  }
  if (suggestions) return <SuggestionList suggestions={suggestions} home={store.env.home} />;
  return undefined;
}
