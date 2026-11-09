/**
 * Files' window: the sidebar, a toolbar with back and forward and the view
 * switch around the omnibox (the path and search, omnibox.tsx), the listing
 * (browser.tsx, which every chooser shares), and a notice over it only while
 * a job runs or a message stands. Sheets and menus are drawn inside it
 * (Metal has no child windows). The keys (keys.ts): the arrows move in two
 * directions, ⇧ extends, Return opens, F2 renames in place, Delete moves to
 * the Trash, Space peeks, ⌫ goes back, and typing jumps to a name.
 */

import { AppWindow, ConfirmSheet, type MenuEntry, PopupMenu, useUndo } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import { chooseMenu, menuSpecs } from "./appmenus.ts";
import { BrowserKeys, Listing } from "./browser.tsx";
import { chromeFor, RAIL_WIDTH } from "./chrome.ts";
import { looksLikeUriList, parseUriList } from "./clipboard.ts";
import { ConflictSheet } from "./conflict-sheet.tsx";
import { Files, type WindowActions } from "./context.ts";
import { Footer } from "./footer.tsx";
import { formatCount } from "./format.ts";
import type { FileItem } from "./items.ts";
import type { BrowserKey } from "./keys.ts";
import { locationTitle } from "./location.ts";
import { actionMenu, backgroundMenu, itemMenu } from "./menus.ts";
import { editText, Omnibox, SuggestionList, type Suggestions } from "./omnibox.tsx";
import type { OpenWithApp } from "./open.ts";
import type { Answer, Conflict, Operations } from "./operations.ts";
import { baseName } from "./paths.ts";
import { Peek } from "./peek.tsx";
import { InfoSheet, OpenWithSheet } from "./sheets.tsx";
import { Sidebar } from "./sidebar.tsx";
import type { FilesStore } from "./store.ts";
import { Controls, Leading } from "./toolbar.tsx";

export const FILES_SIZE = { width: 1000, height: 660 } as const;

type Sheet =
  | { kind: "info"; item: FileItem }
  | { kind: "open-with"; item: FileItem; apps: OpenWithApp[] | null }
  | { kind: "empty-trash" }
  | { kind: "delete"; items: FileItem[] }
  | { kind: "conflict"; conflict: Conflict; answer: (answer: Answer) => void }
  | { kind: "peek" };

type MenuState = { x: number; y: number; kind: "item" | "background" | "actions" };

export function FilesWindow({ store, ops, info }: { store: FilesStore; ops: Operations; info?: string }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [focus, setFocus] = useState(0);
  // The window's width: a narrow one gives the sidebar a rail and the toolbar fewer buttons (chrome.ts).
  const [width, setWidth] = useState(0);
  const chrome = chromeFor(width);
  // The omnibox's text while it is being edited (null: the crumbs), and the folders it offers.
  const [editing, setEditingText] = useState<string | null>(null);
  const [editSession, setEditSession] = useState(0);
  const setEditing = useCallback((text: string | null) => {
    if (text !== null) setEditSession((n) => n + 1);
    setEditingText(text);
  }, []);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);

  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const close = useCallback(() => {
    setSheet(null);
    setMenu(null);
    refocus();
  }, [refocus]);

  // A copy or a move onto a taken name asks here (PA-3), one collision at a time.
  useEffect(() => {
    ops.ask = (conflict) =>
      new Promise<Answer>((resolve) =>
        setSheet({
          kind: "conflict",
          conflict,
          answer: (answer) => {
            close();
            resolve(answer);
          },
        }),
      );
    return () => {
      ops.ask = null;
    };
  }, [ops, close]);

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

  // The menu bar's File, Edit, View, and Go are Files' own while it is in front; Edit's Undo names the last write.
  const undo = useUndo(ops.undo);
  useAppMenus(menuSpecs(state, store, ops, undo), (id) => chooseMenu(id, store, ops, actions));

  // `--info` (the file manager service's ShowItemProperties): Get Info for that item once the folder is listed.
  const infoShown = useRef(info === undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: waits for the listing; the sheet opens once
  useEffect(() => {
    if (infoShown.current || state.loading || info === undefined) return;
    infoShown.current = true;
    actions.info(info);
  }, [state.loading, state.items]);
  const deps = { store, ops, actions };
  const menuItems = (kind: MenuState["kind"]): MenuEntry[] =>
    kind === "item" ? itemMenu(deps, store.selectedItems()) : kind === "background" ? backgroundMenu(deps) : actionMenu(deps);

  const onKey = (key: BrowserKey): void => {
    const selected = store.selectedItems();
    switch (key.kind) {
      case "text": {
        if (key.text.length > 1 && looksLikeUriList(key.text) && ops.writable && state.location.kind === "folder") {
          void ops.transfer(parseUriList(key.text), state.location.path, "copy");
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
        if (selected.length === 1 && state.location.kind !== "trash") store.startRename((selected[0] as FileItem).path);
        return;
      case "trash":
        if (selected.length === 0) return;
        if (state.location.kind === "trash") return actions.confirmDelete(selected.map((item) => item.path));
        return void ops.trash(selected);
      case "peek":
        if (selected.length > 0) setSheet({ kind: "peek" });
        return;
      case "clear":
        return store.select([]);
      case "move":
        return;
    }
  };

  const overlay = (() => {
    if (sheet?.kind === "conflict") {
      const dest = sheet.conflict.dest;
      return <ConflictSheet conflict={sheet.conflict} folderName={dest === store.env.home ? "Home" : baseName(dest)} onAnswer={sheet.answer} />;
    }
    if (sheet?.kind === "peek") return <Peek onClose={close} />;
    if (sheet?.kind === "info") return <InfoSheet item={sheet.item} home={store.env.home} onClose={close} />;
    if (sheet?.kind === "open-with")
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
      return <PopupMenu testID="menu" x={menu.x} y={menu.y} items={menuItems(menu.kind)} onClose={close} />;
    }
    if (suggestions) return <SuggestionList suggestions={suggestions} home={store.env.home} />;
    return undefined;
  })();

  const title = state.found !== null ? "Search Results" : locationTitle(state.location, store.env.home);

  return (
    <Files.Provider value={{ store, ops, actions }}>
      <View
        testID="files-window"
        onLayout={(bounds) => setWidth((now) => (now === Math.round(bounds.width) ? now : Math.round(bounds.width)))}
        style={{ flex: 1 }}
      >
        <AppWindow
          title={title}
          leading={<Leading />}
          center={
            <Omnibox
              editing={editing}
              session={editSession}
              onEdit={setEditing}
              onDone={() => {
                setEditing(null);
                refocus();
              }}
              onSuggest={setSuggestions}
            />
          }
          toolbar={<Controls compact={chrome.compact} onNewFolder={actions.newFolder} onMenu={(point) => setMenu({ ...point, kind: "actions" })} />}
          sidebar={<Sidebar rail={chrome.rail} />}
          {...(chrome.rail ? { sidebarWidth: RAIL_WIDTH } : {})}
          notice={<Footer />}
          overlay={overlay}
        >
          {!sheet && !menu && editing === null && state.renaming === null && <BrowserKeys focusKey={focus} onKey={onKey} />}
          <Listing
            // A right-click on an item opens the item's menu only (Metal gives it to the innermost view).
            onBackgroundMenu={(point) => {
              store.select([]);
              setMenu({ ...point, kind: "background" });
            }}
          />
        </AppWindow>
      </View>
    </Files.Provider>
  );
}
