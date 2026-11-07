/**
 * The file browser's listing, the part Files' window and every chooser
 * share (PA-12): icons or a list of what the store shows, with Files'
 * keyboard (keys.ts) and selection (a click, ⇧-click for a run, ❖-click for
 * one more, a click on empty space for none). While a new folder loads, the
 * last one's items stay up, and "Loading…" comes only after 200 ms, so a
 * quick folder doesn't flicker. The window around it decides what a key
 * does beyond moving (`onKey`): Files opens and trashes, a chooser answers.
 */

import { Button, EmptyState, glyphs, Loading, useColors, useShownAfter } from "@dashi/ui";
import { View, type WindowKeyInfo } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { useFiles, useFilesState } from "./context.ts";
import { useDropTarget } from "./drop.ts";
import { Grid } from "./grid.tsx";
import { type BrowserKey, browserKey } from "./keys.ts";
import { ListView } from "./list.tsx";
import { folderAt } from "./location.ts";
import type { FilesStore } from "./store.ts";

function Empty({ store }: { store: FilesStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // A folder that takes a moment shows the spinner after 200 ms (PA-5).
  if (state.loading) return <Loading testID="empty" />;
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
      <EmptyState testID="empty" title="No results" message={`Nothing named “${state.query.trim()}”.`} glyph={glyphs.SEARCH} />
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

/**
 * The keys the window gets when nothing else takes them. Moves are the
 * browser's own; the rest go to `onKey`. Change `focusKey` to take the
 * keyboard back from a field (a new key view gives it to the window).
 */
export function BrowserKeys({
  onKey,
  focusKey,
  onChord,
}: {
  onKey: (key: BrowserKey) => void;
  focusKey: number;
  /** Sees every key first (a chooser's ⇧❖. for hidden files, which has no menu bar to go through); true when it took it. */
  onChord?: (info: WindowKeyInfo) => boolean;
}) {
  const { store } = useFiles();
  return (
    <View
      key={String(focusKey)}
      testID="keys"
      onWindowKeyDown={(info) => {
        if (onChord?.(info)) return;
        const key = browserKey(info);
        if (!key) return;
        if (key.kind === "move") store.move(key.step, key.extend);
        else onKey(key);
      }}
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
    />
  );
}

export interface ListingProps {
  /** A right-click on empty space (Files' folder menu); none in a chooser. */
  onBackgroundMenu?: (point: { x: number; y: number }) => void;
}

/** The listing's area: a click on its empty space selects nothing, a right-click there is the folder's menu, and files dropped there go into the folder shown. */
export function Listing({ onBackgroundMenu }: ListingProps) {
  const colors = useColors();
  const { store, actions } = useFiles();
  const state = useFilesState();
  const drop = useDropTarget(state.location.kind === "folder" && state.found === null ? state.location.path : null);
  // The last place's items stay up while this one loads, then give way to "Loading…".
  const waited = useShownAfter(store.stale);
  const items = waited ? [] : store.visible();
  const empty = <Empty store={store} />;
  return (
    <View
      testID="content"
      {...drop.props}
      onPress={() => {
        store.clickEmpty();
        actions.refocus();
      }}
      {...(onBackgroundMenu ? { onContextMenu: onBackgroundMenu } : {})}
      style={{ flex: 1, minHeight: 0, ...(drop.over ? { borderWidth: 2, borderColor: colors.selection, borderRadius: 4 } : {}) }}
    >
      {state.view === "icons" ? <Grid items={items} empty={empty} /> : <ListView items={items} empty={empty} />}
    </View>
  );
}
