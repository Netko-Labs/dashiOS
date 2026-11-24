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

import { Button, EmptyState, ErrorState, Loading, NoResults, RADIUS, SPACE, useColors, useShownAfter } from "@dashi/ui";
import { View, type WindowKeyInfo } from "@mirinjs/metal";
import { useContext, useSyncExternalStore } from "react";
import { Surface } from "../metal/index.ts";
import { useFiles, useFilesState } from "./context.ts";
import { dropLook, useDropTarget } from "./drop.ts";
import { sidebarGlyph } from "./glyphs.ts";
import { type BrowserKey, browserKey } from "./keys.ts";
import { marqueeOf } from "./lib/marquee/of.ts";
import { reveal } from "./lib/marquee/reveal.ts";
import { Grid } from "./lib/views/grid.tsx";
import { ListView } from "./lib/views/list.tsx";
import { folderAt } from "./location.ts";
import type { FilesStore } from "./store.ts";

/**
 * What the listing says when it has nothing to show (PA-5 to PA-7, PA-17): a
 * folder still loading or a search still running is the spinner after 200
 * ms; a folder that can't be shown is an error state (ume) with its way on;
 * a search that found nothing is "No results"; an empty place names itself,
 * with what the person can do there.
 */
function ListingState() {
  const { store, ops } = useFiles();
  const state = useFilesState();
  if (state.loading) return <Loading testID="empty" />;
  if (state.error) {
    return (
      <ErrorState
        testID="empty"
        title="This folder can’t be shown."
        message={state.error}
        actions={<Button label="Go to Home" testID="empty:home" onPress={() => store.go(folderAt(store.env.home))} />}
      />
    );
  }
  if (state.found !== null) return state.searching ? <Loading testID="empty" label="Searching…" /> : <NoResults testID="empty" query={state.query} />;
  if (state.location.kind === "trash") return <EmptyState testID="empty" glyph={sidebarGlyph("trash")} title="The Trash is empty" />;
  if (state.location.kind === "recents") {
    return <EmptyState testID="empty" glyph={sidebarGlyph("recents")} title="No recent files" message="Files you open will show up here." />;
  }
  // A chooser that shows only some things (folders, a kind of file): this folder has none of them, but it isn't empty.
  const keptOut = store.keptOut();
  if (keptOut) return <EmptyState testID="empty" glyph={sidebarGlyph("folder")} title={keptOut} />;
  const hidden = !state.showHidden && state.items.some((item) => item.hidden);
  return (
    <EmptyState
      testID="empty"
      glyph={sidebarGlyph("folder")}
      title="This folder is empty"
      message={hidden ? "Hidden files are not shown." : ops === null ? undefined : "Drop files here, or press ⇧❖N for a new folder."}
    />
  );
}

/**
 * The keys the window gets when nothing else takes them. Moves are the
 * browser's own, and the item they land on is kept in view; the rest go to `onKey`. Change `focusKey` to take the
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
        const was = store.keyboardAt();
        if (key.kind === "move") store.move(key.step, key.extend);
        else onKey(key);
        // The arrows, the page keys or a typed name moved the keyboard: its item is scrolled into view (D143).
        const now = store.keyboardAt();
        const marquee = marqueeOf(store);
        if (now !== null && now !== was && marquee.surface?.scrolls()) reveal(now, marquee.model, marquee.place);
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
        borderWidth: SPACE.px,
        borderColor: colors.selection,
        borderRadius: RADIUS.thumb,
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
  const empty = <ListingState />;
  const marquee = marqueeOf(store);
  // The window says whether its host tells where the listing is scrolled; without that nothing is dragged out.
  marquee.surface = useContext(Surface);
  return (
    <View
      testID="content"
      {...drop.props}
      onPointer={marquee.pointerEvent}
      onPress={(event) => {
        // The click that ends a marquee is the marquee's, not a click on empty space.
        if (marquee.press(event.modifiers)) return;
        store.clickEmpty();
        actions.refocus();
      }}
      {...(onBackgroundMenu ? { onContextMenu: onBackgroundMenu } : {})}
      style={{ flex: 1, minHeight: 0, ...dropLook(colors, drop.over, RADIUS.check) }}
    >
      {state.view === "icons" ? <Grid items={items} empty={empty} /> : <ListView items={items} empty={empty} />}
      <MarqueeRect store={store} />
    </View>
  );
}
