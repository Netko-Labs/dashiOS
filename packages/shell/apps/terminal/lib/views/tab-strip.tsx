/**
 * The Terminal's tabs, in the title bar's own row once a window has two or
 * more (VS-1, VS-4: no second bar under it). They share the row's width;
 * the one in front is washed and in semibold. Each shows its × while the
 * pointer is on it (the one in front always), on the left as on the Mac,
 * and on the right the 6 px attention dot when the bell rang in it while it
 * was behind. A name cut short ends in an ellipsis, centred between the ×
 * and the dot, and shows whole in a tooltip. The group sits centred in the
 * row; each tab keeps a least width, and the ones that don't fit fold into
 * a count after the last shown ("+3", strip-fit.ts) whose menu lists every
 * tab. The one in front always shows, so a narrow window keeps its name.
 */

import { CLOSE, useColors, useTooltip } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { fitTabs, MORE_WIDTH, TAB_GAP, TAB_MAX } from "../strip-fit.ts";

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
  /** The count was pressed: the menu of every tab, under it (`at`, its bounds in the window). */
  onMore(at: Bounds): void;
}

/** The ×'s room, and the dot's on the other side: the name stays centered. */
const SIDE = 18;
const TAB_HEIGHT = 26;

export function TabStrip({ tabs, active, onSelect, onClose, onMore }: TabStripProps) {
  const colors = useColors();
  const [strip, setStrip] = useState<Bounds | null>(null);
  const fit = fitTabs(
    tabs.length,
    tabs.findIndex((tab) => tab.id === active),
    strip?.width ?? null,
  );
  const shown = tabs.slice(fit.start, fit.end);
  const folded = [...tabs.slice(0, fit.start), ...tabs.slice(fit.end)];
  return (
    <View
      testID="terminal-tabs"
      onLayout={(bounds) =>
        setStrip((now) => (now && now.x === bounds.x && now.y === bounds.y && now.width === bounds.width && now.height === bounds.height ? now : bounds))
      }
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: TAB_GAP }}
    >
      {shown.map((tab, at) => (
        <TabItem key={tab.id} tab={tab} index={fit.start + at} front={tab.id === active} onSelect={onSelect} onClose={onClose} />
      ))}
      {fit.hidden > 0 && (
        <View
          testID="terminal-tabs-more"
          accessibilityRole="button"
          accessibilityLabel={`${fit.hidden} more tabs`}
          // From the keyboard there are no bounds: the strip's end stands in for the count's.
          onPress={(event) => {
            const at = event.bounds ?? (strip && { x: strip.x + strip.width - MORE_WIDTH, y: strip.y, width: MORE_WIDTH, height: strip.height });
            if (at) onMore(at);
          }}
          style={{
            width: MORE_WIDTH,
            height: TAB_HEIGHT,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            borderRadius: 7,
            hoverBackgroundColor: colors.button,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.textMuted }}>{`+${fit.hidden}`}</Text>
          {/* A tab out of sight rang: its dot is on the count. */}
          {folded.some((tab) => tab.rang) && (
            <View testID="terminal-tabs-more-bell" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot }} />
          )}
        </View>
      )}
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
        maxWidth: TAB_MAX,
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
      <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 2 }}>
        {/* One line, as wide as its slot: an ellipsis when cut, centred between the × and the dot. */}
        <Text
          numberOfLines={1}
          style={{ textAlign: "center", fontSize: 12, fontWeight: front ? "semibold" : "normal", color: front ? colors.text : colors.textMuted }}
        >
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
