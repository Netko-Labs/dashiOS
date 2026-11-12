/**
 * The grid of tiles (layout.ts places them; tiles.tsx draws each). In edit
 * mode every tile wears one "−" mark at its top left, drawn in a layer of
 * its own over every tile and the keyboard's ring, so a tile that grows or
 * moves under it (a slider laid flat) never covers it; a click switches it
 * between its sizes (round ↔ wide, tall ↔ flat), and a drag moves it: the
 * grid reflows under the pointer as it goes, so where it lands is what is
 * shown. The tiles' own presses are off meanwhile.
 */

import { type Bounds, Svg, View } from "@mirinjs/metal";
import { type ReactNode, useRef } from "react";
import { useControlColors } from "../../shared/controls/palette.ts";
import { MINUS } from "../glyphs.ts";
import { frameOf, GRID, gridHeight, type Placed, tileAt } from "../layout.ts";
import { TileFrame } from "../tiles.tsx";

/** How far the pointer goes before a press is a drag. */
const DRAG_SLOP = 6;

export interface EditHandlers {
  onRemove(id: string): void;
  onResize(id: string): void;
  /** `id` dragged over `over`: it takes that place. */
  onMove(id: string, over: string): void;
}

/** The "−" on a tile in edit mode: ink, round, 20 across, 5 out from the corner. */
export const REMOVE_MARK = { size: 20, out: 5 } as const;

/** Where a tile's "−" sits in the grid: 5 out from the tile's top left. */
export function removeMarkAt(frame: { left: number; top: number }): { left: number; top: number } {
  return { left: frame.left - REMOVE_MARK.out, top: frame.top - REMOVE_MARK.out };
}

function RemoveMark({ id, frame, onRemove }: { id: string; frame: { left: number; top: number }; onRemove: (id: string) => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={`cc-remove:${id}`}
      onPointer={(event) => event.phase === "up" && onRemove(id)}
      accessibilityRole="button"
      accessibilityLabel="Remove"
      style={{
        position: "absolute",
        ...removeMarkAt(frame),
        width: REMOVE_MARK.size,
        height: REMOVE_MARK.size,
        borderRadius: REMOVE_MARK.size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.text,
      }}
    >
      <Svg markup={MINUS} size={12} color={colors.surface} />
    </View>
  );
}

/** What takes a tile's presses in edit mode: a click resizes, a drag moves. */
function EditCover({ id, placed, origin, edit }: { id: string; placed: readonly Placed[]; origin: () => Bounds | null; edit: EditHandlers }) {
  /** The press, and the tile it last traded places with: the reflow moves tiles under a still pointer, and they mustn't trade back. */
  const press = useRef<{ x: number; y: number; dragging: boolean; over: string | null } | null>(null);
  return (
    <View
      testID={`cc-edit:${id}`}
      onPointer={(event) => {
        if (event.phase === "down") {
          press.current = { x: event.x, y: event.y, dragging: false, over: null };
          return;
        }
        const start = press.current;
        if (!start) return;
        if (event.phase === "move") {
          if (!start.dragging && Math.hypot(event.x - start.x, event.y - start.y) < DRAG_SLOP) return;
          start.dragging = true;
          const grid = origin();
          if (!grid) return;
          const over = tileAt(placed, event.x - grid.x, event.y - grid.y);
          if (over && over !== id && over !== start.over) {
            start.over = over;
            edit.onMove(id, over);
          }
          return;
        }
        press.current = null;
        if (!start.dragging) edit.onResize(id);
      }}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
    />
  );
}

export function ControlGrid({
  placed,
  focused,
  editing,
  radiusOf,
  renderTile,
}: {
  placed: readonly Placed[];
  /** The tile the keyboard is on, with its ring shown; null for none. */
  focused: string | null;
  /** Edit mode's handlers; null outside it. */
  editing: EditHandlers | null;
  /** A tile's corner radius now (for its ring). */
  radiusOf: (id: string) => number;
  renderTile: (tile: Placed, frame: { width: number; height: number }) => ReactNode;
}) {
  const bounds = useRef<Bounds | null>(null);
  return (
    <View
      testID="cc-grid"
      onLayout={(laid) => {
        bounds.current = laid;
      }}
      style={{ position: "relative", height: gridHeight(placed), width: GRID.width - 2 * GRID.padding }}
    >
      {placed.map((tile) => {
        const frame = frameOf(tile);
        return (
          <TileFrame key={tile.id} frame={frame} focused={focused === tile.id} radius={radiusOf(tile.id)}>
            {renderTile(tile, frame)}
            {editing && <EditCover id={tile.id} placed={placed} origin={() => bounds.current} edit={editing} />}
          </TileFrame>
        );
      })}
      {/* After every tile and ring: the marks are drawn last, so nothing in the grid covers one. */}
      {editing && placed.map((tile) => <RemoveMark key={`remove:${tile.id}`} id={tile.id} frame={frameOf(tile)} onRemove={editing.onRemove} />)}
    </View>
  );
}
