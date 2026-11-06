/**
 * The frames a row's live window pictures sit in (pictures.ts), under the
 * row, lined up with its name: one per window shown, the picked one ringed
 * in kombu. The compositor draws each window into its frame; this only says
 * where the frames are (`onLayout`).
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { LauncherWindow } from "./items.ts";
import { STRIP } from "./pictures.ts";

export interface WindowStripProps {
  windows: readonly LauncherWindow[];
  /** The picked one, of `windows`. */
  picked: number;
  /** Left of the frames: under the row's name. */
  indent: number;
  onLayout(window: number, bounds: { x: number; y: number; width: number; height: number }): void;
  onPick(index: number): void;
  /** Props for the accessibility tree (access.ts), per window; none on a host without one. */
  access?: (window: LauncherWindow, index: number) => Record<string, unknown>;
}

export function WindowStrip({ windows, picked, indent, onLayout, onPick, access }: WindowStripProps) {
  const colors = useColors();
  return (
    <View
      testID="launcher:pictures"
      style={{ flexDirection: "row", gap: STRIP.gap, paddingLeft: indent, paddingTop: STRIP.padTop, paddingBottom: STRIP.padBottom }}
    >
      {windows.map((window, index) => (
        <View
          key={window.id}
          testID={`launcher:picture:${window.id}`}
          onLayout={(bounds) => onLayout(window.id, bounds)}
          onPress={() => onPick(index)}
          {...(access ? access(window, index) : {})}
          style={{
            width: STRIP.width,
            height: STRIP.height,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: index === picked ? colors.selectionBar : colors.separator,
            backgroundColor: colors.button,
          }}
        />
      ))}
    </View>
  );
}
