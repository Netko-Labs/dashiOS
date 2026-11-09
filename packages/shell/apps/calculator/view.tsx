/**
 * The Calculator's window: the expression line on top, editable like any
 * field (KB-6), with what it works out to under it; the keypad below, which
 * types into the line as the keyboard does; and, when shown, the tape beside
 * it (View ▸ Show Tape), which widens the window rather than squeezing the
 * keys, and the window's least size with it. The keys stay square; the
 * display takes the height they leave, and the line, its result and the keys
 * share one right edge. The display is also where the window is grabbed, under the window
 * controls. Numbers are written the way the person's region writes them
 * (locale.ts). The tape, whether it shows, and the window's size are
 * remembered (store.ts).
 */

import { PopupMenu, useColors, useSurface, useTitleBarInset } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useReducer, useRef, useState } from "react";
import { type Clipboard, type Size, systemClipboard, useAppMenus } from "../kit/index.ts";
import { copyNumber, fitFontSize } from "./format.ts";
import { Keypad } from "./keypad.tsx";
import { DISPLAY, GAP, keypadLayout, LINE_LARGEST, LINE_SMALLEST, leastSize, openingSize, sizeWithTape, TAPE_WIDTH } from "./layout.ts";
import { liveResult, selectedText } from "./line.ts";
import { type NumberLocale, useNumberLocale } from "./locale.ts";
import { calculatorMenus } from "./menus.ts";
import { calculate, initialState } from "./state.ts";
import { FRESH, type Remembered, writeRemembered } from "./store.ts";
import { type MenuAt, Tape } from "./tape.tsx";
import { resultWords } from "./words.ts";

/** How long a key the keyboard typed stays lit. */
const LIT_MS = 120;
/** How long a word under the line ("Copied") stays. */
const NOTICE_MS = 2000;
/** Saving waits for the window to stop changing size. */
const SAVE_MS = 400;
const CLEAR = "#00000000";
/** The words under the line: 17 px, down to 11 when they need the room. */
const WORDS_LARGEST = 17;
const WORDS_SMALLEST = 11;

export interface CalculatorWindowProps {
  clipboard?: Clipboard;
  locale?: NumberLocale;
  /** What the last launch left: the tape, whether it showed, the window's size. */
  remembered?: Remembered;
  /** Asks for a window size and the least it may be made: the tape widens both when it shows. */
  resizeWindow?: (size: Size, least: Size) => void;
  /** Keeps what is remembered; the state file by default. */
  remember?: (remembered: Remembered) => void;
}

export function CalculatorWindow({
  clipboard: givenClipboard,
  locale: given,
  remembered = FRESH,
  resizeWindow,
  remember = writeRemembered,
}: CalculatorWindowProps) {
  // wl-copy and wl-paste are looked up once, not on every render.
  const [clipboard] = useState(() => givenClipboard ?? systemClipboard());
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  const followed = useNumberLocale();
  const locale = given ?? followed;
  const [state, dispatch] = useReducer(calculate, remembered.tape, initialState);
  const [showsTape, setShowsTape] = useState(remembered.showsTape);
  // What the window opened at, until the window says (the root's layout, on every change).
  const [size, setSize] = useState<Size>(() => openingSize(remembered.size, remembered.showsTape));
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // A new field asks for the keyboard (autoFocus): how the line takes it back after a menu.
  const [fieldKey, setFieldKey] = useState(0);
  const { line } = state;

  useEffect(() => {
    if (state.lit === null) return;
    const timer = setTimeout(() => dispatch({ type: "unlit" }), LIT_MS);
    return () => clearTimeout(timer);
  }, [state.lit]);
  useEffect(() => {
    if (state.notice === null) return;
    const timer = setTimeout(() => dispatch({ type: "notice", notice: null }), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice]);
  // The region changed: the line is rewritten in its marks, or "1.250" would read as 1.25.
  const shownIn = useRef(locale);
  useEffect(() => {
    if (shownIn.current === locale) return;
    dispatch({ type: "relocale", from: shownIn.current, to: locale });
    shownIn.current = locale;
  }, [locale]);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    const next: Remembered = { tape: state.tape, showsTape, size };
    const key = JSON.stringify(next);
    if (saved.current === null) {
      // What was just read needs no writing back.
      saved.current = JSON.stringify(remembered);
    }
    if (key === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = key;
      remember(next);
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [state.tape, showsTape, size, remember, remembered]);

  const outcome = liveResult(line, locale);
  const resultValue = outcome.kind === "value" ? outcome.value : line.carry && line.text === line.carry.text ? line.carry.value : null;
  const copy = (text: string): void => {
    void clipboard.writeText(text).then((done) => done && dispatch({ type: "notice", notice: "copied" }));
  };
  const copyResult = (): void => {
    if (resultValue !== null) copy(copyNumber(resultValue, locale));
  };
  const paste = (): void => {
    void clipboard.readText().then((text) => dispatch({ type: "paste", text: text ?? "", locale }));
  };
  const toggleTape = (): void => {
    const next = !showsTape;
    setShowsTape(next);
    resizeWindow?.(sizeWithTape(size, next), leastSize(next));
  };
  const clearTape = (): void => dispatch({ type: "clear-tape" });
  const { menus, run } = calculatorMenus({
    hasSelection: line.selection.start !== line.selection.end,
    canCopy: clipboard.canWrite,
    hasResult: resultValue !== null,
    showsTape,
    hasTape: state.tape.length > 0,
    actions: {
      cut: () => {
        copy(selectedText(line));
        dispatch({ type: "cut", locale });
      },
      copy: () => copy(selectedText(line)),
      paste,
      selectAll: () => dispatch({ type: "select-all" }),
      copyResult,
      clear: () => dispatch({ type: "clear" }),
      toggleTape,
      clearTape,
    },
  });
  useAppMenus(menus, run);

  const closeMenu = (): void => {
    setMenu(null);
    setFieldKey((key) => key + 1);
  };
  const keypadWidth = size.width - (showsTape ? TAPE_WIDTH : 0);
  const keys = keypadLayout(keypadWidth, size.height);
  // The line's room: the column less the keys' inset each side, so it ends where the keys do.
  const room = Math.max(LINE_SMALLEST, keypadWidth - keys.inset * 2);
  const fontSize = fitFontSize(line.text || "0", room, LINE_LARGEST, LINE_SMALLEST);
  const words = resultWords(state.notice ? { kind: "notice", notice: state.notice } : outcome, locale);
  // The words under the line fit the display on their one row: smaller when they are long, never cut.
  const wordsSize = fitFontSize(words.text, room, WORDS_LARGEST, WORDS_SMALLEST);

  return (
    <View
      testID="calculator"
      onLayout={(bounds) => {
        const next = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
        setSize((old) => (old.width === next.width && old.height === next.height ? old : next));
      }}
      style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window, position: "relative" }}
    >
      <View style={{ flex: 1, flexDirection: "column" }}>
        <View
          testID="display"
          dragRegion
          onContextMenu={(point) =>
            setMenu({
              x: point.x,
              y: point.y,
              items: [
                { label: "Copy Result", keys: "⇧❖C", disabled: resultValue === null || !clipboard.canWrite, onPress: copyResult },
                { label: "Paste", keys: "❖V", onPress: paste },
              ],
            })
          }
          style={{
            flex: 1,
            minHeight: DISPLAY,
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-end",
            gap: 2,
            paddingLeft: keys.inset,
            paddingRight: keys.inset,
            paddingTop: inset.top,
            paddingBottom: GAP,
          }}
        >
          <TextInput
            key={fieldKey}
            testID="line"
            value={line.text}
            valueRevision={state.revision}
            selection={line.selection}
            placeholder="0"
            autoFocus
            accessibilityLabel="Sum"
            onChangeText={(text) => dispatch({ type: "field", text, locale })}
            onSelectionChange={(selection) => dispatch({ type: "select", selection })}
            onSubmitEditing={() => dispatch({ type: "equals", locale })}
            onKeyPress={(key) => dispatch(key === "Escape" ? { type: "clear" } : { type: "recall", step: key === "ArrowUp" ? 1 : -1, locale })}
            style={{
              // All the room, the text at its right edge: it ends where the result and the keys do, and a long line scrolls to the caret.
              width: "100%",
              textAlign: "right",
              height: Math.round(fontSize * 1.25),
              fontSize,
              padding: 0,
              color: colors.text,
              placeholderColor: colors.text,
              backgroundColor: CLEAR,
              borderColor: CLEAR,
              focusBorderColor: CLEAR,
            }}
          />
          <View
            testID="result"
            accessibilityLiveRegion="polite"
            accessibilityLabel={words.text}
            style={{ height: 22, flexDirection: "row", justifyContent: "flex-end" }}
          >
            <Text
              numberOfLines={1}
              style={{ fontSize: wordsSize, lineHeight: 22, color: words.tone === "error" ? colors.ume : colors.textMuted, textAlign: "right" }}
            >
              {words.text}
            </Text>
          </View>
        </View>
        <Keypad locale={locale} layout={keys} lit={state.lit} onKey={(id) => dispatch({ type: "key", id, locale })} />
      </View>
      {showsTape && (
        <Tape
          tape={state.tape}
          locale={locale}
          headHeight={inset.top}
          canCopy={clipboard.canWrite}
          onUse={(entry) => dispatch({ type: "use", value: entry.value, locale })}
          onEdit={(index) => dispatch({ type: "recall-entry", index, locale })}
          onCopy={copy}
          onCopyResult={(entry) => copy(copyNumber(entry.value, locale))}
          onClear={clearTape}
          onMenu={setMenu}
        />
      )}
      {menu !== null && <PopupMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} testID="calculator-menu" />}
    </View>
  );
}
