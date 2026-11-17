/**
 * Editing the widgets (round five, frame 3): the header says the keyboard's
 * path; each widget shows a minus to take it away, a grab cue on hover (drag
 * the card to move it), and a handle at its right edge that steps its size;
 * sizes are words, and the chosen widget's tag says "Weather · mizu · Small
 * → Wide". One bar at the bottom: Add · Done. The gallery opens beside the
 * column (gallery.tsx).
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useRef, useState } from "react";
import { DASHI_WIDGETS, resizeTag, widgetInfo } from "./catalog.ts";
import { WidgetColumn } from "./column.tsx";
import { EditBar } from "./edit-bar.tsx";
import { useWidgetEnv } from "./env.tsx";
import { Gallery } from "./gallery.tsx";
import { packColumn, sizeWord } from "./layout.ts";
import { useSource } from "./lib/data.ts";
import { cycleSize, dropIndex, editKey } from "./lib/edit-keys.ts";
import type { Placed, Placement, WidgetInfo, WidgetSize } from "./types.ts";

export const EDIT_HINT = "Tab · ⌥ arrows move · ⌥⇧ arrows resize";

/** The chosen widget's tag: "Weather · mizu · Small", or "Small → Wide" right after a resize. */
export function tagOf(info: WidgetInfo | null, from: WidgetSize | null, size: WidgetSize): string {
  if (!info) return "";
  if (from && from !== size) return resizeTag(info, from, size);
  return [info.name, ...(info.ink ? [info.ink] : []), sizeWord(size)].join(" · ");
}

interface DecorationProps {
  placed: Placed;
  tag: string;
  resizable: boolean;
  chosen: boolean;
  onChoose: () => void;
  onRemove: () => void;
  onResize: () => void;
  onDrag: (phase: "down" | "move" | "up", y: number) => void;
}

function Decoration({ placed, tag, resizable, chosen, onChoose, onRemove, onResize, onDrag }: DecorationProps) {
  const colors = useColors();
  const { inks } = useWidgetEnv();
  const [hover, setHover] = useState(false);
  const { width, height } = placed;
  return (
    <View
      style={{ position: "absolute", left: 0, top: 0, width, height }}
      onHoverChange={setHover}
      onPointer={(event) => onDrag(event.phase, event.y)}
      onPress={onChoose}
    >
      {chosen ? (
        <View style={{ position: "absolute", left: -4, top: -4, right: -4, bottom: -4, borderRadius: 17, borderWidth: 2, borderColor: colors.focusRing }} />
      ) : null}
      {hover || chosen ? (
        <View style={{ position: "absolute", top: 8, left: width / 2 - 14, width: 28, height: 4, borderRadius: 2, backgroundColor: inks.text.tertiary }} />
      ) : null}
      <View
        testID={`remove:${placed.placement.id}`}
        onPress={onRemove}
        style={{
          position: "absolute",
          left: -7,
          top: -7,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: inks.text.ink,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 8, height: 1.6, borderRadius: 1, backgroundColor: inks.paper }} />
      </View>
      {resizable ? (
        <View
          testID={`resize:${placed.placement.id}`}
          onPress={onResize}
          style={{ position: "absolute", right: -3, top: height / 2 - 15, width: 5, height: 30, borderRadius: 2, backgroundColor: inks.text.ink }}
        />
      ) : null}
      {chosen && tag ? (
        <View
          style={{
            position: "absolute",
            left: 10,
            bottom: 8,
            height: 20,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 10,
            backgroundColor: inks.text.ink,
            justifyContent: "center",
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: inks.paper }}>
            {tag}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Dragging a widget by its card: it follows the pointer and lands where its middle is let go. */
function useDragToMove(placements: readonly Placement[], move: (id: string, to: number) => void) {
  const drag = useRef<{ id: string; startY: number; boxY: number } | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const onDrag = (placed: Placed, phase: "down" | "move" | "up", y: number) => {
    if (phase === "down") drag.current = { id: placed.placement.id, startY: y, boxY: placed.y };
    else if (phase === "move" && drag.current) setDragY(y);
    else if (phase === "up" && drag.current) {
      if (Math.abs(y - drag.current.startY) > 6) {
        const boxes = packColumn(placements).map((each) => ({ id: each.placement.id, y: each.y, height: each.height }));
        move(drag.current.id, dropIndex(boxes, drag.current.id, drag.current.boxY + y - drag.current.startY + placed.height / 2));
      }
      drag.current = null;
      setDragY(null);
    }
  };
  const offset = (id: string): number | null => (drag.current?.id === id && dragY !== null ? dragY - drag.current.startY : null);
  return { onDrag, offset };
}

/** Which widget is chosen, the size it had before a resize, and what the keys and handles do to the store. */
function useEditing(placements: readonly Placement[], onDone: () => void) {
  const { hub } = useWidgetEnv();
  const infos = useSource(hub?.extensions, []).map((each) => each.info);
  const store = hub?.store;
  const [chosen, setChosen] = useState<string | null>(null);
  const [from, setFrom] = useState<WidgetSize | null>(null);
  const sizesOf = (placement: Placement) => widgetInfo(placement.kind, infos)?.sizes ?? [placement.size];
  const choose = (id: string | null) => {
    setChosen(id);
    setFrom(null);
  };
  const resize = (placement: Placement, size: WidgetSize) => {
    if (from === null || chosen !== placement.id) setFrom(placement.size);
    setChosen(placement.id);
    store?.update(placement.id, { size });
  };
  const key = (pressed: { key: string; alt: boolean; shift: boolean }) => {
    const said = editKey(placements, chosen, pressed, sizesOf);
    if (said.do === "done") onDone();
    else if (said.do === "select") choose(said.id);
    else if (said.do === "move") store?.move(said.id, said.to);
    else if (said.do === "remove") store?.remove(said.id);
    else if (said.do === "resize") {
      const placement = placements.find((each) => each.id === said.id);
      if (placement) resize(placement, said.size);
    }
  };
  return { infos, store, chosen, from, sizesOf, choose, resize, key };
}

export function EditWidgets({
  placements,
  onDone,
  onGallery,
}: {
  placements: readonly Placement[];
  onDone: () => void /** Add: the gallery opens or closes beside the column. */;
  onGallery: () => void;
}) {
  const { inks } = useWidgetEnv();
  const edit = useEditing(placements, onDone);
  const { onDrag, offset } = useDragToMove(placements, (id, to) => edit.store?.move(id, to));
  const decorate = (placed: Placed, tile: ReactNode) => {
    const { placement } = placed;
    const moved = offset(placement.id);
    const info = widgetInfo(placement.kind, edit.infos);
    return (
      <View style={{ width: placed.width, height: placed.height, ...(moved === null ? {} : { top: moved, opacity: 0.85 }) }}>
        {tile}
        <Decoration
          placed={placed}
          tag={tagOf(info, edit.chosen === placement.id ? edit.from : null, placement.size)}
          resizable={(info?.sizes.length ?? 0) > 1}
          chosen={edit.chosen === placement.id}
          onChoose={() => edit.choose(placement.id)}
          onRemove={() => edit.store?.remove(placement.id)}
          onResize={() => edit.resize(placement, cycleSize(edit.sizesOf(placement), placement.size))}
          onDrag={(phase, y) => onDrag(placed, phase, y)}
        />
      </View>
    );
  };
  return (
    <View style={{ flexDirection: "column", gap: 10 }}>
      <View onKeyDown={edit.key} style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0 }} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 16 }}>
        <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: inks.text.ink }}>EDIT WIDGETS</Text>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: inks.text.secondary }}>
          {EDIT_HINT}
        </Text>
      </View>
      <WidgetColumn placements={placements} testID="widget-column-edit" decorate={decorate} />
      <EditBar onAdd={onGallery} onDone={onDone} />
    </View>
  );
}

/** The gallery beside the column, for every widget there is; a press on a size adds it. */
export function GalleryPanel({ placements, onClose }: { placements: readonly Placement[]; onClose: () => void }) {
  const { hub } = useWidgetEnv();
  const extensions = useSource(hub?.extensions, []);
  const store = hub?.store;
  const weather = placements.find((each) => each.kind === "weather");
  return (
    <Gallery
      infos={[...DASHI_WIDGETS, ...extensions.map((each) => each.info)]}
      onAdd={(info, size) => void store?.add(info.kind, size)}
      onClose={onClose}
      mayGoOnAir={{ on: weather?.mayGoOnAir === true, set: (on) => weather && store?.update(weather.id, { mayGoOnAir: on }) }}
    />
  );
}
