/**
 * The keypad: a grid of rounded squares under the display, centred in its
 * column; the keys grow with the window and stay square (`keypadLayout`).
 * The keys are the kit's `KeypadKey`: digits on the card ground, functions
 * and operators on a quiet wash, and =, the one primary key, in ink: kombu
 * means on (CO-2), and = turns nothing on. A key deepens while it is held
 * (UI-4), and flashes when the keyboard types it, so typing shows on the keys
 * too. Every label is 400 (TY-2). The keys type
 * into the expression line as the keyboard does.
 */

import { KeypadKey } from "@dashi/ui";
import { View } from "@mirinjs/metal";
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

/** How much larger an operator's words are than a digit's, and how much smaller the function row's (C ± %). */
const OP_STEP = 2;
const FN_STEP = 4;

/** Each key's words: one size per kind, fitted to the key (all 400, TY-2). */
function labelSize(spec: KeySpec, side: number): number {
  const font = keyFontSize(side);
  return spec.kind === "op" ? font + OP_STEP : spec.kind === "fn" ? font - FN_STEP : font;
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
        <KeypadKey
          key={spec.id}
          testID={`key:${spec.id}`}
          label={spec.label}
          accessibilityLabel={LABELS[spec.id] ?? spec.label}
          tone={spec.id === "equals" ? "strong" : spec.kind === "digit" ? "digit" : "quiet"}
          fontSize={labelSize(spec, side)}
          lit={lit === spec.id}
          {...(spec.span ? { span: spec.span } : {})}
          onPress={() => onKey(spec.id)}
        />
      ))}
    </View>
  );
}
