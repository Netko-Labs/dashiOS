/**
 * The hover label (DK-2, decisions.md D800): the app under the pointer named
 * after `GLASS.dock.label.delayMs`, on regular glass `label.height` tall,
 * radius 9 (frost-objects' builder's table: the Dock's label 9, its menus
 * 10), `label.gap` above the icon as it is drawn (magnified included), its
 * name 12.5 SemiBold. Never while a menu or a drag is open (the caller
 * passes null then). It is drawn on the Dock's own surface, in the room it
 * keeps above the panel, and takes no clicks.
 */

import { Frosted, GLASS, SHADOW, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";

export interface LabelAim {
  /** The app's name. */
  name: string;
  /** The icon's centre, across the Dock's surface. */
  centerX: number;
  /** How far above the surface's foot the icon's top is drawn (its place, its magnification and lift). */
  iconTop: number;
}

/** The aim, once the pointer has rested on its icon for the delay; null at once when it leaves. From one icon to the next the label moves at once. */
export function useLabelDelay(aim: LabelAim | null, delayMs: number = GLASS.dock.label.delayMs): LabelAim | null {
  const [named, setNamed] = useState<string | null>(null);
  const showing = useRef(false);
  const key = aim?.name ?? null;
  useEffect(() => {
    if (key === null || showing.current) {
      showing.current = key !== null;
      setNamed(key);
      return;
    }
    const timer = setTimeout(() => {
      showing.current = true;
      setNamed(key);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs]);
  return aim && named === aim.name ? aim : null;
}

export function DockLabel({ aim }: { aim: LabelAim | null }) {
  const colors = useColors();
  const shown = useLabelDelay(aim);
  if (!shown) return null;
  const { height, gap, maxWidth, padding, radius } = GLASS.dock.label;
  return (
    <View
      testID="dock-label"
      style={{
        position: "absolute",
        left: shown.centerX - maxWidth / 2,
        width: maxWidth,
        bottom: shown.iconTop + gap,
        height,
        alignItems: "center",
      }}
    >
      <Frosted
        level="regular"
        style={{ height, maxWidth: maxWidth, paddingHorizontal: padding, borderRadius: radius, justifyContent: "center", shadow: SHADOW.lg }}
      >
        <Text numberOfLines={1} style={{ fontSize: TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
          {shown.name}
        </Text>
      </Frosted>
    </View>
  );
}
