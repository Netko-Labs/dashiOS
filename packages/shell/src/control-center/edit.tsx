/**
 * Edit mode's own parts under the grid (docs/design.html, "Control Center"):
 * Add, listing every control that is on this machine and not in the panel,
 * an applet's under its name, each with an ink "+" (green only ever means
 * "on"); and the footer, Reset set apart from Cancel and Done.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { PLUS } from "./glyphs.ts";
import { COLUMN, GRID } from "./layout.ts";
import { useControlColors } from "./palette.ts";

export interface AddEntry {
  id: string;
  title: string;
  /** The applet it comes from; null for Dashi's own. */
  from: string | null;
  glyph: string;
}

function AddTile({ entry, onAdd }: { entry: AddEntry; onAdd: (id: string) => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={`cc-add:${entry.id}`}
      onPress={() => onAdd(entry.id)}
      accessibilityRole="button"
      accessibilityLabel={`Add ${entry.title}`}
      style={{
        // Dashi's own two to a row; an applet's takes the row, for its name.
        width: entry.from ? GRID.width - 2 * GRID.padding : 2 * COLUMN + GRID.gap,
        height: GRID.row,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 6,
        paddingRight: 12,
        borderRadius: GRID.radius,
        borderWidth: 1.5,
        borderColor: colors.line,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.knobOff }}>
        <Svg markup={entry.glyph} size={18} color={colors.text} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {entry.title}
        </Text>
        {entry.from && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted }}>
            {entry.from}
          </Text>
        )}
      </View>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.text }}>
        <Svg markup={PLUS} size={13} color={colors.surface} />
      </View>
    </View>
  );
}

export function AddList({ entries, onAdd }: { entries: readonly AddEntry[]; onAdd: (id: string) => void }) {
  const colors = useControlColors();
  if (entries.length === 0) return null;
  return (
    <View testID="cc-add-list" style={{ flexDirection: "column", marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderColor: colors.line }}>
      <View style={{ paddingLeft: 6, paddingBottom: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.muted }}>ADD</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID.gap, maxHeight: 4 * GRID.row + 3 * GRID.gap, overflow: "scroll" }}>
        {entries.map((entry) => (
          <AddTile key={entry.id} entry={entry} onAdd={onAdd} />
        ))}
      </View>
    </View>
  );
}

function Pill({ testID, label, primary = false, onPress }: { testID: string; label: string; primary?: boolean; onPress: () => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={{
        height: 34,
        borderRadius: 17,
        paddingLeft: 14,
        paddingRight: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary ? colors.on : "#00000000",
        borderWidth: primary ? 0 : 1.5,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: primary ? colors.onInk : colors.text }}>{label}</Text>
    </View>
  );
}

export function EditFooter({ onReset, onCancel, onDone }: { onReset: () => void; onCancel: () => void; onDone: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingLeft: 4, paddingRight: 4 }}>
      <Pill testID="cc-edit-reset" label="Reset" onPress={onReset} />
      <View style={{ flex: 1 }} />
      <Pill testID="cc-edit-cancel" label="Cancel" onPress={onCancel} />
      <Pill testID="cc-edit-done" label="Done" primary onPress={onDone} />
    </View>
  );
}
