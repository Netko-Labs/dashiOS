/**
 * The Calculator's menu in the menu bar (the kit's `useAppMenus`): Edit, with
 * Copy (❖C), Paste (❖V), and Clear (Esc). The ❖ chords are real:
 * the shell matches them against the enabled rows (app-menus/shortcut.ts), so
 * ❖C copies even though Metal reports no Ctrl chords to the app. Esc is the
 * key the keypad already takes.
 */

import { enabledIds, type MenuSpec } from "../kit/index.ts";

export interface CalculatorMenuContext {
  /** The clipboard can be written and the display shows a number. */
  canCopy: boolean;
  /** The clear key says AC (everything is cleared) rather than C. */
  allClear: boolean;
  actions: { copy(): void; paste(): void; clear(): void };
}

export function calculatorMenus(context: CalculatorMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const menus: MenuSpec[] = [
    {
      id: "edit",
      items: [
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: context.canCopy },
        { id: "paste", label: "Paste", shortcut: "❖V" },
        { type: "separator" },
        { id: "clear", label: context.allClear ? "All Clear" : "Clear", shortcut: "Esc" },
      ],
    },
  ];
  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    if (id === "copy") context.actions.copy();
    else if (id === "paste") context.actions.paste();
    else if (id === "clear") context.actions.clear();
  };
  return { menus, run };
}
