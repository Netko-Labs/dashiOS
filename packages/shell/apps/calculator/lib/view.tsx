/**
 * The Calculator's window: the expression line on top, editable like any
 * field (KB-6), with what it works out to under it; the keypad below, which
 * types into the line as the keyboard does; and, when shown, the tape beside
 * it (View ▸ Show Tape), which widens the window rather than squeezing the
 * keys, and the window's least size with it. The keys stay square; the
 * display takes the height they leave, and the line, its result and the keys
 * share one right edge. The display itself is display.tsx; the state and what
 * it remembers are use-calculator-state.ts, the commands are
 * use-calculator-commands.ts. Numbers are written the way the person's region
 * writes them (locale.ts). The tape, whether it shows, and the window's size
 * are remembered (store.ts).
 */

import { PopupMenu, useSurface, useTitleBarInset } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { type Clipboard, type Size, systemClipboard } from "../../kit/index.ts";
import { CalculatorDisplay } from "./display.tsx";
import { copyNumber } from "./format.ts";
import { Keypad } from "./keypad.tsx";
import { keypadLayout, LINE_SMALLEST, TAPE_WIDTH } from "./layout.ts";
import { liveResult } from "./line.ts";
import { type NumberLocale, useNumberLocale } from "./locale.ts";
import { FRESH, type Remembered, writeRemembered } from "./store.ts";
import { type MenuAt, Tape } from "./tape.tsx";
import { useCalculatorCommands } from "./use-calculator-commands.ts";
import { useCalculatorState } from "./use-calculator-state.ts";
import { resultWords } from "./words.ts";

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

/** The right-click menu, and the line's key: a new field asks for the keyboard (autoFocus), which is how the line takes it back after a menu. */
function useMenu(): { menu: MenuAt | null; setMenu: (menu: MenuAt | null) => void; closeMenu: () => void; fieldKey: number } {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [fieldKey, setFieldKey] = useState(0);
  const closeMenu = (): void => {
    setMenu(null);
    setFieldKey((key) => key + 1);
  };
  return { menu, setMenu, closeMenu, fieldKey };
}

/** The keys' layout, and the line's room: the column less the keys' inset each side, so it ends where the keys do. */
function layoutOf(size: Size, showsTape: boolean): { keys: ReturnType<typeof keypadLayout>; room: number } {
  const keypadWidth = size.width - (showsTape ? TAPE_WIDTH : 0);
  const keys = keypadLayout(keypadWidth, size.height);
  return { keys, room: Math.max(LINE_SMALLEST, keypadWidth - keys.inset * 2) };
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
  const surface = useSurface();
  const inset = useTitleBarInset();
  const followed = useNumberLocale();
  const locale = given ?? followed;
  const { state, dispatch, showsTape, setShowsTape, size, setSize } = useCalculatorState(remembered, locale, remember);
  const { menu, setMenu, closeMenu, fieldKey } = useMenu();
  const { line } = state;
  const outcome = liveResult(line, locale);
  const resultValue = outcome.kind === "value" ? outcome.value : line.carry && line.text === line.carry.text ? line.carry.value : null;
  const { copy, copyResult, paste, clearTape } = useCalculatorCommands({
    clipboard,
    state,
    dispatch,
    locale,
    showsTape,
    setShowsTape,
    size,
    resizeWindow,
    resultValue,
  });
  const { keys, room } = layoutOf(size, showsTape);
  const words = resultWords(state.notice ? { kind: "notice", notice: state.notice } : outcome, locale);

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
        <CalculatorDisplay
          line={line}
          revision={state.revision}
          fieldKey={fieldKey}
          locale={locale}
          dispatch={dispatch}
          words={words}
          room={room}
          keysInset={keys.inset}
          titleInset={inset.top}
          resultValue={resultValue}
          canWrite={clipboard.canWrite}
          copyResult={copyResult}
          paste={paste}
          onMenu={setMenu}
        />
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
