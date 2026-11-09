/**
 * The Terminal's menus in the menu bar (the kit's `useAppMenus`), on the
 * Mac's ❖ keys: File (New Window, New Tab, Close Tab, Close Window), Edit
 * (Copy while something is selected, Paste, Select All, Clear Scrollback),
 * and View: the face's size (❖= ❖- ❖0), the prompts before and after the
 * view (❖↑ ❖↓, with the shell integration), and the tabs (❖1…❖9, ⇧❖[ and
 * ⇧❖]). The shell matches the chords against the enabled rows
 * (app-menus/shortcut.ts), so ❖C copies while Ctrl+C still reaches the program.
 */

import { enabledIds, type MenuItemSpec, type MenuSpec } from "../kit/index.ts";

export interface TerminalMenuContext {
  /** Something is selected and the clipboard can be written (wl-copy is installed). */
  canCopy: boolean;
  /** The tabs' names in order, and which is in front. */
  tabs: readonly string[];
  active: number;
  /** The face can grow, or shrink, a step. */
  canGrow: boolean;
  canShrink: boolean;
  actions: {
    copy(): void;
    paste(): void;
    selectAll(): void;
    clear(): void;
    newWindow(): void;
    newTab(): void;
    closeTab(): void;
    closeWindow(): void;
    /** 1 a step bigger, -1 smaller, 0 back to the usual size. */
    zoom(step: -1 | 0 | 1): void;
    /** -1 the prompt before the view's top, 1 the one after. */
    jump(prompts: -1 | 1): void;
    /** -1 the tab before, 1 the one after. */
    stepTab(delta: number): void;
    /** The tab at `index` (a View row; ❖1…❖8, and ❖9 for the last). */
    showIndex(index: number): void;
  };
}

/**
 * A tab's row: at most 36 characters, so the row and its ❖ key stay inside
 * the menu bar's dropdown (360 at most) with no second cut. A longer name is cut in the
 * middle, its start and its end kept: two tabs of one long folder differ
 * at the end ("…-2026", "…-2027"), and a command at its start.
 */
export const TAB_LABEL = 36;

export function tabLabel(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= TAB_LABEL) return title;
  const tail = Math.floor((TAB_LABEL - 1) / 3);
  const head = TAB_LABEL - 1 - tail;
  return `${chars.slice(0, head).join("").trimEnd()}…${chars
    .slice(chars.length - tail)
    .join("")
    .trimStart()}`;
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
        { id: "clear", label: "Clear Scrollback", shortcut: "❖K" },
      ],
    },
    {
      id: "view",
      items: [
        { id: "bigger", label: "Bigger", shortcut: "❖=", enabled: context.canGrow },
        { id: "smaller", label: "Smaller", shortcut: "❖-", enabled: context.canShrink },
        { id: "actual-size", label: "Actual Size", shortcut: "❖0" },
        { type: "separator" },
        { id: "previous-prompt", label: "Previous Prompt", shortcut: "❖↑" },
        { id: "next-prompt", label: "Next Prompt", shortcut: "❖↓" },
        { type: "separator" },
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
    clear: context.actions.clear,
    bigger: () => context.actions.zoom(1),
    smaller: () => context.actions.zoom(-1),
    "actual-size": () => context.actions.zoom(0),
    "previous-prompt": () => context.actions.jump(-1),
    "next-prompt": () => context.actions.jump(1),
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
