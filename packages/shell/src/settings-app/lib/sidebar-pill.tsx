/** The sidebar's rows: a pane as a pill, and a group's plain label. */

import { type Bounds, Text, View } from "@mirinjs/metal";
import { useControlColors } from "../../shared/controls/palette.ts";
import { Knob } from "../../shared/controls/parts.tsx";
import { SIDEBAR } from "./sidebar-measures.ts";

/** The badge's purple: the agents' and the keyboard ring's. */
const BADGE = "#6e56cf";

/** A pane as a pill: its knob, its name, a count at the end; chosen, the knob is green and tighter. A search result says its pane at the end (`where`). */
export function NavPill({
  testID,
  label,
  glyph,
  selected,
  badge,
  where,
  onPress,
  onLayout,
}: {
  testID: string;
  label: string;
  glyph: string;
  selected: boolean;
  badge?: number;
  where?: string;
  onPress: () => void;
  onLayout?: (bounds: Bounds) => void;
}) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      {...(onLayout ? { onLayout } : {})}
      style={{
        height: SIDEBAR.row,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingLeft: PILL_INSET,
        paddingRight: 10,
        borderRadius: SIDEBAR.row / 2,
        backgroundColor: selected ? colors.off : "#00000000",
        hoverBackgroundColor: selected ? colors.off : colors.knobOff,
        focusRingColor: colors.focus,
      }}
    >
      <Knob glyph={glyph} size={SIDEBAR.knob} glyphSize={15} on={selected} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? "semibold" : "normal", color: colors.text }}>
          {label}
        </Text>
      </View>
      {where !== undefined && (
        <View testID={`${testID}:where`} style={{ flexShrink: 0, maxWidth: 84 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted }}>
            {where}
          </Text>
        </View>
      )}
      {badge !== undefined && badge > 0 && (
        <View
          testID={`${testID}:badge`}
          style={{
            height: 18,
            minWidth: 18,
            paddingLeft: 6,
            paddingRight: 6,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: BADGE,
          }}
        >
          <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: "#ffffff" }}>{String(badge)}</Text>
        </View>
      )}
    </View>
  );
}

/** A pill's inset before its knob: a group's label starts there too, on the knobs' left edge. */
export const PILL_INSET = 3;

/** A group's plain label, on the knobs' left edge. */
export function GroupLabel({ children }: { children: string }) {
  const colors = useControlColors();
  return (
    <View style={{ height: SIDEBAR.label, flexShrink: 0, justifyContent: "flex-end", paddingLeft: PILL_INSET, paddingBottom: 2 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: colors.muted }}>{children.toUpperCase()}</Text>
    </View>
  );
}
