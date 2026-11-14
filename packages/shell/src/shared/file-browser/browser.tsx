/**
 * The file browser's listing, the part Files' window and every chooser
 * share (PA-12): icons or a list of what the store shows, with Files'
 * keyboard (keys.ts) and selection (a click, ⇧-click for a run, ❖-click for
 * one more, a click on empty space for none, a press there dragged out for
 * a marquee: lib/marquee/). While a new folder loads, the
 * last one's items stay up, and "Loading…" comes only after 200 ms, so a
 * quick folder doesn't flicker. The window around it decides what a key
 * does beyond moving (`onKey`): Files opens and trashes, a chooser answers.
 */

import { Button, EmptyState, glyphs, Loading, useColors, useShownAfter } from "@dashi/ui";
import { View, type WindowKeyInfo } from "@mirinjs/metal";
import { useContext, useSyncExternalStore } from "react";
import { Surface } from "../metal/index.ts";
import { useFiles, useFilesState } from "./context.ts";
import { useDropTarget } from "./drop.ts";
import { type BrowserKey, browserKey } from "./keys.ts";
import { marqueeOf } from "./lib/marquee/of.ts";
import { Grid } from "./lib/views/grid.tsx";
import { ListView } from "./lib/views/list.tsx";
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
  // A chooser that shows only some things (folders, a kind of file): this folder has none of them, but it isn't empty.
  const keptOut = store.keptOut();
  if (keptOut) return <EmptyState testID="empty" title={keptOut} />;
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
        // Esc during a marquee ends it and puts the selection back.
        if (info.key === "escape" && marqueeOf(store).cancel()) return;
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

/** The rectangle a marquee draws: a faint wash of the selection's colour with a 1 px edge, over the items, taking no pointer. */
function MarqueeRect({ store }: { store: FilesStore }) {
  const colors = useColors();
  const marquee = marqueeOf(store);
  const { rect } = useSyncExternalStore(marquee.subscribe, marquee.getSnapshot);
  if (!rect) return null;
  return (
    <View
      testID="marquee"
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: colors.selectionWash,
        borderWidth: 1,
        borderColor: colors.selection,
        borderRadius: 2,
      }}
    />
  );
}

/**
 * The listing's area: a click on its empty space selects nothing, a press
 * there dragged out draws a marquee that selects what it touches
 * (lib/marquee/), a right-click there is the folder's menu, and files
 * dropped there go into the folder shown.
 */
export function Listing({ onBackgroundMenu }: ListingProps) {
  const colors = useColors();
  const { store, actions } = useFiles();
  const state = useFilesState();
  const drop = useDropTarget(state.location.kind === "folder" && state.found === null ? state.location.path : null);
  // The last place's items stay up while this one loads, then give way to "Loading…".
  const waited = useShownAfter(store.stale);
  const items = waited ? [] : store.visible();
  const empty = <Empty store={store} />;
  const marquee = marqueeOf(store);
  // The window says where the items are painted and scrolls them; without it nothing is dragged out.
  marquee.surface = useContext(Surface);
  const { dragging } = useSyncExternalStore(marquee.subscribe, marquee.getSnapshot);
  return (
    <View
      testID="content"
      {...drop.props}
      onPointer={marquee.pointerEvent}
      // The wheel is heard only during a drag: it moves the items under the rectangle.
      {...(dragging ? { onWheel: marquee.wheel } : {})}
      onPress={(event) => {
        // The click that ends a marquee is the marquee's: its keys say what it does (plain replaces, ⇧ adds, ❖ toggles).
        if (marquee.press(event.modifiers)) return;
        store.clickEmpty();
        actions.refocus();
      }}
      {...(onBackgroundMenu ? { onContextMenu: onBackgroundMenu } : {})}
      style={{ flex: 1, minHeight: 0, ...(drop.over ? { borderWidth: 2, borderColor: colors.selection, borderRadius: 4 } : {}) }}
    >
      {state.view === "icons" ? <Grid items={items} empty={empty} /> : <ListView items={items} empty={empty} />}
      <MarqueeRect store={store} />
    </View>
  );
}
