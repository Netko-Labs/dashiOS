/**
 * The tally in the bar (round five, #25): only the holder's capsule keeps
 * its words, a vermilion dot before them ("● Tea 3:12"); what is live on
 * standby shrinks to its glyph, two at most, then folds into "+n". A holder
 * with no capsule of its own (music) is a dot beside the clock instead. A
 * click opens the notification area, where the item's card is.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { glyph, isGlyphName, useInks } from "../../shared/inks/index.ts";
import { type OnAirItem, onAirWords, type TallyView, useSecondTick, useTally } from "../../tally/index.ts";
import type { StatusSlot } from "./menubar-status.tsx";

/** Standby glyphs shown before the rest fold into "+n". */
const STANDBY_SHOWN = 2;
const CAPSULE = { height: 20, padding: 8, dot: 7, glyph: 13 } as const;

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
        gap: 6,
        height: CAPSULE.height,
        paddingLeft: CAPSULE.padding,
        paddingRight: CAPSULE.padding,
        borderRadius: CAPSULE.height / 2,
        backgroundColor: colors.button,
      }}
    >
      <TallyDot color={tally} />
      <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
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
    <View testID="tally-standby" onPress={onPress} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 }}>
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
      {more > 0 && <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.textMuted }}>{`+${more}`}</Text>}
    </View>
  );
}

/** Whether the holder draws a capsule of its own; music does not (its dot sits by the clock). */
export function hasCapsule(item: OnAirItem): boolean {
  return !item.key.startsWith("media:");
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
  if (view.item && hasCapsule(view.item)) {
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

/** The one thing on air and what waits on standby, as the bar's slots, and the clock's dot for a holder without a capsule. */
export function useTallySlots(openArea: () => void): { slots: StatusSlot[]; clockDot: string | null; openArea: () => void } {
  const view = useTally();
  const inks = useInks();
  return { openArea, slots: tallySlots(view, inks.tally, openArea), clockDot: view.item && !hasCapsule(view.item) ? inks.tally : null };
}
