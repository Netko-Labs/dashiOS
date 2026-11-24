/**
 * A pressable item of the menu bar's one row that is a pill of its own
 * (UI-18): agents working alone (its time left, a press stops it), Dashi's
 * voice while it listens or speaks, the screen recording's stop. A wash in
 * its tone's colour, its mark and words inside (the caller's), 22 tall, a
 * pill; a press acts, the pointer may raise a tip. It is a button, named for
 * screen readers; the bar's keyboard ring reaches it as it does the bar's
 * other items.
 */

import { type Bounds, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { pill, SPACE, useColors } from "./theme/index.ts";

/** Its measures: the bar's item height, and how far its words sit in. */
export const BAR_ITEM = { height: 22, inset: SPACE.s + SPACE.px } as const;

/** A bar item's job: an agent's (shiso), a capture's (the red that says the screen is taken), or neither. */
export type BarItemTone = "agent" | "capture" | "neutral";

/** The wash a tone sits on, and the ink its words take. */
export function barItemColors(tone: BarItemTone, colors: ReturnType<typeof useColors>): { wash: string; ink: string } {
  switch (tone) {
    case "agent":
      return { wash: colors.agentWash, ink: colors.agentInk };
    case "capture":
      return { wash: colors.captureWash, ink: colors.text };
    case "neutral":
      return { wash: colors.openWash, ink: colors.text };
  }
}

export interface BarItemProps {
  testID: string;
  /** What it is and what a press does, for screen readers ("Agents work alone, 4:12 left. Stop"). */
  label: string;
  onPress: () => void;
  tone: BarItemTone;
  children: ReactNode;
  onHoverChange?: (hovered: boolean, bounds?: Bounds) => void;
  onLayout?: (bounds: Bounds) => void;
  /** It may shrink and cut its words (the voice's line, in what room the bar leaves it). */
  shrink?: boolean;
  /** Room after the words past the inset (a voice's last bar). */
  endInset?: number;
}

export function BarItem({ testID, label, onPress, tone, children, onHoverChange, onLayout, shrink, endInset = 0 }: BarItemProps) {
  const colors = useColors();
  const { wash } = barItemColors(tone, colors);
  return (
    <View
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...(onHoverChange ? { onHoverChange } : {})}
      {...(onLayout ? { onLayout } : {})}
      style={{
        flexShrink: shrink ? 1 : 0,
        ...(shrink ? { minWidth: 0, overflow: "hidden" as const } : {}),
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.xs,
        height: BAR_ITEM.height,
        paddingLeft: BAR_ITEM.inset,
        paddingRight: BAR_ITEM.inset + endInset,
        borderRadius: pill(BAR_ITEM.height),
        backgroundColor: wash,
        hoverBackgroundColor: wash,
      }}
    >
      {children}
    </View>
  );
}
