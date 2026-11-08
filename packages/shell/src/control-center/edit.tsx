/**
 * Edit mode's own parts under the grid (docs/design.html, "Control Center"):
 * Add, listing every control that is on this machine and not in the panel,
 * an applet's under its name, each with an ink "+" (green only ever means
 * "on"); and the footer, Reset set apart from Cancel and Done, all three
 * ink: Done filled, as the button that goes ahead, the others outlined.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useControlColors } from "../shared/controls/palette.ts";
import { PLUS } from "./glyphs.ts";
import { COLUMN, GRID } from "./layout.ts";

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
        gap: 6,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: GRID.radius,
        borderWidth: 1.5,
        borderColor: colors.line,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.knobOff }}>
        <Svg markup={entry.glyph} size={16} color={colors.text} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.text }}>
          {entry.title}
        </Text>
        {entry.from && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted }}>
            {entry.from}
          </Text>
        )}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.text }}>
        <Svg markup={PLUS} size={12} color={colors.surface} />
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID.gap, maxHeight: 2 * GRID.row + GRID.gap + 28, overflow: "scroll" }}>
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
        // Ink, never green: Done is an action, and green only means "on".
        backgroundColor: primary ? colors.text : "#00000000",
        borderWidth: primary ? 0 : 1.5,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: primary ? colors.surface : colors.text }}>{label}</Text>
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
