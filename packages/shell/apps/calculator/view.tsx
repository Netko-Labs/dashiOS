/**
 * The Calculator's window: the display on top (it is also where the window
 * is grabbed, under the window controls), then the keys on a grid of rounded
 * squares: digits on the card ground, functions and operators on a quiet
 * wash, and kombu only where it means something: the operator waiting for a
 * number (it is chosen) and =, the one primary key. Numbers are written the
 * way the person's region writes them (locale.ts). A right-click on the
 * display offers Copy and Paste, and so does the menu bar's Edit menu, with
 * Clear.
 */

import { KeySink, type MenuItem, type Palette, PopupMenu, type Surface, useColors, useSurface, useTitleBarInset } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useReducer, useState } from "react";
import { type Clipboard, systemClipboard, useAppMenus } from "../kit/index.ts";
import { type CalcKey, type CalcState, clearLabel, INITIAL, type Operator, press } from "./engine.ts";
import { copyText, displayFontSize, displayText } from "./format.ts";
import { calcKeysFor, pasteKeys } from "./keyboard.ts";
import { CALCULATOR_SIZE, DISPLAY, DISPLAY_WIDTH, displayInsets, GAP, KEY, PAD } from "./layout.ts";
import { type NumberLocale, useNumberLocale } from "./locale.ts";
import { calculatorMenus } from "./menus.ts";

export { CALCULATOR_SIZE } from "./layout.ts";

/** A key's corners: the window's radius, so the keys read as tiles of the window rather than buttons floating on it. */
const KEY_RADIUS = 12;

interface KeyLook {
  ground: string;
  hover: string;
  ink: string;
  edge?: string;
}

interface Looks {
  digit: KeyLook;
  /** AC, ±, %, and the operators at rest. */
  quiet: KeyLook;
  /** = and the operator waiting for a number. */
  strong: KeyLook;
}

/** The keys' colors, all from the palette and the surfaces (no hex of their own). */
function looksFrom(colors: Palette, surface: Surface): Looks {
  return {
    digit: { ground: surface.card, hover: surface.field, ink: colors.text, edge: colors.separator },
    quiet: { ground: colors.button, hover: colors.separator, ink: colors.text },
    strong: { ground: colors.selection, hover: colors.selection, ink: "#ffffff" },
  };
}

interface KeySpec {
  id: string;
  label: string;
  key: CalcKey;
  kind: "fn" | "digit" | "op";
  /** Columns it spans (the 0 key spans two). */
  span?: 2;
}

const op = (o: Operator, label: string, id: string): KeySpec => ({ id, label, key: { kind: "operator", op: o }, kind: "op" });
const digit = (d: string, span?: 2): KeySpec => ({ id: d, label: d, key: { kind: "digit", digit: d }, kind: "digit", ...(span ? { span } : {}) });

function rows(state: CalcState, locale: NumberLocale): KeySpec[][] {
  return [
    [
      { id: "clear", label: clearLabel(state), key: { kind: "clear" }, kind: "fn" },
      { id: "negate", label: "±", key: { kind: "negate" }, kind: "fn" },
      { id: "percent", label: "%", key: { kind: "percent" }, kind: "fn" },
      op("÷", "÷", "divide"),
    ],
    [digit("7"), digit("8"), digit("9"), op("×", "×", "multiply")],
    [digit("4"), digit("5"), digit("6"), op("-", "−", "minus")],
    [digit("1"), digit("2"), digit("3"), op("+", "+", "plus")],
    [
      digit("0", 2),
      { id: "decimal", label: locale.decimal, key: { kind: "decimal" }, kind: "digit" },
      { id: "equals", label: "=", key: { kind: "equals" }, kind: "op" },
    ],
  ];
}

function Key({ spec, look, onPress }: { spec: KeySpec; look: KeyLook; onPress: () => void }) {
  const width = spec.span === 2 ? KEY * 2 + GAP : KEY;
  return (
    <View
      testID={`key:${spec.id}`}
      onPress={onPress}
      style={{
        width,
        height: KEY,
        borderRadius: KEY_RADIUS,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
        ...(look.edge ? { borderWidth: 1, borderColor: look.edge } : {}),
      }}
    >
      <Text style={{ fontSize: spec.kind === "op" ? 26 : spec.kind === "fn" ? 20 : 24, fontWeight: spec.kind === "op" ? "medium" : "normal", color: look.ink }}>
        {spec.label}
      </Text>
    </View>
  );
}

export function CalculatorWindow({ clipboard = systemClipboard(), locale: given }: { clipboard?: Clipboard; locale?: NumberLocale }) {
  const colors = useColors();
  const surface = useSurface();
  const looks = looksFrom(colors, surface);
  const inset = useTitleBarInset();
  const followed = useNumberLocale();
  const locale = given ?? followed;
  const [state, dispatch] = useReducer(press, INITIAL);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const text = displayText(state, locale);
  const fontSize = displayFontSize(text, DISPLAY_WIDTH);
  const insets = displayInsets(fontSize);

  const canCopy = clipboard.canWrite && !state.error;
  const copy = (): void => void clipboard.writeText(copyText(state, locale));
  // ❖V, Edit ▸ Paste, and the display's menu; Ctrl+V comes through the sink and reads the same way (keyboard.ts).
  const paste = (): void => void clipboard.readText().then((pasted) => pasteKeys(pasted ?? "", locale).forEach(dispatch));
  const items: MenuItem[] = [
    { label: "Copy", keys: "❖C", disabled: !canCopy, onPress: copy },
    { label: "Paste", keys: "❖V", onPress: paste },
  ];
  // The menu bar's Edit menu (src/app-menus/): ❖C and ❖V are real keys, chosen by the shell.
  const { menus, run } = calculatorMenus({ canCopy, allClear: clearLabel(state) === "AC", actions: { copy, paste, clear: () => dispatch({ kind: "clear" }) } });
  useAppMenus(menus, run);

  return (
    // The keypad keeps its size, centered, when the window is zoomed or full screen.
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: surface.window, position: "relative" }}>
      {/* The menu takes the keys (Esc) while it is open; mounted again after, the sink asks for the keyboard back. */}
      {menu === null && <KeySink onKey={(input) => calcKeysFor(input, locale).forEach(dispatch)} />}
      <View style={{ width: CALCULATOR_SIZE.width, height: CALCULATOR_SIZE.height, flexShrink: 0, flexDirection: "column" }}>
        <View
          testID="display"
          dragRegion
          onContextMenu={(point) => setMenu(point)}
          style={{
            height: DISPLAY,
            flexShrink: 0,
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-end",
            paddingLeft: PAD,
            paddingRight: insets.right,
            paddingTop: inset.top,
            paddingBottom: insets.bottom,
          }}
        >
          {/* A line as tall as the font: displayInsets() places the digits' foot from the box's bottom, which a taller
              default line would push down under the keypad. */}
          <Text numberOfLines={1} style={{ fontSize, lineHeight: fontSize, color: colors.text, textAlign: "right" }}>
            {text}
          </Text>
        </View>
        <View style={{ flexDirection: "column", gap: GAP, paddingHorizontal: PAD, paddingBottom: PAD }}>
          {rows(state, locale).map((row, index) => (
            <View key={index} style={{ flexDirection: "row", gap: GAP }}>
              {row.map((spec) => {
                const chosen = spec.key.kind === "operator" && state.awaiting === spec.key.op;
                const look = chosen || spec.id === "equals" ? looks.strong : spec.kind === "digit" ? looks.digit : looks.quiet;
                return <Key key={spec.id} spec={spec} look={look} onPress={() => dispatch(spec.key)} />;
              })}
            </View>
          ))}
        </View>
      </View>
      {menu !== null && <PopupMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} testID="display-menu" />}
    </View>
  );
}
