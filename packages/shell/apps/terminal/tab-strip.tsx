/**
 * The Terminal's tabs, in the title bar's own row once a window has two or
 * more (VS-1, VS-4: no second bar under it). They share the row's width;
 * the one in front is washed and in semibold. Each shows its × while the
 * pointer is on it (the one in front always), on the left as on the Mac,
 * and on the right the 6 px attention dot when the bell rang in it while it
 * was behind. A name cut short shows whole in a tooltip.
 */

import { CLOSE, useColors, useTooltip } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";

/** A tab as the strip draws it. */
export interface StripTab {
  id: number;
  name: string;
  rang: boolean;
}

export interface TabStripProps {
  tabs: readonly StripTab[];
  active: number;
  onSelect(id: number): void;
  onClose(id: number): void;
}

/** The ×'s room, and the dot's on the other side: the name stays centered. */
const SIDE = 18;
const TAB_HEIGHT = 26;

export function TabStrip({ tabs, active, onSelect, onClose }: TabStripProps) {
  return (
    <View testID="terminal-tabs" style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 }}>
      {tabs.map((tab, index) => (
        <TabItem key={tab.id} tab={tab} index={index} front={tab.id === active} onSelect={onSelect} onClose={onClose} />
      ))}
    </View>
  );
}

function TabItem({
  tab,
  index,
  front,
  onSelect,
  onClose,
}: {
  tab: StripTab;
  index: number;
  front: boolean;
  onSelect(id: number): void;
  onClose(id: number): void;
}) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  const tip = useTooltip(tab.name);
  return (
    <View
      testID={`terminal-tab-${index}`}
      accessibilityRole="button"
      accessibilityLabel={tab.name}
      onPress={() => {
        tip.hide();
        onSelect(tab.id);
      }}
      onHoverChange={(over, bounds) => {
        setHovered(over);
        tip.onHoverChange(over, bounds);
      }}
      style={{
        flex: 1,
        minWidth: 0,
        maxWidth: 260,
        height: TAB_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 4,
        borderRadius: 7,
        ...(front ? { backgroundColor: colors.button } : {}),
        hoverBackgroundColor: colors.button,
      }}
    >
      <View
        testID={`terminal-tab-close-${index}`}
        accessibilityRole="button"
        accessibilityLabel="Close tab"
        onPress={() => onClose(tab.id)}
        style={{
          width: SIDE,
          height: SIDE,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          opacity: front || hovered ? 1 : 0,
          hoverBackgroundColor: colors.button,
          flexShrink: 0,
        }}
      >
        <Svg markup={CLOSE} size={11} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, alignItems: "center", paddingHorizontal: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: front ? "semibold" : "normal", color: front ? colors.text : colors.textMuted }}>
          {tab.name}
        </Text>
      </View>
      <View style={{ width: SIDE, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        {tab.rang && <View testID={`terminal-tab-bell-${index}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot }} />}
      </View>
      {tip.node}
    </View>
  );
}
