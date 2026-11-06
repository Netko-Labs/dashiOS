/**
 * Files' window: the sidebar, a toolbar with back and forward and the view
 * switch around the omnibox (the path and search, omnibox.tsx), the listing
 * in icons or a table, and a notice over it only while a job runs or a message stands.
 * Sheets and menus are drawn inside it (Metal has no child windows). The
 * keyboard comes through the kit's KeySink: arrows move the selection,
 * Enter opens, Backspace goes back, and typing jumps to a name.
 */

import { AppWindow, Button, ConfirmSheet, EmptyState, glyphs, type KeyInput, KeySink, type MenuItem, PopupMenu, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import { chooseMenu, menuSpecs } from "./appmenus.ts";
import { looksLikeUriList, parseUriList } from "./clipboard.ts";
import { Files, useFilesState, type WindowActions } from "./context.ts";
import { useDropTarget } from "./drop.ts";
import { Footer } from "./footer.tsx";
import { formatCount } from "./format.ts";
import { Grid } from "./grid.tsx";
import type { FileItem } from "./items.ts";
import { ListView } from "./list.tsx";
import { folderAt, locationTitle } from "./location.ts";
import { actionMenu, backgroundMenu, itemMenu } from "./menus.ts";
import { editText, Omnibox, SuggestionList, type Suggestions } from "./omnibox.tsx";
import type { OpenWithApp } from "./open.ts";
import type { Operations } from "./operations.ts";
import { InfoSheet, NameSheet, OpenWithSheet } from "./sheets.tsx";
import { Sidebar } from "./sidebar.tsx";
import type { FilesStore } from "./store.ts";
import { Controls, Leading } from "./toolbar.tsx";

export const FILES_SIZE = { width: 1000, height: 660 } as const;

type Sheet =
  | { kind: "new-folder" }
  | { kind: "rename"; item: FileItem }
  | { kind: "info"; item: FileItem }
  | { kind: "open-with"; item: FileItem; apps: OpenWithApp[] | null }
  | { kind: "empty-trash" }
  | { kind: "delete"; items: FileItem[] };

type MenuState = { x: number; y: number; kind: "item" | "background" | "actions" };

function Empty({ store }: { store: FilesStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (state.loading) return <EmptyState title="Loading…" testID="empty" />;
  if (state.error) {
    return (
      <EmptyState
        testID="empty"
        title="This folder can’t be shown"
        message={state.error}
        glyph={glyphs.WARNING}
        action={<Button label="Go to Home" testID="empty:home" onPress={() => store.go(folderAt(store.env.home))} />}
      />
    );
  }
  if (state.found !== null)
    return state.searching ? (
      <EmptyState testID="empty" title="Searching…" />
    ) : (
      <EmptyState testID="empty" title="No Results" message={`Nothing named “${state.query.trim()}”.`} glyph={glyphs.SEARCH} />
    );
  if (state.location.kind === "trash") return <EmptyState testID="empty" title="The Trash is empty" />;
  if (state.location.kind === "recents") return <EmptyState testID="empty" title="No recent files" message="Files you open will show up here." />;
  return (
    <EmptyState
      testID="empty"
      title="This folder is empty"
      message={state.showHidden || !state.items.some((item) => item.hidden) ? undefined : "Hidden files are not shown."}
    />
  );
}

/** The listing's area: a right-click there is the folder's menu, and files dropped there go into the folder shown (not into Recents or search results). */
function Content({ onBackgroundMenu, children }: { onBackgroundMenu: (point: { x: number; y: number }) => void; children: React.ReactNode }) {
  const colors = useColors();
  const state = useFilesState();
  const drop = useDropTarget(state.location.kind === "folder" && state.found === null ? state.location.path : null);
  return (
    <View
      testID="content"
      {...drop.props}
      style={{ flex: 1, minHeight: 0, ...(drop.over ? { borderWidth: 2, borderColor: colors.selection, borderRadius: 4 } : {}) }}
      onContextMenu={onBackgroundMenu}
    >
      {children}
    </View>
  );
}

export function FilesWindow({ store, ops, info }: { store: FilesStore; ops: Operations; info?: string }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [focus, setFocus] = useState(0);
  const [columns, setColumns] = useState(1);
  // The omnibox's text while it is being edited (null: the crumbs), and the folders it offers.
  const [editing, setEditing] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: FILES_SIZE.width, height: FILES_SIZE.height });

  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const close = useCallback(() => {
    setSheet(null);
    setMenu(null);
    refocus();
  }, [refocus]);

  const find = (path: string): FileItem | undefined => store.visible().find((item) => item.path === path);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `find` reads the store's latest list when called; the store is what changes
  const actions = useMemo<WindowActions>(
    () => ({
      rename: (path) => {
        const item = find(path);
        if (item) setSheet({ kind: "rename", item });
      },
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
      newFolder: () => setSheet({ kind: "new-folder" }),
      goToFolder: () => setEditing(editText(store.getSnapshot().location, store.env.home)),
      find: () => setEditing(store.getSnapshot().query),
      confirmEmptyTrash: () => setSheet({ kind: "empty-trash" }),
      confirmDelete: (paths) => setSheet({ kind: "delete", items: paths.flatMap((path) => find(path) ?? []) }),
      menu: (point, kind) => setMenu({ ...point, kind }),
      refocus,
    }),
    // `find` reads the live store; the closures need no other inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ops, refocus],
  );

  // The menu bar's File, Edit, View, and Go are Files' own while it is in front.
  useAppMenus(menuSpecs(state, store, ops), (id) => chooseMenu(id, store, ops, actions));

  const items = store.visible();
  // `--info` (the file manager service's ShowItemProperties): Get Info for that item once the folder is listed.
  const infoShown = useRef(info === undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: waits for the listing; the sheet opens once
  useEffect(() => {
    if (infoShown.current || state.loading || info === undefined) return;
    infoShown.current = true;
    actions.info(info);
  }, [state.loading, state.items]);
  const deps = { store, ops, actions };
  const menuItems = (kind: MenuState["kind"]): MenuItem[] =>
    kind === "item" ? itemMenu(deps, store.selectedItems()) : kind === "background" ? backgroundMenu(deps) : actionMenu(deps);

  const onKey = (key: KeyInput): void => {
    switch (key.kind) {
      case "text": {
        if (key.text.length > 1 && looksLikeUriList(key.text) && ops.writable && state.location.kind === "folder") {
          void ops.transfer(parseUriList(key.text), state.location.path, "copy");
        } else if (key.text.trim() !== "") {
          store.typeAhead(key.text);
        }
        return;
      }
      case "enter":
        return store.openSelection();
      case "up":
        return store.move(state.view === "icons" ? -columns : -1);
      case "down":
        return store.move(state.view === "icons" ? columns : 1);
      case "backspace":
        return store.goBack();
      case "escape":
        return store.select([]);
    }
  };

  const overlay = (() => {
    if (sheet?.kind === "new-folder") {
      return (
        <NameSheet
          title="New Folder"
          message="Name of the new folder:"
          initial="untitled folder"
          action="Create"
          onCancel={close}
          onSubmit={async (name) => {
            const problem = await ops.newFolder(name);
            if (problem === null) close();
            return problem;
          }}
        />
      );
    }
    if (sheet?.kind === "rename") {
      return (
        <NameSheet
          title={`Rename “${sheet.item.name}”`}
          initial={sheet.item.name}
          action="Rename"
          onCancel={close}
          onSubmit={async (name) => {
            const problem = await ops.rename(sheet.item.path, name);
            if (problem === null) close();
            return problem;
          }}
        />
      );
    }
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
          message={`${formatCount(state.items.length)} will be deleted for good. This can’t be undone.`}
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
          message="It will be deleted for good. This can’t be undone."
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
      const entries = menuItems(menu.kind);
      const x = Math.max(8, Math.min(menu.x, frame.width - 210));
      const y = Math.max(8, Math.min(menu.y, frame.height - entries.length * 24 - 16));
      return <PopupMenu testID="menu" x={x} y={y} items={entries} onClose={close} />;
    }
    if (suggestions) return <SuggestionList suggestions={suggestions} home={store.env.home} />;
    return undefined;
  })();

  const title = state.found !== null ? "Search Results" : locationTitle(state.location, store.env.home);
  const empty = <Empty store={store} />;

  return (
    <Files.Provider value={{ store, ops, actions }}>
      <View style={{ flex: 1 }} onLayout={(bounds) => setFrame({ width: bounds.width, height: bounds.height })}>
        <AppWindow
          title={title}
          leading={<Leading />}
          center={
            <Omnibox
              editing={editing}
              onEdit={setEditing}
              onDone={() => {
                setEditing(null);
                refocus();
              }}
              onSuggest={setSuggestions}
            />
          }
          toolbar={<Controls onNewFolder={() => setSheet({ kind: "new-folder" })} onMenu={(point) => setMenu({ ...point, kind: "actions" })} />}
          sidebar={<Sidebar />}
          notice={<Footer />}
          overlay={overlay}
        >
          {!sheet && !menu && editing === null && <KeySink testID="keys" focusKey={focus} onKey={onKey} />}
          <Content
            // A right-click on an item opens the item's menu only (Metal gives it to the innermost view).
            onBackgroundMenu={(point) => {
              store.select([]);
              setMenu({ ...point, kind: "background" });
            }}
          >
            {state.view === "icons" ? <Grid items={items} onColumns={setColumns} empty={empty} /> : <ListView items={items} empty={empty} />}
          </Content>
        </AppWindow>
      </View>
    </Files.Provider>
  );
}
