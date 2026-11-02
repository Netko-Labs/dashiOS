/**
 * The Terminal's tab bar, under the title bar once a window has two tabs or
 * more: the tabs share the width, the one in front takes the terminal's
 * ground so it reads as the page below, and each shows its close button
 * while the pointer is on it (the one in front always). The + at the end
 * opens a tab (❖T).
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Tab } from "./tabs.ts";

export const TAB_BAR_HEIGHT = 28;

const glyph = (d: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${d}" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
const CLOSE = glyph("M5 5l6 6M11 5l-6 6");
const PLUS = glyph("M8 3.5v9M3.5 8h9");

export interface TabBarProps {
  tabs: readonly Tab[];
  active: number;
  /** The terminal's background: the tab in front matches it. */
  ground: string;
  /** Behind the other tabs: a step away from the ground. */
  shade: string;
  onSelect(id: number): void;
  onClose(id: number): void;
  onNew(): void;
}

export function TabBar({ tabs, active, ground, shade, onSelect, onClose, onNew }: TabBarProps) {
  const colors = useColors();
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <View
      testID="terminal-tabs"
      style={{ height: TAB_BAR_HEIGHT, flexShrink: 0, flexDirection: "row", backgroundColor: shade, borderBottomWidth: 1, borderColor: colors.separator }}
    >
      {tabs.map((tab, index) => {
        const front = tab.id === active;
        const showClose = front || hovered === tab.id;
        return (
          <View
            key={tab.id}
            testID={`terminal-tab-${index}`}
            onPress={() => onSelect(tab.id)}
            onHoverChange={(over) => setHovered((now) => (over ? tab.id : now === tab.id ? null : now))}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 6,
              gap: 4,
              backgroundColor: front ? ground : undefined,
              hoverBackgroundColor: front ? ground : colors.button,
              borderLeftWidth: index === 0 ? 0 : 1,
              borderColor: colors.separator,
            }}
          >
            <View
              testID={`terminal-tab-close-${index}`}
              onPress={() => onClose(tab.id)}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                alignItems: "center",
                justifyContent: "center",
                opacity: showClose ? 1 : 0,
                hoverBackgroundColor: colors.button,
                flexShrink: 0,
              }}
            >
              <Svg markup={CLOSE} size={11} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: front ? "semibold" : "normal", color: front ? colors.text : colors.textMuted }}>
                {tab.title}
              </Text>
            </View>
            {/* Balances the close button, so the title stays centered. */}
            <View style={{ width: 18, flexShrink: 0 }} />
          </View>
        );
      })}
      <View
        testID="terminal-tab-new"
        onPress={onNew}
        style={{
          width: 32,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderLeftWidth: 1,
          borderColor: colors.separator,
          hoverBackgroundColor: colors.button,
        }}
      >
        <Svg markup={PLUS} size={13} color={colors.textMuted} />
      </View>
    </View>
  );
}
