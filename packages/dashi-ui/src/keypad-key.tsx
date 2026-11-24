/**
 * A keypad's key (0.10): Calculator's rounded squares, which grow with the
 * window and stay square. Three tones: a digit on the card's ground inside a
 * hairline, a function or operator on the button's quiet wash, and the one
 * strong key (=) in ink, the primary button's fill and words: kombu means
 * on (CO-2), and = turns nothing on. It deepens while held (UI-4) and while
 * `lit` (the keyboard just typed it). Its label is 400: operators too (TY-2).
 * A key is a tile of its keypad, so its corners are a card's (RA-1).
 */

import { type PointerInfo, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { RADIUS, SPACE, useColors, useSurface, WEIGHT } from "./theme/index.ts";

/** Its measures: a card's radius, a digit's hairline. */
export const KEYPAD_KEY = { radius: RADIUS.card, edge: SPACE.px } as const;

export type KeypadKeyTone = "digit" | "quiet" | "strong";

export interface KeypadKeyProps {
  label: string;
  /** What a screen reader says when the label is a symbol ("Divide"). */
  accessibilityLabel?: string;
  tone: KeypadKeyTone;
  /** Its words' size: the keypad sets it from the key's side. */
  fontSize: number;
  /** The keyboard just typed it: it shows held for a moment. */
  lit?: boolean;
  /** Columns it spans in the keypad's grid (the 0 takes two). */
  span?: 2;
  onPress: () => void;
  testID: string;
}

export function KeypadKey({ label, accessibilityLabel, tone, fontSize, lit = false, span, onPress, testID }: KeypadKeyProps) {
  const colors = useColors();
  const surface = useSurface();
  const [held, setHeld] = useState(false);
  const look = {
    digit: { ground: surface.card, hover: surface.field, pressed: colors.pressed, ink: colors.text, edge: colors.separator },
    quiet: { ground: colors.button, hover: colors.separator, pressed: colors.pressed, ink: colors.text, edge: undefined },
    strong: { ground: colors.primary, hover: colors.primaryHover, pressed: colors.primaryPressed, ink: colors.onPrimary, edge: undefined },
  }[tone];
  const down = held || lit;
  return (
    <View
      testID={testID}
      onPress={onPress}
      onPointer={(event: PointerInfo) => setHeld(event.phase !== "up")}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        ...(span === 2 ? { gridColumn: { span: 2 } } : {}),
        borderRadius: KEYPAD_KEY.radius,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: down ? look.pressed : look.ground,
        hoverBackgroundColor: down ? look.pressed : look.hover,
        ...(look.edge ? { borderWidth: KEYPAD_KEY.edge, borderColor: look.edge } : {}),
      }}
    >
      <Text style={{ fontSize, fontWeight: WEIGHT.regular, color: look.ink }}>{label}</Text>
    </View>
  );
}
