/**
 * A pressable item of the menu bar's one row that is a pill of its own
 * (UI-18): agents working alone (its time left, a press stops it), Dashi's
 * voice while it listens or speaks, the screen recording's stop. A wash in
 * its tone's colour, its mark and words inside (the caller's), 22 tall, a
 * pill; a press acts, the pointer may raise a tip. It is a button, named for
 * screen readers; the bar's keyboard ring reaches it as it does the bar's
 * other items. On the bar's thin glass (frost-objects board 01, D780) its
 * words are primary whatever the tone and the washes are the drawn ones:
 * neutral ink 10 %, a capture's ume 20 %, the agents' `agentWash`, each a
 * step deeper under the pointer.
 */

import { type Bounds, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useOnGlass } from "./frosted.tsx";
import { pill, SPACE, useColors, withAlpha } from "./theme/index.ts";

/** Its measures: the bar's item height, and how far its words sit in. */
export const BAR_ITEM = { height: 22, inset: SPACE.s + SPACE.px } as const;

/** Its washes on glass, as parts of their ink: neutral, a capture's ume, and each under the pointer (the agents' rest is `agentWash`). */
export const BAR_ITEM_WASH = { neutral: 0.1, neutralHover: 0.16, capture: 0.2, captureHover: 0.28, agentHover: 0.3 } as const;

/** A bar item's job: an agent's (shiso), a capture's (the red that says the screen is taken), or neither. */
export type BarItemTone = "agent" | "capture" | "neutral";

/** The wash a tone sits on, the deeper one under the pointer, and the ink its words take; `glass`: on the bar's glass. */
export function barItemColors(tone: BarItemTone, colors: ReturnType<typeof useColors>, glass = false): { wash: string; hover: string; ink: string } {
  if (glass) {
    switch (tone) {
      case "agent":
        return { wash: colors.agentWash, hover: withAlpha(colors.agent, BAR_ITEM_WASH.agentHover), ink: colors.text };
      case "capture":
        return { wash: withAlpha(colors.ume, BAR_ITEM_WASH.capture), hover: withAlpha(colors.ume, BAR_ITEM_WASH.captureHover), ink: colors.text };
      case "neutral":
        return { wash: withAlpha(colors.text, BAR_ITEM_WASH.neutral), hover: withAlpha(colors.text, BAR_ITEM_WASH.neutralHover), ink: colors.text };
    }
  }
  switch (tone) {
    case "agent":
      return { wash: colors.agentWash, hover: colors.agentWash, ink: colors.agentInk };
    case "capture":
      return { wash: colors.captureWash, hover: colors.captureWash, ink: colors.text };
    case "neutral":
      return { wash: colors.openWash, hover: colors.openWash, ink: colors.text };
  }
}

/** `barItemColors` where the caller is drawn: on glass when a `Frosted` is above it. */
export function useBarItemColors(tone: BarItemTone): { wash: string; hover: string; ink: string } {
  return barItemColors(tone, useColors(), useOnGlass() !== null);
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
  const { wash, hover } = useBarItemColors(tone);
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
        hoverBackgroundColor: hover,
      }}
    >
      {children}
    </View>
  );
}
