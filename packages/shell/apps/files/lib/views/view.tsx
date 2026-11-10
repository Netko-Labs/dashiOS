/**
 * Files' window: the sidebar, a toolbar with back and forward and the view
 * switch around the omnibox (the path and search, omnibox.tsx), the listing
 * (browser.tsx, which every chooser shares), and a notice over it only while
 * a job runs or a message stands. Sheets and menus are drawn inside it
 * (Metal has no child windows). The keys (keys.ts): the arrows move in two
 * directions, ⇧ extends, Return opens, F2 renames in place, Delete moves to
 * the Trash, Space peeks, ⌫ goes back, and typing jumps to a name.
 */

import { AppWindow } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useState, useSyncExternalStore } from "react";
import { chromeFor, RAIL_WIDTH } from "../chrome.ts";
import { Files } from "../context.ts";
import { locationTitle } from "../location.ts";
import { Omnibox } from "../omnibox/omnibox.tsx";
import type { Suggestions } from "../omnibox/omnibox-props.ts";
import type { Operations } from "../operations/operations.ts";
import type { FilesStore } from "../store/store.ts";
import { useOverlays } from "../use-overlays.ts";
import { useWindowActions } from "../use-window-actions.ts";
import { runBrowserKey } from "../window-keys.ts";
import { BrowserKeys, Listing } from "./browser.tsx";
import { Footer } from "./footer.tsx";
import { filesOverlay } from "./overlay.tsx";
import { Sidebar } from "./sidebar.tsx";
import { Controls, Leading } from "./toolbar.tsx";

export const FILES_SIZE = { width: 1000, height: 660 } as const;

export function FilesWindow({ store, ops, info }: { store: FilesStore; ops: Operations; info?: string }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const overlays = useOverlays(ops);
  const { sheet, menu, setSheet, setMenu, refocus } = overlays;
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
  const actions = useWindowActions({ store, ops, state, overlays, setEditing, info });
  const overlay = filesOverlay({ store, ops, actions, state, overlays, suggestions });

  const title = state.found !== null ? "Search Results" : locationTitle(state.location, store.env.home);

  return (
    <Files.Provider value={{ store, ops, actions }}>
      {/* The window's root reports no bounds of its own (Metal records a view's from its parent): its one child does. */}
      <View style={{ flex: 1 }}>
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
            toolbar={
              <Controls
                compact={chrome.compact}
                onNewFolder={actions.newFolder}
                onMenu={(point) => setMenu({ ...point, kind: "actions" })}
                menuOpen={menu?.kind === "actions"}
              />
            }
            sidebar={<Sidebar rail={chrome.rail} />}
            {...(chrome.rail ? { sidebarWidth: RAIL_WIDTH } : {})}
            notice={<Footer />}
            overlay={overlay}
          >
            {!sheet && !menu && editing === null && state.renaming === null && (
              <BrowserKeys focusKey={overlays.focus} onKey={(key) => runBrowserKey(key, { store, ops, actions, peek: () => setSheet({ kind: "peek" }) })} />
            )}
            <Listing
              // A right-click on an item opens the item's menu only (Metal gives it to the innermost view).
              onBackgroundMenu={(point) => {
                store.select([]);
                setMenu({ ...point, kind: "background" });
              }}
            />
          </AppWindow>
        </View>
      </View>
    </Files.Provider>
  );
}
