/**
 * The menu bar's chip while agents work alone (agents/alone/; docs/design.html,
 * "The agent mark"): a pill in the agents' purple with a stop square and the
 * time left, counting down each second. It is up the whole time it runs,
 * whether an agent is connected or not, and never goes into "…". One click
 * stops it, and agents ask again; pointing at it says what it is. It sits
 * beside the agent mark in the bar's one row: no second bar, no banner.
 */

import { BAR_ITEM, BarItem, SQUARE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Svg, Text } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { AloneState } from "./agents/index.ts";
import { elapsedText } from "./shared/time/index.ts";

/** The chip's measures: the bar item's height (UI-18), its stop square, and the time. */
export const ALONE_CHIP = { height: BAR_ITEM.height, square: 10, fontSize: TYPE.secondary.size } as const;

/** The time left as the chip says it: "59:59", "0:07"; whole seconds, rounded up, so it never reads 0:00 while on. */
export function leftText(ends: number, now: number): string {
  return elapsedText(Math.ceil(Math.max(0, ends - now) / 1000) * 1000);
}

/** What pointing at it shows. */
export const aloneTip = (left: string): string => `Agents work alone · ${left} left. Click to stop.`;

export interface AloneChipProps {
  state: AloneState;
  /** One click: it ends, and agents ask again. */
  onStop: () => void;
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
}

export function AloneChip({ state, onStop, onTip }: AloneChipProps) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const on = state.on;
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  // Gone with its tooltip, should the pointer be on it when it ends.
  const tipTo = useRef(onTip);
  tipTo.current = onTip;
  useEffect(() => {
    if (!on) tipTo.current?.(null);
  }, [on]);
  if (!state.on) return null;
  const left = leftText(state.ends, now);
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  return (
    <BarItem
      testID="alone-chip"
      tone="agent"
      label={`Agents work alone, ${left} left. Stop`}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={() => {
        onTip?.(null);
        onStop();
      }}
      onHoverChange={(hovered, bounds) => onTip?.(hovered ? { text: aloneTip(left), bounds: box(bounds) } : null)}
    >
      <Svg markup={SQUARE} size={ALONE_CHIP.square} color={colors.agent} />
      <Text numberOfLines={1} style={{ fontSize: ALONE_CHIP.fontSize, fontWeight: WEIGHT.semibold, color: colors.agentInk }}>
        {left}
      </Text>
    </BarItem>
  );
}
