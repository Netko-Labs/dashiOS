/**
 * The Calculator's menus in the menu bar (the kit's `useAppMenus`). Edit acts
 * on the expression line as on any field (KB-6: Cut and Copy while text is
 * selected), and its ❖X ❖C ❖V ❖A are these rows, not the field's own
 * (main.tsx), so a paste is always read the line's way and a refused one
 * never lands; plus Copy Result (⇧❖C, what the line works out to, ungrouped) and Clear
 * (Esc); and the tape's commands, on its chosen entry, which its right-click
 * menu names the same way (`TAPE_COMMANDS`, one table: PA-8, UI-17). View
 * shows or hides the tape (❖T), which widens the window by its own width, and
 * clears it. The ❖ chords are real: the shell matches them
 * against the enabled rows (app-menus/shortcut.ts).
 */

import { enabledIds, type MenuSpec } from "../../kit/index.ts";

/** The tape entry's commands, as the Edit menu and the tape's right-click menu both name them. */
export const TAPE_COMMANDS = {
  use: { id: "use-result", label: "Use Result" },
  edit: { id: "edit-sum", label: "Edit Sum" },
  copySum: { id: "copy-sum", label: "Copy Sum" },
} as const;

export interface CalculatorMenuContext {
  /** Text is selected in the line. */
  hasSelection: boolean;
  /** The clipboard can be written. */
  canCopy: boolean;
  /** The line works out to a number (or holds one). */
  hasResult: boolean;
  showsTape: boolean;
  hasTape: boolean;
  /** The tape shows and one of its entries is chosen (the one last pressed, else the newest). */
  hasEntry: boolean;
  actions: {
    cut(): void;
    copy(): void;
    paste(): void;
    selectAll(): void;
    copyResult(): void;
    clear(): void;
    toggleTape(): void;
    clearTape(): void;
    useEntry(): void;
    editEntry(): void;
    copySum(): void;
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
        { ...TAPE_COMMANDS.use, enabled: context.hasEntry },
        { ...TAPE_COMMANDS.edit, enabled: context.hasEntry },
        { ...TAPE_COMMANDS.copySum, enabled: context.hasEntry && context.canCopy },
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
      [TAPE_COMMANDS.use.id]: actions.useEntry,
      [TAPE_COMMANDS.edit.id]: actions.editEntry,
      [TAPE_COMMANDS.copySum.id]: actions.copySum,
    };
    action[id]?.();
  };
  return { menus, run };
}
