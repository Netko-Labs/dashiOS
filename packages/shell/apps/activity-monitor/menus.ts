/**
 * Activity Monitor's menus in the menu bar (the kit's `useAppMenus`): Edit
 * (Find) and View (which processes, the four tabs, and Quit Process). The
 * ❖ chords are real: the shell matches them against the enabled rows
 * (app-menus/shortcut.ts). Quit Process is ❖K, not the Mac's ⌥❖Q: the keymap
 * swallows every ⌥❖ chord but two (⌥❖Esc and ⌥❖D are bound) and ⇧❖Q is Quit
 * (app-menus/reserved.ts), so no ❖Q variant can reach the app. Rows are
 * disabled under a sheet or a menu, which hold the window.
 */

import { enabledIds, type MenuSpec } from "../kit/index.ts";
import type { Tab } from "./monitor.ts";

export const TABS = [
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "Memory" },
  { value: "disk", label: "Disk" },
  { value: "network", label: "Network" },
] as const satisfies ReadonlyArray<{ value: Tab; label: string }>;

export interface MonitorMenuContext {
  tab: Tab;
  scope: { mine: boolean; kernel: boolean };
  /** A process is selected (whether it may be quit is asked on the sheet). */
  hasSelection: boolean;
  /** A sheet or a menu holds the window. */
  blocked: boolean;
  actions: {
    find(): void;
    setScope(patch: Partial<{ mine: boolean; kernel: boolean }>): void;
    toggleKernel(): void;
    chooseTab(tab: Tab): void;
    quitProcess(): void;
  };
}

export function monitorMenus(context: MonitorMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, blocked, scope, tab } = context;
  const enabled = !blocked;
  const menus: MenuSpec[] = [
    { id: "edit", items: [{ id: "find", label: "Find", shortcut: "❖F", enabled }] },
    {
      id: "view",
      items: [
        { id: "scope:all", label: "All Processes", checked: !scope.mine, enabled },
        { id: "scope:mine", label: "My Processes", checked: scope.mine, enabled },
        { type: "separator" },
        { id: "kernel", label: "Kernel Threads", checked: scope.kernel, enabled },
        { type: "separator" },
        ...TABS.map(({ value, label }, index) => ({ id: `tab:${value}`, label, shortcut: `❖${index + 1}`, checked: tab === value, enabled })),
        { type: "separator" },
        { id: "quit-process", label: "Quit Process…", shortcut: "❖K", enabled: context.hasSelection && enabled },
      ],
    },
  ];
  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    if (id === "find") actions.find();
    else if (id === "scope:all" || id === "scope:mine") actions.setScope({ mine: id === "scope:mine" });
    else if (id === "kernel") actions.toggleKernel();
    else if (id === "quit-process") actions.quitProcess();
    else {
      const next = TABS.find(({ value }) => id === `tab:${value}`);
      if (next) actions.chooseTab(next.value);
    }
  };
  return { menus, run };
}
