/** The capsule's small parts: the five dots, a one-line text, a button, Dashi's disc. */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Cell } from "../../shared/pill/index.ts";
import { SPARK } from "../../shared/settings/index.ts";
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
      style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: CAPSULE.dotGap, height: CAPSULE.dotsHeight, opacity: dim ? 0.5 : 1 }}
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
    const timer = setInterval(() => setLit((now) => (now + 1) % 3), 320);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <View testID="capsule-working" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 3 }}>
      {[0, 1, 2].map((dot) => (
        <View
          key={dot}
          style={{ width: CAPSULE.dot, height: CAPSULE.dot, borderRadius: CAPSULE.dot / 2, backgroundColor: color, opacity: still || dot === lit ? 1 : 0.4 }}
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
      <Text numberOfLines={1} style={{ fontSize: size, color, fontWeight: bold ? "semibold" : "normal" }}>
        {children}
      </Text>
    </View>
  );
}

/** The thin line between the words and what can be pressed. */
export const Separator = ({ color }: { color: string }) => <View style={{ flexShrink: 0, width: 1, height: 13, backgroundColor: color, opacity: 0.5 }} />;

interface ButtonProps {
  label: string;
  colours: CapsuleColours;
  onPress(): void;
  /** Filled: the one that says yes. */
  primary?: boolean;
  /** A square before the word: Stop. */
  square?: boolean;
  /** Not armed yet, or not for now: drawn faint, and a press does nothing. */
  off?: boolean;
  measures?: { height: number; paddingX: number; fontSize: number };
  testID?: string;
}

/** A button of the capsule or the card: an outline, or filled for the yes. */
export function Button({ label, colours, onPress, primary = false, square = false, off = false, measures = CAPSULE.button, testID }: ButtonProps) {
  const color = primary ? colours.onPrimary : colours.text;
  return (
    <View
      testID={testID ?? `capsule-button:${label}`}
      onPress={() => {
        if (!off) onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: CAPSULE.button.gap,
        height: measures.height,
        paddingLeft: measures.paddingX,
        paddingRight: measures.paddingX,
        borderRadius: measures.height / 2,
        backgroundColor: primary ? colours.primary : "#00000000",
        borderWidth: primary ? 0 : 1,
        borderColor: colours.text,
        opacity: off ? 0.45 : 1,
      }}
    >
      {square && <View style={{ flexShrink: 0, alignSelf: "center", width: CAPSULE.stop, height: CAPSULE.stop, borderRadius: 2, backgroundColor: color }} />}
      <Text numberOfLines={1} style={{ fontSize: measures.fontSize, fontWeight: "semibold", color }}>
        {label}
      </Text>
    </View>
  );
}

/** Dashi's disc: its mark on white; a question mark on amber when it needs the person. */
export function Disc({ colours, size = CAPSULE.disc, asks = false }: { colours: CapsuleColours; size?: number; asks?: boolean }) {
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
        backgroundColor: asks ? colours.amber : "#ffffff",
      }}
    >
      {asks ? (
        <Text style={{ fontSize: size * 0.62, fontWeight: "bold", color: "#1d1d1f" }}>?</Text>
      ) : (
        <Svg markup={SPARK} size={Math.round(size * 0.58)} color={colours.fill} />
      )}
    </View>
  );
}
