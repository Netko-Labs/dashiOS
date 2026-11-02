/**
 * A dropdown, the way macOS draws one: a glass panel, rows with the label
 * on the left and the shortcut on the right, thin separators, disabled rows
 * greyed, a check in the gutter for the chosen one. The pointer or the
 * arrow keys highlight a row; a click or Enter chooses it.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { CHECK, Shortcut, useColors } from "@dashi/ui";
import { KeyCatcher } from "../overlay.tsx";
import { isEnabled, type MenuAction, type MenuEntry, stepHighlight } from "./model.ts";

export const DROPDOWN = { minWidth: 230, maxWidth: 360, rowHeight: 22, radius: 10, padding: 5, gutter: 18 } as const;

/** Muted ink for disabled rows. */

function Row<A>({
  entry,
  gutter,
  highlighted,
  onHover,
  onChoose,
}: {
  entry: Extract<MenuEntry<A>, { kind: "item" }>;
  gutter: boolean;
  highlighted: boolean;
  onHover: (hovered: boolean) => void;
  onChoose: (action: A) => void;
}) {
  const colors = useColors();
  const enabled = entry.action !== null;
  const ink = !enabled ? colors.textDisabled : highlighted ? "#ffffff" : colors.text;
  const keysInk = !enabled ? colors.textDisabled : highlighted ? "#ffffffcc" : colors.textMuted;
  return (
    <View
      testID={`menu-row:${entry.label}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 28,
        height: DROPDOWN.rowHeight,
        paddingLeft: 6,
        paddingRight: 10,
        borderRadius: 5,
        backgroundColor: enabled && highlighted ? colors.selection : "#00000000",
      }}
      onHoverChange={enabled ? onHover : undefined}
      onPress={enabled ? () => entry.action && onChoose(entry.action) : undefined}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
        {gutter && (
          <View style={{ width: DROPDOWN.gutter - 4, flexShrink: 0, alignItems: "center" }}>
            {entry.checked && <Svg markup={CHECK} size={12} color={ink} />}
          </View>
        )}
        <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
          {entry.label}
        </Text>
      </View>
      {entry.keys && <Shortcut keys={entry.keys} color={keysInk} size={12} />}
    </View>
  );
}

export function DropdownMenu<A>({
  entries,
  x,
  above,
  onChoose,
  onClose,
}: {
  entries: readonly MenuEntry<A>[];
  /** The panel's left edge, in screen pixels (its center with `above`). */
  x: number;
  /**
   * Opens upward instead of down from the menu bar, centered on `x`, with
   * its bottom edge this far above the screen's bottom edge (the Dock's menus).
   */
  above?: number;
  onChoose: (action: A) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [highlight, setHighlight] = useState<number | null>(null);
  const gutter = entries.some((entry) => entry.kind === "item" && entry.checked !== undefined);
  const choose = () => {
    const entry = highlight === null ? undefined : entries[highlight];
    if (entry && isEnabled(entry) && entry.kind === "item" && entry.action) onChoose(entry.action);
  };

  // Below the menu bar the panel sits at `x`; upward it is centered in the box below.
  const placement = above === undefined ? ({ position: "absolute", left: x, top: 2 } as const) : {};
  const panel = (
    <View
      occlude
      testID="menu-panel"
      style={{
        ...placement,
        minWidth: DROPDOWN.minWidth,
        maxWidth: DROPDOWN.maxWidth,
        flexDirection: "column",
        padding: DROPDOWN.padding,
        borderRadius: DROPDOWN.radius,
        backgroundColor: colors.menu,
        borderWidth: 1,
        borderColor: colors.dockBorder,
        shadow: "lg",
      }}
    >
      {entries.map((entry, index) =>
        entry.kind === "separator" ? (
          // Menus never reorder, so the index is the identity.
          <View key={index} style={{ height: 1, marginTop: 5, marginBottom: 5, marginLeft: 6, marginRight: 6, backgroundColor: colors.separator }} />
        ) : (
          <Row
            key={index}
            entry={entry}
            gutter={gutter}
            highlighted={highlight === index}
            onHover={(hovered) => setHighlight((current) => (hovered ? index : current === index ? null : current))}
            onChoose={onChoose}
          />
        ),
      )}
    </View>
  );

  return (
    <>
      <KeyCatcher
        onKey={(key) => {
          if (key === "Escape") onClose();
          else setHighlight((current) => stepHighlight(entries, current, key === "ArrowDown" ? "down" : "up"));
        }}
        onSubmit={choose}
      />
      {above === undefined ? (
        panel
      ) : (
        // A box as wide as the widest panel, so the panel centers on `x` without knowing its own width.
        <View style={{ position: "absolute", left: Math.max(8, x - DROPDOWN.maxWidth / 2), width: DROPDOWN.maxWidth, bottom: above, alignItems: "center" }}>
          {panel}
        </View>
      )}
    </>
  );
}
