/**
 * The Terminal's menus in the menu bar (the kit's `useAppMenus`): File (New
 * Window, Close Window) and Edit (Copy, Paste, Select All), on the Mac's ❖
 * keys. The shell matches the chords against the enabled rows
 * (app-menus/shortcut.ts), so ❖C copies while Ctrl+C still reaches the
 * program.
 */

import { enabledIds, type MenuSpec } from "../kit/index.ts";

export interface TerminalMenuContext {
  /** The clipboard can be written (wl-copy is installed). */
  canCopy: boolean;
  actions: { copy(): void; paste(): void; selectAll(): void; newWindow(): void; close(): void };
}

export function terminalMenus(context: TerminalMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [{ id: "new-window", label: "New Window", shortcut: "❖N" }, { type: "separator" }, { id: "close", label: "Close Window", shortcut: "❖W" }],
    },
    {
      id: "edit",
      items: [
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: context.canCopy },
        { id: "paste", label: "Paste", shortcut: "❖V" },
        { type: "separator" },
        { id: "select-all", label: "Select All", shortcut: "❖A" },
      ],
    },
  ];
  const actions: Record<string, () => void> = {
    "new-window": context.actions.newWindow,
    close: context.actions.close,
    copy: context.actions.copy,
    paste: context.actions.paste,
    "select-all": context.actions.selectAll,
  };
  const run = (id: string): void => {
    if (enabledIds(menus).has(id)) actions[id]?.();
  };
  return { menus, run };
}
