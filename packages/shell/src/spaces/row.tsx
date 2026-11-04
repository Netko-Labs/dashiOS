/**
 * The Spaces row across the top of Mission Control, as on a Mac: a label per
 * Space ("Desktop 1", "Desktop 2", …) with the current one marked, a + at the
 * right end to add one, and a × on the label under the pointer to remove it.
 * A click on a label goes to that Space; a window dragged out of the overview
 * and dropped on a label (or the +) moves there (start.tsx, from the
 * compositor's `overview-drop`). Positions come from `rowLayout`, which the
 * drop uses too, so what is hit is what is drawn.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { ROW, rowLayout, type SpacesState, spaceLabel } from "./model.ts";

export interface RowProps {
  spaces: { subscribe(listener: () => void): () => void; getSnapshot(): SpacesState };
  /** The row's width, the screen's. */
  width: number;
  onSwitch(index: number): void;
  onAdd(): void;
  onRemove(index: number): void;
}

const CLOSE = 20;

export function SpacesRow({ spaces, width, onSwitch, onAdd, onRemove }: RowProps) {
  const colors = useColors();
  const { count, current } = useSyncExternalStore(spaces.subscribe, spaces.getSnapshot);
  const layout = rowLayout(width, count);
  // The × shows while the pointer is on a label or on its ×.
  const [overLabel, setOverLabel] = useState<number | null>(null);
  const [overClose, setOverClose] = useState<number | null>(null);
  const showsClose = (index: number) => count > 1 && (overLabel === index || overClose === index);
  return (
    <View style={{ width, height: ROW.height }}>
      {layout.labels.map((rect, index) => (
        <View
          key={`space-${index}`}
          testID={`space-${index + 1}`}
          onPress={() => onSwitch(index)}
          onHoverChange={(hovered) => setOverLabel((was) => (hovered ? index : was === index ? null : was))}
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: rect.height / 2,
            backgroundColor: index === current ? colors.launcher : colors.dock,
            borderWidth: index === current ? 2 : 1,
            borderColor: index === current ? colors.selection : colors.dockBorder,
            shadow: "md",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: index === current ? "semibold" : "normal", color: colors.text }}>{spaceLabel(index)}</Text>
        </View>
      ))}
      {layout.labels.map((rect, index) =>
        showsClose(index) ? (
          <View
            key={`close-${index}`}
            testID={`space-${index + 1}-remove`}
            occlude
            onPress={() => onRemove(index)}
            onHoverChange={(hovered) => setOverClose((was) => (hovered ? index : was === index ? null : was))}
            style={{
              position: "absolute",
              left: rect.x - CLOSE / 4,
              top: rect.y - CLOSE / 4,
              width: CLOSE,
              height: CLOSE,
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
      {layout.add ? (
        <View
          testID="space-add"
          onPress={onAdd}
          style={{
            position: "absolute",
            left: layout.add.x,
            top: layout.add.y,
            width: layout.add.width,
            height: layout.add.height,
            borderRadius: layout.add.height / 2,
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
