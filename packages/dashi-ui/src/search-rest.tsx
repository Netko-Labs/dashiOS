/** SearchField's box: its width or its row's room, and the box at rest holding something else (Files' crumbs). */

import { type Bounds, View, type ViewStyle } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { SPACE, useColors } from "./theme/index.ts";

/** The field's box: its row's room ("fill"), or its width, shrinking toward `minWidth` when one is given. */
export function boxOf(width: number | "fill", minWidth: number | undefined, height: number): ViewStyle {
  if (width === "fill") return { flex: 1, minWidth: minWidth ?? 0, alignSelf: "stretch", height: height };
  return { width, height: height, ...(minWidth === undefined ? { flexShrink: 0 as const } : { flexShrink: 1 as const, minWidth }) };
}

/** The field at rest as something else (Files' crumbs): the same box, pressable, one Tab stop. */
export function RestBox({
  testID,
  box,
  radius,
  ground,
  label,
  onPress,
  onLayout,
  children,
}: {
  testID: string;
  box: ViewStyle;
  radius: number;
  ground: string;
  label: string;
  onPress?: () => void;
  onLayout: (bounds: Bounds) => void;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onLayout={onLayout}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        ...box,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.xxs,
        paddingLeft: SPACE.xs,
        paddingRight: SPACE.m,
        borderRadius: radius,
        backgroundColor: ground,
        focusRingColor: colors.focusRing,
      }}
    >
      {children}
    </View>
  );
}
