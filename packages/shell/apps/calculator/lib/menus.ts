/**
 * The Calculator's menus in the menu bar (the kit's `useAppMenus`). Edit acts
 * on the expression line as on any field (KB-6: Cut and Copy while text is
 * selected), and its ❖X ❖C ❖V ❖A are these rows, not the field's own
 * (main.tsx), so a paste is always read the line's way and a refused one
 * never lands; plus Copy Result (⇧❖C, what the line works out to, ungrouped) and Clear
 * (Esc). View shows or hides the tape (❖T), which widens the window by its
 * own width, and clears it. The ❖ chords are real: the shell matches them
 * against the enabled rows (app-menus/shortcut.ts).
 */

import { enabledIds, type MenuSpec } from "../../kit/index.ts";

export interface CalculatorMenuContext {
  /** Text is selected in the line. */
  hasSelection: boolean;
  /** The clipboard can be written. */
  canCopy: boolean;
  /** The line works out to a number (or holds one). */
  hasResult: boolean;
  showsTape: boolean;
  hasTape: boolean;
  actions: {
    cut(): void;
    copy(): void;
    paste(): void;
    selectAll(): void;
    copyResult(): void;
    clear(): void;
    toggleTape(): void;
    clearTape(): void;
  };
}

export function calculatorMenus(context: CalculatorMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions } = context;
  const menus: MenuSpec[] = [
    {
      id: "edit",
      items: [
        { id: "cut", label: "Cut", shortcut: "❖X", enabled: context.hasSelection && context.canCopy },
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: context.hasSelection && context.canCopy },
        { id: "paste", label: "Paste", shortcut: "❖V" },
        { id: "select-all", label: "Select All", shortcut: "❖A" },
        { type: "separator" },
        { id: "copy-result", label: "Copy Result", shortcut: "⇧❖C", enabled: context.hasResult && context.canCopy },
        { type: "separator" },
        { id: "clear", label: "Clear", shortcut: "Esc" },
      ],
    },
    {
      id: "view",
      items: [
        { id: "tape", label: context.showsTape ? "Hide Tape" : "Show Tape", shortcut: "❖T" },
        { id: "clear-tape", label: "Clear Tape", enabled: context.hasTape },
      ],
    },
  ];
  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    const action: Record<string, () => void> = {
      cut: actions.cut,
      copy: actions.copy,
      paste: actions.paste,
      "select-all": actions.selectAll,
      "copy-result": actions.copyResult,
      clear: actions.clear,
      tape: actions.toggleTape,
      "clear-tape": actions.clearTape,
    };
    action[id]?.();
  };
  return { menus, run };
}
