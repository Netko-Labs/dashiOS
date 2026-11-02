/**
 * Files' window: the sidebar, a toolbar with back and forward and the view
 * switch, the listing in icons or a table, and the footer with the path bar.
 * Sheets and menus are drawn inside it (Metal has no child windows). The
 * keyboard comes through the kit's KeySink: arrows move the selection,
 * Enter opens, Backspace goes back, and typing jumps to a name.
 */

import { Text, View } from "@mirinjs/metal";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import { AppWindow, Button, ConfirmSheet, EmptyState, glyphs, type KeyInput, KeySink, type MenuItem, PopupMenu, Segmented, useColors } from "@dashi/ui";
import { parseUriList, looksLikeUriList } from "./clipboard.ts";
import { chooseMenu, menuSpecs } from "./appmenus.ts";
import { Files, type WindowActions } from "./context.ts";
import { Footer } from "./footer.tsx";
import { Grid } from "./grid.tsx";
import { ListView } from "./list.tsx";
import { locationTitle, folderAt } from "./location.ts";
import { actionMenu, backgroundMenu, itemMenu } from "./menus.ts";
import { formatCount } from "./format.ts";
import type { FileItem } from "./items.ts";
import type { Operations } from "./operations.ts";
import type { OpenWithApp } from "./open.ts";
import { InfoSheet, NameSheet, OpenWithSheet, PathSheet } from "./sheets.tsx";
import { Sidebar } from "./sidebar.tsx";
import type { FilesStore } from "./store.ts";
import { Controls, Leading } from "./toolbar.tsx";

export const FILES_SIZE = { width: 1000, height: 660 } as const;

type Sheet =
  | { kind: "new-folder" }
  | { kind: "rename"; item: FileItem }
  | { kind: "info"; item: FileItem }
  | { kind: "open-with"; item: FileItem; apps: OpenWithApp[] | null }
  | { kind: "go" }
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

function SearchBar({ store }: { store: FilesStore }) {
  const colors = useColors();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (state.query === "") return null;
  return (
    <View
      testID="searchbar"
      style={{
        height: 34,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.textMuted }}>Search:</Text>
      <Segmented
        testID="scope"
        options={[
          { value: "folder", label: state.location.kind === "folder" ? `“${locationTitle(state.location, store.env.home)}”` : "This List" },
          { value: "computer", label: "This Computer" },
        ]}
        value={state.scope}
        onChange={(scope) => store.setScope(scope)}
      />
      {state.searching && <Text style={{ fontSize: 11, color: colors.textMuted }}>Searching…</Text>}
      {state.truncated && <Text style={{ fontSize: 11, color: colors.textMuted }}>Showing the first results. Narrow the search.</Text>}
    </View>
  );
}

export function FilesWindow({ store, ops }: { store: FilesStore; ops: Operations }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [focus, setFocus] = useState(0);
  // A right-click reaches the item under the pointer and then the empty space around it: the item's menu stands.
  const itemMenuAt = useRef(0);
  const [columns, setColumns] = useState(1);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: FILES_SIZE.width, height: FILES_SIZE.height });

  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const close = useCallback(() => {
    setSheet(null);
    setMenu(null);
    refocus();
  }, [refocus]);

  const find = (path: string): FileItem | undefined => store.visible().find((item) => item.path === path);
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
      goToFolder: () => setSheet({ kind: "go" }),
      confirmEmptyTrash: () => setSheet({ kind: "empty-trash" }),
      confirmDelete: (paths) => setSheet({ kind: "delete", items: paths.flatMap((path) => find(path) ?? []) }),
      menu: (point, kind) => {
        if (kind === "item") itemMenuAt.current = Date.now();
        setMenu({ ...point, kind });
      },
      refocus,
    }),
    // `find` reads the live store; the closures need no other inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ops, refocus],
  );

  // The menu bar's File, Edit, View, and Go are Files' own while it is in front.
  useAppMenus(menuSpecs(state, store, ops), (id) => chooseMenu(id, store, ops, actions));

  const items = store.visible();
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
    if (sheet?.kind === "go") {
      return (
        <PathSheet
          onCancel={close}
          onSubmit={async (text) => {
            const problem = store.goToPath(text);
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
    return undefined;
  })();

  const total = items.length;
  const subtitle = state.found !== null ? `${formatCount(total)} found` : formatCount(total);
  const title = state.found !== null ? "Search Results" : locationTitle(state.location, store.env.home);
  const empty = <Empty store={store} />;

  return (
    <Files.Provider value={{ store, ops, actions }}>
      <View style={{ flex: 1 }} onLayout={(bounds) => setFrame({ width: bounds.width, height: bounds.height })}>
        <AppWindow
          title={title}
          subtitle={subtitle}
          leading={<Leading />}
          toolbar={<Controls onNewFolder={() => setSheet({ kind: "new-folder" })} onMenu={(point) => setMenu({ ...point, kind: "actions" })} />}
          sidebar={<Sidebar />}
          footer={<Footer />}
          overlay={overlay}
        >
          {!sheet && !menu && <KeySink testID="keys" focusKey={focus} onKey={onKey} />}
          <SearchBar store={store} />
          <View
            testID="content"
            style={{ flex: 1, minHeight: 0 }}
            onContextMenu={(point) => {
              if (Date.now() - itemMenuAt.current < 150) return;
              store.select([]);
              setMenu({ ...point, kind: "background" });
            }}
          >
            {state.view === "icons" ? <Grid items={items} onColumns={setColumns} empty={empty} /> : <ListView items={items} empty={empty} />}
          </View>
        </AppWindow>
      </View>
    </Files.Provider>
  );
}
