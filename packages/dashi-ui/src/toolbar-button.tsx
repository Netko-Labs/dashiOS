/**
 * A glyph button in a window's toolbar (VS-1): square, quiet until hovered,
 * named by its tooltip or its words (UI-3).
 */

import { type PressInfo, Svg, Text, View } from "@mirinjs/metal";
import { CLEAR, RADIUS, SPACE, TYPE, useColors } from "./theme/index.ts";
import { useTooltip } from "./tooltip.tsx";

/**
 * What names a toolbar button, one or both: a glyph-only button is named by
 * its tooltip, a worded one by its label. Without either a screen reader and
 * an agent's read_window could not say what it is, so the type asks for one.
 */
export type ToolbarButtonName = { label: string; tooltip?: string } | { tooltip: string; label?: string };

/**
 * A glyph button in a toolbar: square, quiet until hovered. A glyph-only
 * button names itself with `tooltip`, shown under it when the pointer rests
 * on it (UI-3); one with a `label` shows its words instead. A toolbar's
 * "More" is one of these: the `MORE` glyph, the tooltip "More", `active`
 * while its menu is open, the menu hung by its right edge under the
 * button's (`PopupMenu`'s `anchor` "end").
 */
export function ToolbarButton({
  glyph,
  onPress,
  testID,
  disabled,
  label,
  tooltip,
  active = false,
}: {
  glyph: string;
  /** With the press: the button's bounds, for a menu that opens under it (PA-9). */
  onPress: (event: PressInfo) => void;
  testID: string;
  disabled?: boolean;
  /** Held lit, as under the pointer: the menu it opened is open ("…"'s). */
  active?: boolean;
} & ToolbarButtonName) {
  const colors = useColors();
  const tip = useTooltip(tooltip);
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="button"
      accessibilityLabel={tooltip ?? label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={
        disabled
          ? undefined
          : (event) => {
              tip.hide();
              onPress(event);
            }
      }
      onHoverChange={tip.onHoverChange}
      style={{
        height: 28,
        minWidth: 32,
        // Its words never wrap and it never shrinks: a toolbar's one row gives way elsewhere.
        flexShrink: 0,
        paddingHorizontal: label ? SPACE.gap : 0,
        flexDirection: "row",
        gap: SPACE.s,
        borderRadius: RADIUS.control,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active && !disabled ? colors.button : CLEAR,
        hoverBackgroundColor: disabled ? CLEAR : colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={16} color={disabled ? colors.textDisabled : colors.textMuted} />
      {label !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: disabled ? colors.textDisabled : colors.text }}>
          {label}
        </Text>
      )}
      {tip.node}
    </View>
  );
}
