/**
 * What an extension's grid draws besides rows (lib/tree-rows.ts makes the
 * data): its cells, an emoji or a picture with its title under it (a
 * detail is detail-view.tsx's). In the launcher's own type, ink and
 * selection (CO-6).
 */

import { RADIUS, SPACE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Row } from "../row-model.ts";
import { type Measures, PANEL, SURFACE } from "./measures.ts";

/** A grid line is two rows tall: the picture, and its title under it. */
export const GRID_LINE_ROWS = 2;

export function GridCells({
  rows,
  columns,
  selected,
  m,
  onPress,
  onHover,
}: {
  rows: readonly Row[];
  columns: number;
  selected: string | null;
  m: Measures;
  onPress(row: Row): void;
  onHover(row: Row): void;
}) {
  const colors = useColors();
  const width = Math.floor((SURFACE.width - 2 * (PANEL.padding + 1)) / columns);
  const height = m.row * GRID_LINE_ROWS;
  const lines: Row[][] = [];
  for (let at = 0; at < rows.length; at += columns) lines.push(rows.slice(at, at + columns));
  return (
    <>
      {lines.map((line) => (
        <View key={line[0]?.id} style={{ flexDirection: "row", height }}>
          {line.map((row) => {
            const isSelected = row.id === selected;
            return (
              <View
                key={row.id}
                testID={`launcher:cell:${row.id}`}
                onPress={() => onPress(row)}
                onHoverChange={(hovered) => {
                  if (hovered) onHover(row);
                }}
                style={{
                  width,
                  height,
                  borderRadius: RADIUS.control,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: SPACE.xxs,
                  ...(isSelected ? { backgroundColor: colors.selectionWash, borderWidth: 2, borderColor: colors.selectionBar } : {}),
                }}
              >
                <Text style={{ fontSize: Math.round(m.row * 0.8) }}>{"text" in row.icon ? row.icon.text : ""}</Text>
                <View style={{ maxWidth: width - 8 }}>
                  <Text numberOfLines={1} style={{ fontSize: m.small, color: isSelected ? colors.onSelection : colors.textMuted }}>
                    {row.title}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}
