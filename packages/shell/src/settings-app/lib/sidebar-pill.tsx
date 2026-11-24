/**
 * The sidebar's rows: a pane as a pill-shaped row, and a group's plain
 * label. A pane's row is an option of the sidebar's list (one Tab stop, the
 * arrows choose as they go: KB-1), not a button.
 */

import { CLEAR, Knob, ON_AGENT, pill, SPACE, TYPE, useColors, useControlColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { SIDEBAR } from "./sidebar-measures.ts";

/** A row's measures beyond SIDEBAR's: the gap after the knob, its end, the place word's width, the agents' count. */
const PANE_ROW = { gap: 9, end: SPACE.gap, where: 84, badge: 18, glyph: 15 } as const;

/**
 * A pane: its knob, its name, a count at the end; chosen, the knob is the
 * on colour and tighter. A search result says its pane at the end (`where`).
 * The count of agents waiting is shiso under its own ink: purple is the
 * agents' (CO-3).
 */
export function PaneRow({
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
  const palette = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="option"
      accessibilityLabel={badge !== undefined && badge > 0 ? `${label} — ${badge}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      {...(onLayout ? { onLayout } : {})}
      style={{
        height: SIDEBAR.row,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: PANE_ROW.gap,
        paddingLeft: PILL_INSET,
        paddingRight: PANE_ROW.end,
        borderRadius: pill(SIDEBAR.row),
        backgroundColor: selected ? colors.off : CLEAR,
        hoverBackgroundColor: selected ? colors.off : colors.knobOff,
        focusRingColor: colors.focus,
      }}
    >
      <Knob glyph={glyph} size={SIDEBAR.knob} glyphSize={PANE_ROW.glyph} on={selected} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: selected ? WEIGHT.semibold : WEIGHT.regular, color: colors.text }}>
          {label}
        </Text>
      </View>
      {where !== undefined && (
        <View testID={`${testID}:where`} style={{ flexShrink: 0, maxWidth: PANE_ROW.where }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.muted }}>
            {where}
          </Text>
        </View>
      )}
      {badge !== undefined && badge > 0 && (
        <View
          testID={`${testID}:badge`}
          style={{
            height: PANE_ROW.badge,
            minWidth: PANE_ROW.badge,
            paddingLeft: SPACE.s,
            paddingRight: SPACE.s,
            borderRadius: pill(PANE_ROW.badge),
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.agent,
          }}
        >
          <Text style={{ fontSize: TYPE.panel.micro.size, fontWeight: WEIGHT.semibold, color: ON_AGENT }}>{String(badge)}</Text>
        </View>
      )}
    </View>
  );
}

/** A pill's inset before its knob: a group's label starts there too, on the knobs' left edge. */
export const PILL_INSET = 3;
/** A group's label: 10.5 SemiBold, 2 over its first pane. */
const GROUP_LABEL = { below: SPACE.xxs } as const;

/** A group's plain label, on the knobs' left edge. */
export function GroupLabel({ children }: { children: string }) {
  const colors = useControlColors();
  return (
    <View style={{ height: SIDEBAR.label, flexShrink: 0, justifyContent: "flex-end", paddingLeft: PILL_INSET, paddingBottom: GROUP_LABEL.below }}>
      <Text style={{ fontSize: TYPE.panel.micro.size, fontWeight: WEIGHT.semibold, color: colors.muted }}>{children.toUpperCase()}</Text>
    </View>
  );
}
