/**
 * A widget's card: paper with a hairline, radius 14 (12 for one-row
 * spans), padding 14; no shadow, no blur. On air it floods: its ink is the
 * paper, its words paper-coloured, a 3-point ring in the tally's colour goes
 * round it, and its header carries "Now" (round five, #16). Redacted on the
 * lock screen, it shows a lock in the corner.
 */

import { Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { glyph } from "../../../shared/inks/index.ts";
import { type CardLook, cardColours, LookProvider, RedactProvider } from "./look.tsx";

export const CARD_RING = 3;

export interface CardProps {
  look: CardLook;
  width: number;
  height?: number;
  /** One-row spans and live cards are a little tighter. */
  compact?: boolean;
  padding?: number;
  testID?: string;
  onPress?: () => void;
  /** Right-click: on a live card, pin it (the design's long press, D403). */
  onContext?: () => void;
  onHoverChange?: (hovered: boolean) => void;
  children: ReactNode;
}

export function Card({ look, width, height, compact, padding, testID, onPress, onContext, onHoverChange, children }: CardProps) {
  const colours = cardColours(look);
  const radius = compact ? 12 : 14;
  return (
    <LookProvider value={colours}>
      <RedactProvider value={look.redact}>
        <View style={{ width, ...(height === undefined ? {} : { height }) }}>
          {look.air ? (
            <View
              testID="tally-ring"
              style={{
                position: "absolute",
                left: -CARD_RING,
                top: -CARD_RING,
                right: -CARD_RING,
                bottom: -CARD_RING,
                borderRadius: radius + CARD_RING,
                backgroundColor: look.inks.tally,
              }}
            />
          ) : null}
          <View
            testID={testID}
            {...(onPress ? { onPress } : {})}
            {...(onContext ? { onContextMenu: () => onContext() } : {})}
            {...(onHoverChange ? { onHoverChange } : {})}
            style={{
              flex: 1,
              flexDirection: "column",
              padding: padding ?? (compact ? 12 : 14),
              borderRadius: radius,
              backgroundColor: colours.paper,
              ...(look.air ? {} : { borderWidth: 1, borderColor: colours.hairline }),
            }}
          >
            {children}
          </View>
          {look.redact ? (
            <View style={{ position: "absolute", right: 12, bottom: 12 }}>
              <Svg markup={glyph("lock")} size={11} color={colours.tertiary} />
            </View>
          ) : null}
        </View>
      </RedactProvider>
    </LookProvider>
  );
}
