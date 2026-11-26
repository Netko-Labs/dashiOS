/**
 * Editing's one bar, at the bottom (round five, #26): Add · Done, a capsule of regular glass holding two
 * of the kit's Buttons in the inks look, 28 tall (frost-objects board 22): Add outlined in the glass
 * control edge, Done filled in ink.
 */

import { Button, CLEAR, Frosted, pill, SPACE, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { glyph } from "../shared/inks/index.ts";
import { useWidgetEnv } from "./env.tsx";
import { COLUMN_WIDTH } from "./layout.ts";

/** The bar's measures: its two buttons 28 tall (the inks look's regular), 2 in from the bar's edge. */
const EDIT_BAR = { button: 28, inset: SPACE.xxs } as const;

export function EditBar({ onAdd, onDone }: { onAdd: () => void; onDone: () => void }) {
  return (
    <View style={{ width: COLUMN_WIDTH, alignItems: "center" }}>
      <Frosted
        level="regular"
        testID="edit-bar"
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, padding: EDIT_BAR.inset, borderRadius: pill(EDIT_BAR.button + 2 * EDIT_BAR.inset) }}
      >
        <Pills onAdd={onAdd} onDone={onDone} />
      </Frosted>
    </View>
  );
}

/** The two buttons, on the bar's glass (they read its control edge). */
function Pills({ onAdd, onDone }: { onAdd: () => void; onDone: () => void }) {
  const { inks } = useWidgetEnv();
  const ink = { ink: inks.text.ink, ground: CLEAR, edge: useColors().controlEdge, fill: inks.text.ink, onFill: inks.paper };
  return (
    <>
      <Button testID="edit-add" label="Add" look="inks" inks={ink} glyph={glyph("plus")} onPress={onAdd} />
      <Button testID="edit-done" label="Done" look="inks" inks={ink} primary onPress={onDone} />
    </>
  );
}
