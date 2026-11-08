/**
 * The grid of tiles (layout.ts places them; tiles.tsx draws each). In edit
 * mode every tile wears one "−" mark at its top left, a click switches it
 * between its sizes (round ↔ wide, tall ↔ flat), and a drag moves it: the
 * grid reflows under the pointer as it goes, so where it lands is what is
 * shown. The tiles' own presses are off meanwhile.
 */

import { type Bounds, Svg, View } from "@mirinjs/metal";
import { type ReactNode, useRef } from "react";
import { MINUS } from "./glyphs.ts";
import { frameOf, GRID, gridHeight, type Placed, tileAt } from "./layout.ts";
import { useControlColors } from "./palette.ts";
import { TileFrame } from "./tiles.tsx";

/** How far the pointer goes before a press is a drag. */
const DRAG_SLOP = 6;

export interface EditHandlers {
  onRemove(id: string): void;
  onResize(id: string): void;
  /** `id` dragged over `over`: it takes that place. */
  onMove(id: string, over: string): void;
}

/** The "−" on a tile in edit mode: ink, round, 20 across, 5 out from the corner. */
function RemoveMark({ id, onRemove }: { id: string; onRemove: (id: string) => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={`cc-remove:${id}`}
      onPointer={(event) => event.phase === "up" && onRemove(id)}
      accessibilityRole="button"
      accessibilityLabel="Remove"
      style={{
        position: "absolute",
        left: -5,
        top: -5,
        width: 20,
        height: 20,
        borderRadius: 10,
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
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  return (
    <View
      testID={`cc-edit:${id}`}
      onPointer={(event) => {
        if (event.phase === "down") {
          press.current = { x: event.x, y: event.y, dragging: false };
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
          if (over && over !== id) edit.onMove(id, over);
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
            {editing && <RemoveMark id={tile.id} onRemove={editing.onRemove} />}
          </TileFrame>
        );
      })}
    </View>
  );
}
