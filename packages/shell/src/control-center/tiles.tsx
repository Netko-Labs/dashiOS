/**
 * A Control Center tile in place in the grid (grid.tsx): absolutely at its
 * frame, Metal's ring on it when the keyboard is there. The tiles themselves
 * are the kit's (@dashi/ui's WideTile, RoundTile, SliderTile, BatteryTile).
 */

import { useControlColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";

/** A tile in place: absolutely at its frame, its ring when the keyboard is on it. */
export function TileFrame({
  frame,
  focused,
  radius,
  children,
}: {
  frame: { left: number; top: number; width: number; height: number };
  focused: boolean;
  radius: number;
  children: ReactNode;
}) {
  const colors = useControlColors();
  return (
    <View
      testID={focused ? "cc-focus-ring" : undefined}
      focusRingShown={focused}
      style={{
        position: "absolute",
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        flexDirection: "column",
        borderRadius: radius,
        focusRingColor: colors.focus,
      }}
    >
      {children}
    </View>
  );
}
