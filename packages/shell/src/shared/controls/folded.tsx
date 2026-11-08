/**
 * Choices as segmented pills that fold past five (fold.ts): the four
 * commonest, then "More…", an underlined ink link that opens every choice
 * in Dashi's menu (@dashi/ui `PopupMenu`, the pop-up button's), the one in
 * use ticked. A row of five or fewer is plain `Segmented`.
 */

import { PopupMenu, useWindowLayer } from "@dashi/ui";
import { type Bounds, createPortal, Text, View } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { foldChoices } from "./fold.ts";
import { Segmented, type SegmentedProps } from "./inputs.tsx";
import { useControlColors } from "./palette.ts";

export interface FoldedChoicesProps<T extends string | number> extends SegmentedProps<T> {
  /** The commonest choices, shown as pills when the row folds; the first four otherwise. */
  common?: readonly T[];
}

/** Where the menu opens: under the link, its left edge at the link's. */
const below = (link: Bounds): { x: number; y: number } => ({ x: Math.round(link.x), y: Math.round(link.y + link.height + 4) });

export function FoldedChoices<T extends string | number>({ options, value, onChange, testID, disabled, common }: FoldedChoicesProps<T>) {
  const colors = useControlColors();
  const layer = useWindowLayer();
  const [open, setOpen] = useState<Bounds | null>(null);
  const laid = useRef<Bounds | null>(null);
  const fold = foldChoices(options, value, common);
  const pills = <Segmented options={fold.shown} value={value} onChange={onChange} testID={testID} {...(disabled ? { disabled } : {})} />;
  if (!fold.more) return pills;
  const menu =
    open === null
      ? null
      : (() => {
          const at = below(open);
          const node = (
            <PopupMenu
              testID={`${testID}:menu`}
              x={at.x}
              y={at.y}
              items={options.map((option) => ({
                label: option.label,
                checked: option.value === value,
                onPress: () => option.value !== value && onChange(option.value),
              }))}
              onClose={() => setOpen(null)}
            />
          );
          return layer === null ? node : createPortal(node, layer);
        })();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
      {pills}
      <View
        testID={`${testID}:more`}
        focusable={!disabled}
        accessibilityRole="button"
        accessibilityLabel="More choices"
        onPress={disabled ? undefined : (event) => setOpen(event.bounds ?? laid.current)}
        onLayout={(bounds) => {
          laid.current = bounds;
        }}
        style={{ flexShrink: 0, borderRadius: 4, focusRingColor: colors.focus }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.text, textDecorationLine: "underline" }}>More…</Text>
      </View>
      {menu}
    </View>
  );
}
