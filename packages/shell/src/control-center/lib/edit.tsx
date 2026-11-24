/**
 * Edit mode's own parts under the grid (docs/design.html, "Control Center"):
 * Add, listing every control that is on this machine and not in the panel,
 * an applet's under its name, each with an ink "+" (the on colour only ever
 * means "on"); and the footer, Reset set apart from Cancel and Done, the
 * kit's panel buttons: Done ink, as the button that goes ahead, the others
 * outlined.
 */

import { BUTTON, Button, Knob, KnobButton, SPACE, TILE, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { DEFAULT_LAYOUT } from "../catalog.ts";
import { PLUS } from "../glyphs.ts";
import { addItem, COLUMN, GRID, type Layout, type TileSize } from "../layout.ts";
import type { LayoutStore } from "../layout-store.ts";

/** An add tile's knob and glyph, its "+" and its glyph, and how much of a third row of them shows under two. */
const ADD = { knob: 36, glyph: 16, mark: 22, markGlyph: 12, peek: 28 } as const;

export interface AddEntry {
  id: string;
  title: string;
  /** The applet it comes from; null for Dashi's own. */
  from: string | null;
  glyph: string;
}

/** An add tile: its knob and name, an ink "+" that is the button (the whole tile takes a press too). */
function AddTile({ entry, onAdd }: { entry: AddEntry; onAdd: (id: string) => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={`cc-add:${entry.id}`}
      onPress={() => onAdd(entry.id)}
      style={{
        // Dashi's own two to a row; an applet's takes the row, for its name.
        width: entry.from ? GRID.width - 2 * GRID.padding : 2 * COLUMN + GRID.gap,
        height: GRID.row,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.s,
        paddingLeft: SPACE.s,
        paddingRight: SPACE.m,
        borderRadius: TILE.radius.off,
        borderWidth: BUTTON.panel.edge,
        borderColor: colors.line,
      }}
    >
      <Knob glyph={entry.glyph} size={ADD.knob} glyphSize={ADD.glyph} ground={colors.knobOff} />
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
          {entry.title}
        </Text>
        {entry.from && (
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.muted }}>
            {entry.from}
          </Text>
        )}
      </View>
      <KnobButton
        testID={`cc-add:${entry.id}:plus`}
        glyph={PLUS}
        label={`Add ${entry.title}`}
        inked
        size={ADD.mark}
        glyphSize={ADD.markGlyph}
        onPress={() => onAdd(entry.id)}
      />
    </View>
  );
}

export function AddList({ entries, onAdd }: { entries: readonly AddEntry[]; onAdd: (id: string) => void }) {
  const colors = useControlColors();
  if (entries.length === 0) return null;
  return (
    <View testID="cc-add-list" style={{ flexDirection: "column", marginTop: SPACE.xs, paddingTop: SPACE.gap, borderTopWidth: 1, borderColor: colors.line }}>
      <View style={{ paddingLeft: SPACE.s, paddingBottom: SPACE.m }}>
        <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.muted }}>Add</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID.gap, maxHeight: 2 * GRID.row + GRID.gap + ADD.peek, overflow: "scroll" }}>
        {entries.map((entry) => (
          <AddTile key={entry.id} entry={entry} onAdd={onAdd} />
        ))}
      </View>
    </View>
  );
}

export function EditFooter({ onReset, onCancel, onDone }: { onReset: () => void; onCancel: () => void; onDone: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, paddingTop: SPACE.gap, paddingHorizontal: SPACE.xs }}>
      <Button look="panel" testID="cc-edit-reset" label="Reset" onPress={onReset} />
      <View style={{ flex: 1 }} />
      <Button look="panel" testID="cc-edit-cancel" label="Cancel" onPress={onCancel} />
      <Button look="panel" testID="cc-edit-done" label="Done" primary onPress={onDone} />
    </View>
  );
}

/**
 * Edit mode's footer under the Control Center's grid (panel.tsx): the Add
 * list of tiles not yet here, then Reset, Cancel, and Done. Done saves the
 * draft; Cancel throws it away; an embedded editor closes after either.
 */
export function PanelEditor(props: {
  draft: Layout;
  layout: LayoutStore;
  controls: { addable(layout: Layout): AddEntry[]; sizesOf(id: string): readonly TileSize[] };
  embedded: boolean;
  setDraft(layout: Layout | null): void;
  onClose(): void;
}) {
  const { draft, controls, setDraft } = props;
  return (
    <>
      <AddList entries={controls.addable(draft)} onAdd={(id) => setDraft(addItem(draft, id, controls.sizesOf(id)[0] ?? "round"))} />
      <EditFooter
        onReset={() => setDraft(DEFAULT_LAYOUT)}
        onCancel={() => {
          setDraft(null);
          if (props.embedded) props.onClose();
        }}
        onDone={() => {
          props.layout.set(draft);
          setDraft(null);
          if (props.embedded) props.onClose();
        }}
      />
    </>
  );
}
