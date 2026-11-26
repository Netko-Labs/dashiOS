/** The capsule's small parts: the five dots, a one-line text, a button, Dashi's disc. */

import { AMBER, type ButtonInks, CAPSULE as CAPSULE_INKS, KeyedText, Button as KitButton, MOTION, OPACITY, QUESTION, SPACE, SQUARE, WEIGHT } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Cell } from "../../shared/pill/index.ts";
import { useFaceMark } from "./face-scope.tsx";
import { CAPSULE, type CapsuleColours } from "./measures.ts";

/** The five dots' heights at a level: dots at rest, bars as the voice rises, the middle one tallest. */
export const dotHeights = (level: number): number[] =>
  [0.38, 0.73, 1, 0.65, 0.35].map(
    (weight) => Math.round((CAPSULE.dot + (CAPSULE.dotsHeight - CAPSULE.dot) * Math.min(1, Math.max(0, level)) * weight) * 2) / 2,
  );

/** The voice: five dots that move with the microphone's level. Still (dots only) with Reduce Motion or no level. */
export function Dots({ level, color, dim = false }: { level: Pick<Cell<number>, "subscribe" | "getSnapshot"> | null; color: string; dim?: boolean }) {
  const now = useSyncExternalStore(level?.subscribe ?? NEVER, level?.getSnapshot ?? ZERO);
  return (
    <View
      testID="capsule-dots"
      style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: CAPSULE.dotGap, height: CAPSULE.dotsHeight, opacity: dim ? OPACITY.half : 1 }}
    >
      {dotHeights(level ? now : 0).map((height, index) => (
        // The dots never reorder.
        <View key={index} style={{ width: CAPSULE.dot, height, borderRadius: CAPSULE.dot / 2, backgroundColor: color }} />
      ))}
    </View>
  );
}
const NEVER = (): (() => void) => () => {};
const ZERO = (): number => 0;

/** Three small dots, one lit in turn, while Dashi works; all lit and still with Reduce Motion. */
export function Working({ color, still }: { color: string; still: boolean }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setLit((now) => (now + 1) % 3), MOTION.pulse);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <View testID="capsule-working" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.xxs }}>
      {[0, 1, 2].map((dot) => (
        <View
          key={dot}
          style={{
            width: CAPSULE.dot,
            height: CAPSULE.dot,
            borderRadius: CAPSULE.dot / 2,
            backgroundColor: color,
            opacity: still || dot === lit ? 1 : OPACITY.disabled,
          }}
        />
      ))}
    </View>
  );
}

/** One line of words in a box that keeps its own width (voice/chip.tsx says why). */
export function Line({
  children,
  color,
  bold = false,
  size = CAPSULE.fontSize,
  testID,
}: {
  children: string;
  color: string;
  bold?: boolean;
  size?: number;
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ flexShrink: 0 }}>
      {/* A line may name keys ("Hold ❖Space to talk"): drawn at the text's size. */}
      <KeyedText oneLine style={{ fontSize: size, color, fontWeight: bold ? WEIGHT.semibold : WEIGHT.regular }}>
        {children}
      </KeyedText>
    </View>
  );
}

/** The thin line between the words and what can be pressed. */
export const Separator = ({ color }: { color: string }) => (
  <View style={{ flexShrink: 0, width: 1, height: 13, backgroundColor: color, opacity: OPACITY.half }} />
);

interface ButtonProps {
  label: string;
  colours: CapsuleColours;
  onPress(): void;
  /** Filled: the one that says yes. */
  primary?: boolean;
  /** A square before the word: Stop. */
  square?: boolean;
  /** The keys that do the same, after the word, soft. */
  keys?: string;
  /** Not armed yet, or not for now: drawn faint, and a press does nothing. */
  off?: boolean;
  /** The card's size (24), not the line's (22). */
  card?: boolean;
  testID?: string;
}

/** The persona's colours as the kit's capsule look takes them (UI-8): words and outline, the yes filled. */
export const buttonInks = (colours: CapsuleColours): ButtonInks => ({
  ink: colours.text,
  ground: colours.fill,
  edge: colours.rim,
  fill: colours.primary,
  onFill: colours.onPrimary,
  soft: colours.soft,
});

/** A button of the capsule (small) or the card: the kit's Button in its capsule look, an outline, or filled for the yes. */
export function Button({ label, colours, onPress, primary = false, square = false, off = false, keys, card = false, testID }: ButtonProps) {
  return (
    <KitButton
      testID={testID ?? `capsule-button:${label}`}
      label={label}
      look="capsule"
      size={card ? "regular" : "small"}
      inks={buttonInks(colours)}
      {...(primary ? { primary } : {})}
      {...(square ? { glyph: SQUARE } : {})}
      {...(keys ? { keys } : {})}
      disabled={off}
      onPress={onPress}
    />
  );
}

/**
 * Dashi's disc: its mark on white (on the solid line); `filled`, white on the persona's colour (on the
 * card's glass, board 17); a question mark on amber when it needs the person.
 */
export function Disc({
  colours,
  size = CAPSULE.disc,
  asks = false,
  filled = false,
}: {
  colours: CapsuleColours;
  size?: number;
  asks?: boolean;
  filled?: boolean;
}) {
  const mark = useFaceMark();
  return (
    <View
      testID={asks ? "capsule-disc:asks" : "capsule-disc"}
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: asks ? colours.amber : filled ? colours.fill : CAPSULE_INKS.white,
      }}
    >
      {asks ? (
        <Svg markup={QUESTION} size={Math.round(size * 0.62)} color={AMBER.ink} />
      ) : (
        <Svg markup={mark} size={Math.round(size * 0.58)} color={filled ? CAPSULE_INKS.white : colours.fill} />
      )}
    </View>
  );
}
