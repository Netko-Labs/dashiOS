/**
 * The state on every card, row and page, apps and applets alike: Get, Open,
 * or Update as the kit's small secondary button (green means on, and nothing
 * here is on; the page's own Get is the ink primary button); "Installed" or
 * "Needs a newer Dashi" as plain words, since something that does nothing
 * shouldn't look like a button; and while a change runs or waits, its
 * progress with a × that stops it (the queue can take back any change, from
 * anywhere).
 */

import { BUTTON, Button, CLOSE, ProgressBar, SPACE, ToolbarButton, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type Chip, chipLabel } from "./model.ts";

/** Its least widths: a card's, and a page's (a little wider); the busy column adds a × beside the bar. */
export const STATE_WIDTH = { card: 72, page: 96, cancel: 24 } as const;

export interface StateChipProps {
  chip: Chip;
  /** Get, Open, or Update pressed. */
  onPress?: () => void;
  /** × pressed on a busy chip. */
  onCancel?: () => void;
  testID: string;
  /** A page's chip, a little wider than a card's. */
  wide?: boolean;
}

export function StateChip({ chip, onPress, onCancel, testID, wide }: StateChipProps) {
  const colors = useColors();
  const minWidth = wide ? STATE_WIDTH.page : STATE_WIDTH.card;
  if (chip.kind === "busy") {
    const { operation } = chip;
    return (
      <View
        testID={`${testID}:busy`}
        style={{ width: minWidth + STATE_WIDTH.cancel, flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: SPACE.xs }}
      >
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
          {chipLabel(chip)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
          <ProgressBar value={operation.status === "running" ? (operation.progress?.fraction ?? null) : null} width={minWidth} />
          {onCancel && (
            <ToolbarButton testID={`${testID}:cancel`} glyph={CLOSE} tooltip={operation.status === "queued" ? "Take back" : "Stop"} onPress={onCancel} />
          )}
        </View>
      </View>
    );
  }
  if (chip.kind === "installed" || chip.kind === "unavailable") {
    // Words end where a button would (the row's right edge), centered on a button's height.
    return (
      <View
        testID={`${testID}:${chip.kind}`}
        style={{ minWidth, height: BUTTON.window.height, flexShrink: 0, alignItems: "flex-end", justifyContent: "center" }}
      >
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted, textAlign: "right" }}>
          {chipLabel(chip)}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ minWidth, flexShrink: 0, flexDirection: "row" }}>
      <Button testID={testID} label={chipLabel(chip)} size="small" fill onPress={() => onPress?.()} />
    </View>
  );
}
