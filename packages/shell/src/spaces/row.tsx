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
 * picture, a name, or the + moves there (start.tsx).
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useRef, useState, useSyncExternalStore } from "react";
import { KeyCatcher } from "../overlay.tsx";
import type { Desktops } from "./controller.ts";
import { type Rect, ROW } from "./model.ts";
import { lifted, rowShape, SHELF_HEIGHT } from "./shelf.ts";

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
  onHover(hovered: boolean): void;
  /** The pointer came onto Desktop `index`'s picture or name, or left it (where a dragged window would go). */
  onOverSpace(index: number, over: boolean): void;
  /** Esc while the row has the keyboard (after a click or a rename): leave Mission Control. */
  onEscape(): void;
}

const CLOSE = 20;
/** A second press on a name this soon is a double-click: rename instead of going there. */
const DOUBLE_CLICK_MS = 350;
/** The frame around a picture, outside it (the picture covers the inside). */
const RING = 2;

const at = (rect: Rect) => ({ position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });

export function SpacesRow(props: RowProps) {
  const { width, aspect } = props;
  const colors = useColors();
  const { count, current, labels } = useSyncExternalStore(props.desktops.subscribe, props.desktops.getSnapshot);
  const view = useSyncExternalStore(props.view.subscribe, props.view.getSnapshot);
  const shape = rowShape(view.open, width, count, aspect);
  const names = shape.layout.labels;
  // The × shows while the pointer is on a name or on its ×.
  const [overLabel, setOverLabel] = useState<number | null>(null);
  const [overClose, setOverClose] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; text: string } | null>(null);
  const lastPress = useRef<{ index: number; at: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const showsClose = (index: number) => count > 1 && renaming === null && (overLabel === index || overClose === index);
  const hover = (index: number, set: typeof setOverLabel) => (hovered: boolean) => set((was) => (hovered ? index : was === index ? null : was));

  const pressName = (index: number) => {
    const last = lastPress.current;
    if (last) clearTimeout(last.timer);
    if (last && last.index === index && Date.now() - last.at < DOUBLE_CLICK_MS) {
      lastPress.current = null;
      setRenaming({ index, text: labels[index] ?? "" });
      return;
    }
    lastPress.current = { index, at: Date.now(), timer: setTimeout(() => props.onSwitch(index), DOUBLE_CLICK_MS) };
  };
  const finishRename = (keep: boolean, text: string) => {
    if (renaming && keep) props.onRename(renaming.index, text);
    setRenaming(null);
  };

  return (
    <View style={{ width, height: view.open ? SHELF_HEIGHT : ROW.height }} onHoverChange={(hovered) => props.onHover(hovered)}>
      {view.open ? <View style={{ ...at({ x: 0, y: 0, width, height: SHELF_HEIGHT }), backgroundColor: colors.dock }} /> : null}
      {renaming === null ? <KeyCatcher onKey={(key) => key === "Escape" && props.onEscape()} /> : null}
      {shape.open
        ? shape.layout.pictures.map((picture, index) => {
            const rect = view.lifted === index ? lifted(picture) : picture;
            return (
              <View
                key={`picture-${index}`}
                testID={`space-${index + 1}-picture`}
                onPress={() => props.onSwitch(index)}
                onHoverChange={(over) => props.onOverSpace(index, over)}
                style={{
                  ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
                  borderRadius: 8,
                  borderWidth: RING,
                  borderColor: index === current || view.lifted === index ? colors.selection : colors.dockBorder,
                  shadow: view.lifted === index ? "xl" : "md",
                }}
              />
            );
          })
        : null}
      {names.map((rect, index) =>
        renaming?.index === index ? (
          <View key={`rename-${index}`} style={{ ...at(rect), justifyContent: "center" }}>
            <TextInput
              testID={`space-${index + 1}-name`}
              value={renaming.text}
              autoFocus
              onChangeText={(text) => setRenaming({ index, text })}
              onSubmitEditing={(text) => finishRename(true, text)}
              onKeyPress={(key) => key === "Escape" && finishRename(false, "")}
              style={{
                width: rect.width,
                height: rect.height,
                fontSize: 13,
                color: colors.text,
                backgroundColor: colors.launcher,
                borderRadius: rect.height / 2,
                borderColor: colors.selection,
                padding: 6,
              }}
            />
          </View>
        ) : (
          <View
            key={`space-${index}`}
            testID={`space-${index + 1}`}
            onPress={() => pressName(index)}
            onHoverChange={(over) => {
              hover(index, setOverLabel)(over);
              props.onOverSpace(index, over);
            }}
            style={{
              ...at(rect),
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 10,
              borderRadius: rect.height / 2,
              backgroundColor: index === current ? colors.launcher : colors.dock,
              borderWidth: index === current ? 2 : 1,
              borderColor: index === current ? colors.selection : colors.dockBorder,
              shadow: "md",
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: index === current ? "semibold" : "normal", color: colors.text }}>
              {labels[index] ?? ""}
            </Text>
          </View>
        ),
      )}
      {names.map((rect, index) =>
        showsClose(index) ? (
          <View
            key={`close-${index}`}
            testID={`space-${index + 1}-remove`}
            occlude
            onPress={() => props.onRemove(index)}
            onHoverChange={hover(index, setOverClose)}
            style={{
              ...at({ x: rect.x - CLOSE / 4, y: rect.y - CLOSE / 4, width: CLOSE, height: CLOSE }),
              borderRadius: CLOSE / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.osdOn,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "bold", color: colors.menu }}>×</Text>
          </View>
        ) : null,
      )}
      {shape.layout.add ? (
        <View
          testID="space-add"
          onPress={props.onAdd}
          style={{
            ...at(shape.layout.add),
            borderRadius: Math.min(shape.layout.add.width, shape.layout.add.height) / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.dock,
            borderWidth: 1,
            borderColor: colors.dockBorder,
            shadow: "md",
          }}
        >
          <Text style={{ fontSize: 20, color: colors.text }}>+</Text>
        </View>
      ) : null}
    </View>
  );
}
