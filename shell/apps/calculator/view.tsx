/**
 * The Calculator's window: the display on top (it is also where the window
 * is grabbed, under the window controls), then the keys, round as on the Mac
 * since Sequoia: the functions (AC, ±, %) in a lighter grey, the digits, and
 * the operators on Dashi's accent, the waiting one turned white. A
 * right-click on the display offers Copy and Paste, and so does the menu
 * bar's Edit menu, with Clear.
 */

import { Text, View } from "@mirinjs/metal";
import { useReducer, useState } from "react";
import { darkColors } from "../../src/theme.ts";
import { type Clipboard, KeySink, type MenuItem, PopupMenu, systemClipboard, useAppMenus, useColors, useTitleBarInset } from "../kit/index.ts";
import { type CalcKey, type CalcState, clearLabel, INITIAL, type Operator, press } from "./engine.ts";
import { copyText, displayFontSize, displayText, parsePasted } from "./format.ts";
import { calcKeysFor } from "./keyboard.ts";
import { calculatorMenus } from "./menus.ts";

export const KEY = 54;
export const GAP = 10;
export const PAD = 14;
const DISPLAY = 104;
const COLUMNS = 4;

/** The window's size: four keys across, a display and five rows down. */
export const CALCULATOR_SIZE = {
  width: PAD * 2 + KEY * COLUMNS + GAP * (COLUMNS - 1),
  height: DISPLAY + KEY * 5 + GAP * 4 + PAD,
} as const;

interface KeyLook {
  ground: string;
  hover: string;
  ink: string;
}

interface Looks {
  window: string;
  fn: KeyLook;
  digit: KeyLook;
  op: KeyLook;
  /** The operator waiting for a number. */
  opChosen: KeyLook;
}

function useLooks(): Looks {
  const colors = useColors();
  const dark = colors === darkColors;
  const accent = colors.selection;
  return dark
    ? {
        window: "#1c1c1e",
        fn: { ground: "#5c5c60", hover: "#6c6c70", ink: "#ffffff" },
        digit: { ground: "#38383b", hover: "#48484c", ink: "#ffffff" },
        op: { ground: accent, hover: "#4fa085", ink: "#ffffff" },
        opChosen: { ground: "#f5f5f7", hover: "#ffffff", ink: accent },
      }
    : {
        window: "#ececef",
        fn: { ground: "#d2d2d7", hover: "#c6c6cc", ink: "#1d1d1f" },
        digit: { ground: "#ffffff", hover: "#f4f4f6", ink: "#1d1d1f" },
        op: { ground: accent, hover: "#357a64", ink: "#ffffff" },
        opChosen: { ground: "#ffffff", hover: "#f4f4f6", ink: accent },
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

function rows(state: CalcState): KeySpec[][] {
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
    [digit("0", 2), { id: "decimal", label: ".", key: { kind: "decimal" }, kind: "digit" }, { id: "equals", label: "=", key: { kind: "equals" }, kind: "op" }],
  ];
}

function Key({ spec, look, onPress }: { spec: KeySpec; look: KeyLook; onPress: () => void }) {
  const width = spec.span === 2 ? KEY * 2 + GAP : KEY;
  const symbol = spec.kind === "op" || spec.id === "negate";
  return (
    <View
      testID={`key:${spec.id}`}
      onPress={onPress}
      style={{
        width,
        height: KEY,
        borderRadius: KEY / 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: spec.span === 2 ? "flex-start" : "center",
        paddingLeft: spec.span === 2 ? KEY / 2 - 8 : 0,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      <Text style={{ fontSize: symbol ? 26 : spec.kind === "fn" ? 19 : 24, fontWeight: spec.kind === "op" ? "medium" : "normal", color: look.ink }}>{spec.label}</Text>
    </View>
  );
}

export function CalculatorWindow({ clipboard = systemClipboard() }: { clipboard?: Clipboard }) {
  const colors = useColors();
  const looks = useLooks();
  const inset = useTitleBarInset();
  const [state, dispatch] = useReducer(press, INITIAL);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const text = displayText(state);
  const width = CALCULATOR_SIZE.width - PAD * 2;

  const canCopy = clipboard.canWrite && !state.error;
  const copy = (): void => void clipboard.writeText(copyText(state));
  const paste = (): void =>
    void clipboard.readText().then((pasted) => {
      const value = pasted === null ? null : parsePasted(pasted);
      if (value !== null) dispatch({ kind: "number", value });
    });
  const items: MenuItem[] = [
    { label: "Copy", keys: "❖C", disabled: !canCopy, onPress: copy },
    { label: "Paste", keys: "❖V", onPress: paste },
  ];
  // The menu bar's Edit menu (src/app-menus/): ❖C and ❖V are real keys, chosen by the shell.
  const { menus, run } = calculatorMenus({ canCopy, allClear: clearLabel(state) === "AC", actions: { copy, paste, clear: () => dispatch({ kind: "clear" }) } });
  useAppMenus(menus, run);

  return (
    // The keypad keeps its size, centered, when the window is zoomed or full screen.
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: looks.window, position: "relative" }}>
      {/* The menu takes the keys (Esc) while it is open; mounted again after, the sink asks for the keyboard back. */}
      {menu === null && <KeySink onKey={(input) => calcKeysFor(input).forEach(dispatch)} />}
      <View style={{ width: CALCULATOR_SIZE.width, height: CALCULATOR_SIZE.height, flexShrink: 0, flexDirection: "column" }}>
        <View
          testID="display"
          dragRegion
          onContextMenu={(point) => setMenu(point)}
          style={{ height: DISPLAY, flexShrink: 0, flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-end", paddingHorizontal: PAD + 6, paddingTop: inset.top, paddingBottom: 6 }}
        >
          <Text numberOfLines={1} style={{ fontSize: displayFontSize(text, width - 12), color: colors.text, textAlign: "right" }}>
            {text}
          </Text>
        </View>
        <View style={{ flexDirection: "column", gap: GAP, paddingHorizontal: PAD, paddingBottom: PAD }}>
          {rows(state).map((row, index) => (
            <View key={index} style={{ flexDirection: "row", gap: GAP }}>
              {row.map((spec) => {
                const chosen = spec.key.kind === "operator" && state.awaiting === spec.key.op;
                const look = chosen ? looks.opChosen : looks[spec.kind];
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
