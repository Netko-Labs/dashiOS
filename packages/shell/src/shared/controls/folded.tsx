/**
 * Choices as segmented pills that fold past five (fold.ts): the four
 * commonest, then a "More" pill with a chevron in the same track, on the
 * pills' line, which opens every choice in Dashi's menu (@dashi/ui
 * `PopupMenu`), the one in use ticked, hung by its right edge under the
 * pill's. The pill is washed while the menu is open. A row of five or fewer
 * is plain `Segmented`. "More" is one treatment everywhere (docs/design.html,
 * "More"): the word and a chevron, never an underline or an ellipsis.
 */

import { PopupMenu, useWindowLayer } from "@dashi/ui";
import { type Bounds, createPortal } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { foldChoices, moreMenuOrigin } from "./fold.ts";
import { Segmented, type SegmentedProps } from "./inputs.tsx";

export interface FoldedChoicesProps<T extends string | number> extends SegmentedProps<T> {
  /** The commonest choices, shown as pills when the row folds; the first four otherwise. */
  common?: readonly T[];
}

export function FoldedChoices<T extends string | number>({ options, value, onChange, testID, disabled, common }: FoldedChoicesProps<T>) {
  const layer = useWindowLayer();
  const [open, setOpen] = useState<Bounds | null>(null);
  // Pointer presses carry the pill's bounds; its last layout stands in for a key's.
  const laid = useRef<Bounds | null>(null);
  const fold = foldChoices(options, value, common);
  const more = fold.more
    ? { open: open !== null, onPress: (bounds: Bounds | undefined) => setOpen(bounds ?? laid.current), onLayout: (bounds: Bounds) => (laid.current = bounds) }
    : undefined;
  const menu =
    open === null
      ? null
      : (() => {
          const at = moreMenuOrigin(open);
          const node = (
            <PopupMenu
              testID={`${testID}:menu`}
              x={at.x}
              y={at.y}
              anchor="end"
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
    <>
      <Segmented options={fold.shown} value={value} onChange={onChange} testID={testID} {...(disabled ? { disabled } : {})} {...(more ? { more } : {})} />
      {menu}
    </>
  );
}
