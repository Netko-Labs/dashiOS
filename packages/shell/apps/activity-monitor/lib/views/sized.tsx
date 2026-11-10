/**
 * The window's size as its content is laid out: the toolbar, the columns and
 * the summary fit it. Metal records no bounds for a window's root, so the
 * root's one child is measured.
 */

import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";

export interface WindowSize {
  width: number;
  height: number;
}

export function Sized({ onSize, children }: { onSize: (size: WindowSize) => void; children: ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <View testID="monitor-window" onLayout={(bounds) => onSize({ width: Math.round(bounds.width), height: Math.round(bounds.height) })} style={{ flex: 1 }}>
        {children}
      </View>
    </View>
  );
}
