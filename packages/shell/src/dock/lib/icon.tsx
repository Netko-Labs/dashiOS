/**
 * One icon in the Dock and the thin divider between its groups: the picture,
 * the attention badge, the dot under a running app, and the pointer and
 * right-click it reports (view.tsx decides what those do).
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Image, type PointerInfo, View } from "@mirinjs/metal";
import { useRef } from "react";
import { DOCK } from "../../theme.ts";

const SETTLED = { offset: 0, opacity: 1 } as const;

export function Divider() {
  const colors = useColors();
  return (
    <View
      style={{
        width: 1,
        height: DOCK.icon - 4,
        marginTop: 2,
        marginLeft: 2,
        marginRight: 2,
        backgroundColor: colors.separator,
      }}
    />
  );
}

export function DockIcon({
  icon,
  running,
  attention = false,
  opacity = 1,
  onPress,
  onPointer,
  onMenu,
  onTile,
  rise = SETTLED,
  testID,
}: {
  icon: string;
  running: boolean;
  /** A window of this app wants attention. */
  attention?: boolean;
  opacity?: number;
  onPress: () => void;
  /** The pointer's phases on the icon, with the icon's center. */
  onPointer?: (event: PointerInfo, centerX: number) => void;
  /** A right-click, with the icon's center. */
  onMenu?: (centerX: number) => void;
  /** Where the icon was laid out (on the Dock's surface). */
  onTile?: (bounds: Bounds) => void;
  /** Its part of the Dock's entrance (slide.tsx `iconRise`): below its place, and how opaque. */
  rise?: { offset: number; opacity: number };
  testID: string;
}) {
  const colors = useColors();
  // Events carry the icon's bounds when they can; the last layout stands in for the rest.
  const laid = useRef<Bounds | null>(null);
  const centerOf = (bounds?: Bounds) => {
    const box = bounds ?? laid.current;
    return box ? box.x + box.width / 2 : 0;
  };
  return (
    <View
      style={{ flexDirection: "column", alignItems: "center", gap: 3 }}
      onLayout={(bounds) => {
        laid.current = bounds;
        onTile?.(bounds);
      }}
      onPress={onPress}
      onPointer={onPointer && ((event) => onPointer(event, centerOf(event.bounds)))}
      onContextMenu={onMenu && (() => onMenu(centerOf()))}
      testID={testID}
    >
      {/* The entrance moves the picture, not the icon's box: the minimize animation aims at the box. */}
      <View style={{ width: DOCK.icon, height: DOCK.icon, position: "relative", top: rise.offset, opacity: rise.opacity }}>
        <Image source={icon} style={{ width: DOCK.icon, height: DOCK.icon, opacity }} />
        {attention && (
          <View
            testID={`${testID}-attention`}
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: colors.dock,
              backgroundColor: colors.critical,
            }}
          />
        )}
      </View>
      <View
        style={{
          width: DOCK.dot,
          height: DOCK.dot,
          borderRadius: DOCK.dot / 2,
          backgroundColor: running ? colors.dot : "#00000000",
        }}
      />
    </View>
  );
}
