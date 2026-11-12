/**
 * The keypad: a grid of rounded squares under the display, centred in its
 * column; the keys grow with the window and stay square (`keypadLayout`).
 * Digits on the card ground, functions and operators on a quiet wash, and =,
 * the one primary key, in ink (the Expressive fill): kombu means on (CO-2),
 * and = turns nothing on. A key deepens while it is held (UI-4), and flashes
 * when the keyboard types it, so typing shows on the keys too. The keys type
 * into the expression line as the keyboard does.
 */

import { type Palette, type Surface, useColors, useSurface } from "@dashi/ui";
import { type PointerInfo, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { KeyId } from "./keys.ts";
import { COLUMNS, GAP, type KeypadLayout, keyFontSize, ROWS } from "./layout.ts";
import type { NumberLocale } from "./locale.ts";

/** What a screen reader says for a key whose label is a symbol. */
const LABELS: Partial<Record<KeyId, string>> = {
  clear: "Clear",
  negate: "Change sign",
  percent: "Percent",
  divide: "Divide",
  multiply: "Multiply",
  minus: "Minus",
  plus: "Plus",
  equals: "Equals",
  decimal: "Decimal point",
};

/** A key's corners: the window's radius, so the keys read as tiles of the window. */
const KEY_RADIUS = 12;

interface KeyLook {
  ground: string;
  hover: string;
  pressed: string;
  ink: string;
  edge?: string;
}

interface Looks {
  digit: KeyLook;
  /** C, ±, % and the operators. */
  quiet: KeyLook;
  /** =: ink, the ground's color for its label. */
  strong: KeyLook;
}

/** The keys' colors, all from the palette and the surfaces. */
function looksFrom(colors: Palette, surface: Surface): Looks {
  return {
    digit: { ground: surface.card, hover: surface.field, pressed: colors.pressed, ink: colors.text, edge: colors.separator },
    quiet: { ground: colors.button, hover: colors.separator, pressed: colors.pressed, ink: colors.text },
    strong: { ground: colors.text, hover: colors.text, pressed: colors.textMuted, ink: surface.window },
  };
}

interface KeySpec {
  id: KeyId;
  label: string;
  kind: "fn" | "digit" | "op";
  /** Columns it spans (the 0 key spans two). */
  span?: 2;
}

const digit = (d: KeyId & `${number}`, span?: 2): KeySpec => ({ id: d, label: d, kind: "digit", ...(span ? { span } : {}) });

/** The keys in reading order, five rows of four (0 takes two). */
export function keySpecs(locale: NumberLocale): KeySpec[] {
  return [
    { id: "clear", label: "C", kind: "fn" },
    { id: "negate", label: "±", kind: "fn" },
    { id: "percent", label: "%", kind: "fn" },
    { id: "divide", label: "÷", kind: "op" },
    digit("7"),
    digit("8"),
    digit("9"),
    { id: "multiply", label: "×", kind: "op" },
    digit("4"),
    digit("5"),
    digit("6"),
    { id: "minus", label: "−", kind: "op" },
    digit("1"),
    digit("2"),
    digit("3"),
    { id: "plus", label: "+", kind: "op" },
    digit("0", 2),
    { id: "decimal", label: locale.decimal, kind: "digit" },
    { id: "equals", label: "=", kind: "op" },
  ];
}

function Key({ spec, look, side, lit, onPress }: { spec: KeySpec; look: KeyLook; side: number; lit: boolean; onPress: () => void }) {
  const [held, setHeld] = useState(false);
  const font = keyFontSize(side);
  // One size per kind: the function row (C ± %) matches itself, the operators a touch larger and heavier.
  const fontSize = spec.kind === "op" ? font + 2 : spec.kind === "fn" ? font - 4 : font;
  return (
    <View
      testID={`key:${spec.id}`}
      onPress={onPress}
      onPointer={(event: PointerInfo) => setHeld(event.phase !== "up")}
      accessibilityRole="button"
      accessibilityLabel={LABELS[spec.id] ?? spec.label}
      style={{
        ...(spec.span === 2 ? { gridColumn: { span: 2 } } : {}),
        borderRadius: KEY_RADIUS,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: held || lit ? look.pressed : look.ground,
        hoverBackgroundColor: held || lit ? look.pressed : look.hover,
        ...(look.edge ? { borderWidth: 1, borderColor: look.edge } : {}),
      }}
    >
      <Text style={{ fontSize, fontWeight: spec.kind === "op" ? "medium" : "normal", color: look.ink }}>{spec.label}</Text>
    </View>
  );
}

export interface KeypadProps {
  locale: NumberLocale;
  /** The keys' side and the grid's inset (`keypadLayout`). */
  layout: KeypadLayout;
  /** The key the keyboard just typed, lit for a moment. */
  lit: KeyId | null;
  onKey: (id: KeyId) => void;
}

export function Keypad({ locale, layout, lit, onKey }: KeypadProps) {
  const looks = looksFrom(useColors(), useSurface());
  const { side, inset, height } = layout;
  return (
    <View
      testID="keypad"
      style={{
        height,
        flexShrink: 0,
        display: "grid",
        // Square tracks: the keys keep their shape at every size; the column's spare width is the inset.
        gridTemplateColumns: Array.from({ length: COLUMNS }, () => side),
        gridTemplateRows: Array.from({ length: ROWS }, () => side),
        gap: GAP,
        paddingLeft: inset,
        paddingRight: inset,
        paddingBottom: height - (side * ROWS + GAP * (ROWS - 1)),
      }}
    >
      {keySpecs(locale).map((spec) => (
        <Key
          key={spec.id}
          spec={spec}
          look={spec.id === "equals" ? looks.strong : spec.kind === "digit" ? looks.digit : looks.quiet}
          side={side}
          lit={lit === spec.id}
          onPress={() => onKey(spec.id)}
        />
      ))}
    </View>
  );
}
