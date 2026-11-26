/**
 * A widget's card (CO-11): paper glass, radius 18 (14 for one-row spans),
 * padding 14, no shadow at rest; the compositor draws its rim and hairline.
 * On air it keeps its glass as off air and glows faintly in its own ink, its
 * header carrying "Now" (CO-12, D768): no ring, no flood. On the lock's wash
 * (y4d's, until the lock wears Frost) it is still opaque paper with a
 * hairline, and the card on air there floods with a 3-point ring of the
 * tally (the lock's Now bar). Redacted on the lock screen, it shows a lock in the corner.
 */

import { Frosted, RADIUS, SPACE } from "@dashi/ui";
import { type SpelledShadow, Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { glyph } from "../shared/inks/index.ts";
import { type CardColours, type CardLook, cardColours, floods, LookProvider, onAirGlow, REDACT_LOCK, RedactProvider } from "./look.tsx";

/** The tally's ring round a card that floods (the lock's wash only). */
export const CARD_RING = 3;

export interface CardProps {
  look: CardLook;
  width: number;
  height?: number;
  /** One-row spans and live cards are a little tighter. */
  compact?: boolean;
  padding?: number;
  /** Paper's solid twin, never glass (a preview inside the gallery's glass, GL-2). */
  solid?: boolean;
  testID?: string;
  onPress?: () => void;
  /** Right-click: on a live card, pin it (the design's long press, D403). */
  onContext?: () => void;
  onHoverChange?: (hovered: boolean) => void;
  children: ReactNode;
}

/** The card's corner: a widget's 18, 14 for one row (RA-1, CO-11). */
export const cardRadius = (compact: boolean): number => (compact ? RADIUS.inkCardRow : RADIUS.inkCard);

export function Card({ look, width, height, compact = false, padding, solid = false, testID, onPress, onContext, onHoverChange, children }: CardProps) {
  const colours = cardColours(look);
  const radius = cardRadius(compact);
  const glow = onAirGlow(look);
  const inside = {
    ...(testID ? { testID } : {}),
    ...(onPress ? { onPress } : {}),
    ...(onContext ? { onContextMenu: () => onContext() } : {}),
    ...(onHoverChange ? { onHoverChange } : {}),
  };
  const frame = {
    flex: 1,
    flexDirection: "column" as const,
    alignItems: "stretch" as const,
    padding: padding ?? (compact ? SPACE.inset : SPACE.button),
    borderRadius: radius,
  };
  return (
    <LookProvider value={colours}>
      <RedactProvider value={look.redact}>
        <View style={{ width, ...(height === undefined ? {} : { height }) }}>
          {floods(look) ? <TallyRing radius={radius} tally={look.inks.tally} /> : null}
          {look.glass ? (
            <View {...inside} style={{ ...frame, backgroundColor: colours.paper, ...(floods(look) ? {} : { borderWidth: 1, borderColor: colours.hairline }) }}>
              {children}
            </View>
          ) : (
            <Frosted {...inside} level="paper" solid={solid} style={{ ...frame, ...(glow ? { shadow: glow as SpelledShadow } : {}) }}>
              {children}
            </Frosted>
          )}
          {look.redact ? <RedactLock colours={colours} /> : null}
        </View>
      </RedactProvider>
    </LookProvider>
  );
}

/** The tally's 3-point ring round a card that floods on the lock's wash. */
function TallyRing({ radius, tally }: { radius: number; tally: string }) {
  return (
    <View
      testID="tally-ring"
      style={{
        position: "absolute",
        left: -CARD_RING,
        top: -CARD_RING,
        right: -CARD_RING,
        bottom: -CARD_RING,
        borderRadius: radius + CARD_RING,
        backgroundColor: tally,
      }}
    />
  );
}

function RedactLock({ colours }: { colours: CardColours }) {
  return (
    <View style={{ position: "absolute", right: REDACT_LOCK.inset, bottom: REDACT_LOCK.inset }}>
      <Svg markup={glyph("lock")} size={REDACT_LOCK.size} color={colours.tertiary} />
    </View>
  );
}
