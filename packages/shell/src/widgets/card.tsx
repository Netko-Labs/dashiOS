/**
 * A widget's card (CO-11): paper glass, radius 18 (14 for one-row spans),
 * padding 14, no shadow at rest; the compositor draws its rim and hairline.
 * On air it keeps its glass as off air and glows faintly in its own ink, its
 * header carrying "Now" (CO-12, D768): no ring, no flood. The lock's cards
 * are the same paper glass (LK-4, D807). Redacted on the lock screen, it
 * shows a lock in the corner.
 */

import { Frosted, RADIUS, SPACE } from "@dashi/ui";
import { type SpelledShadow, Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { glyph } from "../shared/inks/index.ts";
import { type CardColours, type CardLook, cardColours, LookProvider, onAirGlow, REDACT_LOCK, RedactProvider } from "./look.tsx";

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
          <Frosted {...inside} level="paper" solid={solid} style={{ ...frame, ...(glow ? { shadow: glow as SpelledShadow } : {}) }}>
            {children}
          </Frosted>
          {look.redact ? <RedactLock colours={colours} /> : null}
        </View>
      </RedactProvider>
    </LookProvider>
  );
}

function RedactLock({ colours }: { colours: CardColours }) {
  return (
    <View style={{ position: "absolute", right: REDACT_LOCK.inset, bottom: REDACT_LOCK.inset }}>
      <Svg markup={glyph("lock")} size={REDACT_LOCK.size} color={colours.tertiary} />
    </View>
  );
}
