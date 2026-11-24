/**
 * A notification's one card (NO-1, design.html "Notifications"), in the
 * banner and in the centre alike: its app's icon 28 at radius 7, the title
 * 13 Bold beside the time 11 muted, the body 12 muted, and its actions as
 * the kit's small Buttons (NO-2). Radius 12, padding 12. Where it sits
 * decides its ground: the banner floats on the launcher's glass with shadow
 * lg, the centre's sit on a tile.
 */

import { RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AppIcon } from "../../shared/apps/index.ts";

export const NOTE_CARD = {
  radius: RADIUS.sheet,
  padding: SPACE.inset,
  icon: 28,
  iconRadius: RADIUS.control,
  gap: SPACE.gap,
  /** The title's row, and the body's line. */
  summaryLine: 18,
  bodyLine: TYPE.secondary.line,
  /** Between the title and the body, and the body and the actions. */
  textGap: SPACE.xs,
  actionsGap: SPACE.m,
  /** A small Button's height. */
  actionRow: 24,
  /** The right-hand column: the time, or the centre's ✕ on hover. */
  side: 54,
  critical: 7,
} as const;

export interface NoteCardProps {
  testID: string;
  icon: string;
  title: string;
  body: string;
  critical: boolean;
  /** The time, or a ✕ (the centre, on hover). */
  aside: ReactNode;
  /** The kit's small Buttons, one per action beyond `default`. */
  actions?: ReactNode;
  /** The body keeps this many lines' room whatever it holds (the banner's height is set before it paints). */
  bodyLines?: number;
  /** A press on the card's words: the default action. */
  onOpen?: () => void;
  openTestID?: string;
}

/** The card's words and icon; its ground is the caller's (banner or centre). */
export function NoteCard({ testID, icon, title, body, critical, aside, actions, bodyLines, onOpen, openTestID }: NoteCardProps) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View
        {...(openTestID ? { testID: openTestID } : {})}
        onPress={onOpen}
        style={{ flex: 1, flexDirection: "row", gap: NOTE_CARD.gap, padding: NOTE_CARD.padding, paddingRight: 0, minWidth: 0 }}
      >
        <AppIcon source={icon} resizeMode="contain" style={{ width: NOTE_CARD.icon, height: NOTE_CARD.icon, borderRadius: NOTE_CARD.iconRadius }} />
        <View style={{ flex: 1, flexDirection: "column", gap: NOTE_CARD.textGap, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, height: NOTE_CARD.summaryLine }}>
            {critical && (
              <View style={{ width: NOTE_CARD.critical, height: NOTE_CARD.critical, borderRadius: RADIUS.check, backgroundColor: colors.critical }} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>
                {title}
              </Text>
            </View>
          </View>
          {body !== "" && (
            <View style={bodyLines ? { height: bodyLines * NOTE_CARD.bodyLine, overflow: "hidden" } : {}}>
              <Text style={{ fontSize: TYPE.secondary.size, lineHeight: NOTE_CARD.bodyLine, color: colors.textMuted }}>{body}</Text>
            </View>
          )}
          {actions && <View style={{ flexDirection: "row", gap: SPACE.s, paddingTop: NOTE_CARD.actionsGap - NOTE_CARD.textGap }}>{actions}</View>}
        </View>
      </View>
      <View
        style={{
          width: NOTE_CARD.side,
          height: NOTE_CARD.summaryLine + NOTE_CARD.padding,
          paddingTop: NOTE_CARD.padding,
          paddingRight: NOTE_CARD.padding,
          alignItems: "flex-end",
        }}
      >
        {aside}
      </View>
    </View>
  );
}

/** The time in the card's corner: "now", "5m". */
export function NoteTime({ words, onPress }: { words: string; onPress?: () => void }) {
  const colors = useColors();
  return (
    <View onPress={onPress} style={{ height: NOTE_CARD.summaryLine, justifyContent: "center" }}>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{words}</Text>
    </View>
  );
}
