/**
 * The Calculator's commands: copy, paste, cut, the tape's show and clear, and
 * the menu bar that names them (menus.ts). The clipboard is the kit's
 * (`Clipboard`); copying shows "Copied" under the line for a moment.
 */

import { type Clipboard, type Size, useAppMenus } from "../../kit/index.ts";
import { copyNumber } from "./format.ts";
import { leastSize, sizeWithTape } from "./layout.ts";
import { selectedText } from "./line.ts";
import type { NumberLocale } from "./locale.ts";
import { calculatorMenus } from "./menus.ts";
import type { CalcAction, CalcState } from "./state.ts";

export interface CalculatorCommands {
  copy(text: string): void;
  copyResult(): void;
  paste(): void;
  clearTape(): void;
}

export interface CalculatorCommandsInput {
  clipboard: Clipboard;
  state: CalcState;
  dispatch: (action: CalcAction) => void;
  locale: NumberLocale;
  showsTape: boolean;
  setShowsTape: (next: boolean) => void;
  size: Size;
  resizeWindow?: (size: Size, least: Size) => void;
  resultValue: Parameters<typeof copyNumber>[0] | null;
}

export function useCalculatorCommands(input: CalculatorCommandsInput): CalculatorCommands {
  const { clipboard, state, dispatch, locale, showsTape, setShowsTape, size, resizeWindow, resultValue } = input;
  const { line } = state;
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

  return { copy, copyResult, paste, clearTape };
}
