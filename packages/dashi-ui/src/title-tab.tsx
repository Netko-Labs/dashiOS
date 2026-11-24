/**
 * A tab in the title row (VS-4, 0.10): Terminal's tabs, once a window has
 * two. They share the row's width; the one in front sits on the button's
 * wash in semibold, the rest in muted words. Each shows its × on the left
 * while the pointer is on it (the front one always), as on the Mac, and on
 * the right the 6 px attention dot (an indicator, never words) when
 * something rang in it while it was behind. A cut name ends in an ellipsis,
 * centred between the × and the dot, and shows whole in a tooltip. The tabs
 * that don't fit fold into `TitleTabMore`, a count whose menu lists them.
 */

import { type PressInfo, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { CLOSE } from "./glyphs.ts";
import { pill, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";
import { useTooltip } from "./tooltip.tsx";

/** Its measures: 26 tall at radius 7, the ×'s and the dot's room each side, the dot. */
export const TITLE_TAB = { height: 26, side: 18, dot: 6, close: 11, inset: SPACE.xs, gap: SPACE.xs } as const;

export interface TitleTabProps {
  label: string;
  front: boolean;
  /** Something rang in it while it was behind: the attention dot. */
  rang: boolean;
  onPress: () => void;
  onClose: () => void;
  testID: string;
  /** Its widest, so a few tabs don't stretch across the whole row. */
  maxWidth?: number;
}

/** The attention dot: an indicator, never text (no dots for words). */
function Dot({ testID }: { testID: string }) {
  const colors = useColors();
  return <View testID={testID} style={{ width: TITLE_TAB.dot, height: TITLE_TAB.dot, borderRadius: pill(TITLE_TAB.dot), backgroundColor: colors.dot }} />;
}

export function TitleTab({ label, front, rang, onPress, onClose, testID, maxWidth }: TitleTabProps) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  const tip = useTooltip(label);
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: front }}
      onPress={() => {
        tip.hide();
        onPress();
      }}
      onHoverChange={(over, bounds) => {
        setHovered(over);
        tip.onHoverChange(over, bounds);
      }}
      style={{
        flex: 1,
        minWidth: 0,
        ...(maxWidth !== undefined ? { maxWidth } : {}),
        height: TITLE_TAB.height,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: TITLE_TAB.inset,
        borderRadius: RADIUS.control,
        ...(front ? { backgroundColor: colors.button } : {}),
        hoverBackgroundColor: colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <View
        testID={`${testID}:close`}
        accessibilityRole="button"
        accessibilityLabel="Close tab"
        onPress={onClose}
        style={{
          width: TITLE_TAB.side,
          height: TITLE_TAB.side,
          borderRadius: RADIUS.check,
          alignItems: "center",
          justifyContent: "center",
          opacity: front || hovered ? 1 : 0,
          hoverBackgroundColor: colors.button,
          flexShrink: 0,
        }}
      >
        <Svg markup={CLOSE} size={TITLE_TAB.close} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingHorizontal: SPACE.xxs }}>
        <Text
          numberOfLines={1}
          style={{
            textAlign: "center",
            fontSize: TYPE.secondary.size,
            fontWeight: front ? WEIGHT.semibold : WEIGHT.regular,
            color: front ? colors.text : colors.textMuted,
          }}
        >
          {label}
        </Text>
      </View>
      <View style={{ width: TITLE_TAB.side, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>{rang && <Dot testID={`${testID}:dot`} />}</View>
      {tip.node}
    </View>
  );
}

/** The tabs that don't fit, as a count ("+3") after the last shown; its dot when one of them rang. */
export function TitleTabMore({
  hidden,
  rang,
  width,
  onPress,
  testID,
}: {
  hidden: number;
  rang: boolean;
  width: number;
  onPress: (event: PressInfo) => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`${hidden} more tabs`}
      onPress={onPress}
      style={{
        width,
        height: TITLE_TAB.height,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: TITLE_TAB.gap,
        borderRadius: RADIUS.control,
        hoverBackgroundColor: colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{`+${hidden}`}</Text>
      {rang && <Dot testID={`${testID}:dot`} />}
    </View>
  );
}
