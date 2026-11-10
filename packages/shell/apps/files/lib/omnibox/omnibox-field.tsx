/**
 * The omnibox's box: one rounded field in the toolbar that holds the crumbs
 * at rest and the text while it is edited.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import type { ReactNode } from "react";

export const HEIGHT = 28;
/** The least the field gets in a narrow window: the magnifier and the current folder, cut. */
const MIN_WIDTH = 96;

export function Field({
  children,
  testID,
  onLayout,
  onPress,
}: {
  children: ReactNode;
  testID: string;
  onLayout?: (bounds: Bounds) => void;
  /** At rest: the box is the window's first Tab stop, and Space or Return makes it text (KB-1). */
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      {...(onLayout ? { onLayout } : {})}
      {...(onPress ? { focusable: true, onPress, accessibilityRole: "button" as const, accessibilityLabel: "Path. Press to search, or type a path" } : {})}
      style={{
        flex: 1,
        minWidth: MIN_WIDTH,
        height: HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: 8,
        backgroundColor: colors.button,
      }}
    >
      {children}
    </View>
  );
}
