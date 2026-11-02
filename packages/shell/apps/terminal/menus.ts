/**
 * The Terminal's menus in the menu bar (the kit's `useAppMenus`), on the
 * Mac's ❖ keys: File (New Window, New Tab, Close Tab, Close Window), Edit
 * (Copy, Paste, Select All), and View, which lists the tabs (❖1…❖9) and
 * steps between them (⇧❖[ and ⇧❖]). The shell matches the chords against the
 * enabled rows (app-menus/shortcut.ts), so ❖C copies while Ctrl+C still
 * reaches the program.
 */

import { enabledIds, type MenuItemSpec, type MenuSpec } from "../kit/index.ts";

export interface TerminalMenuContext {
  /** The clipboard can be written (wl-copy is installed). */
  canCopy: boolean;
  /** The tabs' titles in order, and which is in front. */
  tabs: readonly string[];
  active: number;
  actions: {
    copy(): void;
    paste(): void;
    selectAll(): void;
    newWindow(): void;
    newTab(): void;
    closeTab(): void;
    closeWindow(): void;
    /** -1 the tab before, 1 the one after. */
    stepTab(delta: number): void;
    /** The tab at `index` (a View row; ❖1…❖8, and ❖9 for the last). */
    showIndex(index: number): void;
  };
}

/** A menu label's limit is 80 characters; a long title is cut with an ellipsis. */
const LABEL = 60;

function tabLabel(title: string): string {
  return title.length > LABEL ? `${title.slice(0, LABEL - 1)}…` : title;
}

export function terminalMenus(context: TerminalMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const several = context.tabs.length > 1;
  const tabRows: MenuItemSpec[] = context.tabs.map((title, index) => ({
    id: `tab:${index}`,
    label: tabLabel(title),
    // ❖9 is the last tab, so the ninth row and later show no key unless the ninth is last.
    shortcut: index < 8 ? `❖${index + 1}` : index === context.tabs.length - 1 ? "❖9" : undefined,
    checked: index === context.active,
  }));
  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "new-window", label: "New Window", shortcut: "❖N" },
        { id: "new-tab", label: "New Tab", shortcut: "❖T" },
        { type: "separator" },
        { id: "close-tab", label: several ? "Close Tab" : "Close", shortcut: "❖W" },
        { id: "close-window", label: "Close Window", shortcut: "⇧❖W" },
      ],
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
    {
      id: "view",
      items: [
        { id: "previous-tab", label: "Show Previous Tab", shortcut: "⇧❖[", enabled: several },
        { id: "next-tab", label: "Show Next Tab", shortcut: "⇧❖]", enabled: several },
        { type: "separator" },
        ...tabRows,
      ],
    },
  ];
  const actions: Record<string, () => void> = {
    "new-window": context.actions.newWindow,
    "new-tab": context.actions.newTab,
    "close-tab": context.actions.closeTab,
    "close-window": context.actions.closeWindow,
    copy: context.actions.copy,
    paste: context.actions.paste,
    "select-all": context.actions.selectAll,
    "previous-tab": () => context.actions.stepTab(-1),
    "next-tab": () => context.actions.stepTab(1),
  };
  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    const tab = /^tab:(\d+)$/.exec(id);
    if (tab) {
      context.actions.showIndex(Number(tab[1]));
      return;
    }
    actions[id]?.();
  };
  return { menus, run };
}
