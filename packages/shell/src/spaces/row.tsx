/**
 * The Desktops row across the top of Mission Control: one line of names
 * (each Desktop's own, or after its apps: names.ts) with the current one
 * marked, a + at the right end, and a × on the name under the pointer. With
 * the pointer or a dragged window at the top it opens into live pictures
 * of each Desktop (shelf.ts; the compositor draws them over this surface,
 * in the rects start.tsx sends, so this draws their frames and names). A
 * click on a picture or a name goes there; a double-click on a name edits it
 * in place (Return keeps it, Esc puts it back; empty goes back to the
 * automatic name). A window dragged out of the overview and dropped on a
 * picture, a name, or the + moves there (start.tsx). A full-screen window's
 * Desktop (fullscreen.ts) is named after its app and is not renamed; its ×
 * takes the window out of full screen.
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { KeyCatcher } from "../overlay.tsx";
import type { Desktops } from "./controller.ts";
import { ROW } from "./model.ts";
import { at, CLOSE, RenameField, RowAdd, RowClose, RowName, RowPictures, useNamePress } from "./row-parts.tsx";
import { rowShape, SHELF_HEIGHT } from "./shelf.ts";

interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

/** What start.tsx keeps about the row: whether it is open, and the picture a dragged window is over. */
export interface RowView {
  open: boolean;
  lifted: number | null;
}

export interface RowProps {
  desktops: Store<Desktops>;
  view: Store<RowView>;
  /** The row's width, the screen's; and the screen's shape, for the pictures. */
  width: number;
  aspect: number;
  onSwitch(index: number): void;
  onAdd(): void;
  onRemove(index: number): void;
  onRename(index: number, name: string): void;
  /** The pointer came onto the row or left it. */
  /** The pointer is on (or left) a part of the row: "row", or a × that takes the pointer from it. */
  onHover(hovered: boolean, part?: string): void;
  /** The pointer came onto Desktop `index`'s picture or name, or left it (where a dragged window would go). */
  onOverSpace(index: number, over: boolean): void;
  /** Esc while the row has the keyboard (after a click or a rename): leave Mission Control. */
  onEscape(): void;
}

export function SpacesRow(props: RowProps) {
  const { width, aspect } = props;
  const colors = useColors();
  const { count, current, labels, fullscreen } = useSyncExternalStore(props.desktops.subscribe, props.desktops.getSnapshot);
  const isFullscreen = (index: number) => (fullscreen[index] ?? null) !== null;
  const desktops = fullscreen.filter((slot) => slot === null).length;
  const view = useSyncExternalStore(props.view.subscribe, props.view.getSnapshot);
  const shape = rowShape(view.open, width, count, aspect);
  const names = shape.layout.labels;
  // The × shows while the pointer is on a name or on its ×.
  const [overLabel, setOverLabel] = useState<number | null>(null);
  const [overClose, setOverClose] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; text: string } | null>(null);
  // The last Desktop stays; a full-screen one's × leaves full screen.
  const showsClose = (index: number) => (isFullscreen(index) || desktops > 1) && renaming === null && (overLabel === index || overClose === index);
  const hover = (index: number, set: typeof setOverLabel) => (hovered: boolean) => set((was) => (hovered ? index : was === index ? null : was));

  const pressName = useNamePress(props.onSwitch, (index) => setRenaming({ index, text: labels[index] ?? "" }), isFullscreen);
  const finishRename = (keep: boolean, text: string) => {
    if (renaming && keep) props.onRename(renaming.index, text);
    setRenaming(null);
  };

  return (
    <View style={{ width, height: view.open ? SHELF_HEIGHT : ROW.height }} onHoverChange={(hovered) => props.onHover(hovered)}>
      {view.open ? <View style={{ ...at({ x: 0, y: 0, width, height: SHELF_HEIGHT }), backgroundColor: colors.dock }} /> : null}
      {renaming === null ? <KeyCatcher onKey={(key) => key === "Escape" && props.onEscape()} /> : null}
      {shape.open ? (
        <RowPictures pictures={shape.layout.pictures} lifted={view.lifted} current={current} onSwitch={props.onSwitch} onOverSpace={props.onOverSpace} />
      ) : null}
      {names.map((rect, index) =>
        renaming?.index === index ? (
          <RenameField
            key={`rename-${index}`}
            index={index}
            rect={rect}
            text={renaming.text}
            onChange={(text) => setRenaming({ index, text })}
            onSubmit={(text) => finishRename(true, text)}
            onCancel={() => finishRename(false, "")}
          />
        ) : (
          <RowName
            key={`space-${index}`}
            testID={`space-${index + 1}`}
            rect={rect}
            label={labels[index] ?? ""}
            isCurrent={index === current}
            showsClose={showsClose(index)}
            onPress={() => pressName(index)}
            onHoverChange={(over) => {
              hover(index, setOverLabel)(over);
              props.onOverSpace(index, over);
            }}
          />
        ),
      )}
      {names.map((rect, index) =>
        showsClose(index) ? (
          <RowClose
            key={`close-${index}`}
            testID={`space-${index + 1}-remove`}
            rect={{ x: rect.x, y: rect.y, width: CLOSE, height: CLOSE }}
            onPress={() => props.onRemove(index)}
            onHoverChange={(over) => {
              hover(index, setOverClose)(over);
              props.onHover(over, `close-${index}`);
            }}
          />
        ) : null,
      )}
      {shape.layout.add ? <RowAdd rect={shape.layout.add} onPress={props.onAdd} /> : null}
    </View>
  );
}
