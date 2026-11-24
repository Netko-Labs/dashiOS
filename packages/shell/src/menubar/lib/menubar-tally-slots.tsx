/**
 * The tally in the bar (round five, #25): only the holder's capsule keeps
 * its words, a vermilion dot before them ("● Tea 3:12"); what is live on
 * standby shrinks to its glyph, two at most, then folds into "+n". Music
 * on air has its capsule too ("● Slow Tide"), never a bare dot by the clock
 * (D500). A click opens the notification area, where the item's card is.
 */

import { SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { glyph, isGlyphName, useInks } from "../../shared/inks/index.ts";
import { type OnAirItem, onAirWords, type TallyView, useSecondTick, useTally } from "../../tally/index.ts";
import type { StatusSlot } from "./menubar-status.tsx";

/** Standby glyphs shown before the rest fold into "+n". */
const STANDBY_SHOWN = 2;
const CAPSULE = { height: 20, padding: SPACE.m, dot: 7, glyph: 13 } as const;

function TallyDot({ color }: { color: string }) {
  return <View style={{ width: CAPSULE.dot, height: CAPSULE.dot, borderRadius: CAPSULE.dot / 2, backgroundColor: color }} />;
}

function HolderCapsule({ item, tally, onPress }: { item: OnAirItem; tally: string; onPress: () => void }) {
  const colors = useColors();
  const now = useSecondTick(item.countdown !== undefined);
  return (
    <View
      testID="tally-capsule"
      onPress={onPress}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.s,
        height: CAPSULE.height,
        paddingLeft: CAPSULE.padding,
        paddingRight: CAPSULE.padding,
        borderRadius: CAPSULE.height / 2,
        backgroundColor: colors.button,
      }}
    >
      <TallyDot color={tally} />
      <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: colors.text }}>
        {onAirWords(item, now)}
      </Text>
    </View>
  );
}

function StandbyCapsule({ items, onPress }: { items: readonly OnAirItem[]; onPress: () => void }) {
  const colors = useColors();
  const shown = items.slice(0, STANDBY_SHOWN);
  const more = items.length - shown.length;
  return (
    <View testID="tally-standby" onPress={onPress} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
      {shown.map((item) => (
        <View
          key={item.key}
          style={{
            height: CAPSULE.height,
            width: CAPSULE.height + 6,
            borderRadius: CAPSULE.height / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.button,
          }}
        >
          <Svg markup={glyph(isGlyphName(item.glyph) ? item.glyph : "spark")} size={CAPSULE.glyph} color={colors.text} />
        </View>
      ))}
      {more > 0 && <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{`+${more}`}</Text>}
    </View>
  );
}

/** The bar's tally slots, left of the system's own items. */
export function tallySlots(view: TallyView, tally: string, openArea: () => void): StatusSlot[] {
  const slots: StatusSlot[] = [];
  if (view.standby.length > 0)
    slots.push({
      key: "tally-standby",
      goes: 1,
      label: `${view.standby.length} more live`,
      open: { kind: "panel", run: openArea },
      node: <StandbyCapsule items={view.standby} onPress={openArea} />,
    });
  if (view.item) {
    const item = view.item;
    slots.push({
      key: "tally-holder",
      goes: null,
      label: `On air: ${item.label}`,
      radius: CAPSULE.height / 2,
      open: { kind: "panel", run: openArea },
      node: <HolderCapsule item={item} tally={tally} onPress={openArea} />,
    });
  }
  return slots;
}

/** The one thing on air and what waits on standby, as the bar's slots. */
export function useTallySlots(openArea: () => void): { slots: StatusSlot[]; openArea: () => void } {
  const view = useTally();
  const inks = useInks();
  return { openArea, slots: tallySlots(view, inks.tally, openArea) };
}
