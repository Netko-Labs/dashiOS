/**
 * "More" in words (docs/design.html, "More"): the word and a chevron that
 * shows which way it goes, ink, 12 SemiBold, never underlined, never an
 * ellipsis (an ellipsis promises a dialog). Pressed, it shows what it held
 * in place and becomes its opposite ("Less", "Fewer Options") with the
 * chevron up. Quiet until hovered; its words sit on the column's left edge
 * (the hover wash reaches 6 past them). Where there is no room for a word,
 * "More" is the `MORE` glyph on a `ToolbarButton` instead; a pill row's is
 * a pill in its track (the shell's `FoldedChoices`).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { CHEVRON_DOWN, CHEVRON_UP } from "./glyphs.ts";
import { useColors } from "./theme/index.ts";

/** Its height, the wash's reach past the words, and the words' size. */
export const MORE_BUTTON = { height: 24, inset: 6, size: 12 } as const;

export function MoreButton({
  open,
  onPress,
  testID,
  more = "More",
  less = "Less",
}: {
  /** What it holds is shown: it says `less`, its chevron up. */
  open: boolean;
  onPress: () => void;
  testID: string;
  more?: string;
  less?: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{
        alignSelf: "flex-start",
        height: MORE_BUTTON.height,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        // The words on the column's edge; the wash reaches past them.
        marginLeft: -MORE_BUTTON.inset,
        paddingLeft: MORE_BUTTON.inset,
        paddingRight: MORE_BUTTON.inset - 2,
        borderRadius: 6,
        hoverBackgroundColor: colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: MORE_BUTTON.size, fontWeight: "semibold", color: colors.text }}>
        {open ? less : more}
      </Text>
      <Svg markup={open ? CHEVRON_UP : CHEVRON_DOWN} size={12} color={colors.textMuted} />
    </View>
  );
}
