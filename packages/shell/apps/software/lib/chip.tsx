/**
 * The state chip on every card, row and page, apps and applets alike: Get,
 * Open, or Update as a quiet pill with bold ink words (green means on, and
 * nothing here is on; the page's own Get is the ink primary button);
 * "Installed" or "Needs a newer Dashi" as plain words, since a pill that does nothing shouldn't
 * look like a button; and while a change runs or waits, its progress with a
 * × that stops it (the queue can take back any change, from anywhere).
 */

import { CLOSE, ProgressBar, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type Chip, chipLabel } from "./model.ts";

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
  const minWidth = wide ? 96 : 72;
  if (chip.kind === "busy") {
    const { operation } = chip;
    return (
      <View testID={`${testID}:busy`} style={{ width: minWidth + 24, flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {chipLabel(chip)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <ProgressBar value={operation.status === "running" ? (operation.progress?.fraction ?? null) : null} width={minWidth} />
          {onCancel && (
            <View
              testID={`${testID}:cancel`}
              focusable
              accessibilityRole="button"
              accessibilityLabel={operation.status === "queued" ? "Take back" : "Stop"}
              onPress={onCancel}
              style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
            >
              <Svg markup={CLOSE} size={10} color={colors.textMuted} />
            </View>
          )}
        </View>
      </View>
    );
  }
  if (chip.kind === "installed" || chip.kind === "unavailable") {
    // Words end where a button would (the row's right edge), centered on a button's height.
    return (
      <View testID={`${testID}:${chip.kind}`} style={{ minWidth, height: 28, flexShrink: 0, alignItems: "flex-end", justifyContent: "center" }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted, textAlign: "right" }}>
          {chipLabel(chip)}
        </Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={chipLabel(chip)}
      onPress={onPress}
      style={{
        minWidth,
        height: 26,
        flexShrink: 0,
        paddingHorizontal: 12,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "bold", color: colors.text }}>{chipLabel(chip)}</Text>
    </View>
  );
}
