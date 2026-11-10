/**
 * Activity Monitor's menus in the menu bar (the kit's `useAppMenus`): Edit
 * (Find, Copy) and View (by app or every process, which processes, the five
 * tabs, the summary, how often it looks, Inspect, and Quit). The ❖ chords
 * are real: the shell matches them against the enabled rows
 * (app-menus/shortcut.ts). Quit Process is ❖K: the keymap swallows every ⌥❖
 * chord but two (⌥❖Esc and ⌥❖D are bound) and ⇧❖Q is Quit
 * (app-menus/lib/reserved.ts), so no ❖Q variant can reach the app. Rows are
 * disabled under a sheet or a menu, which hold the window. Menu-bar commands
 * are Title Case (CP-2).
 */

import { enabledIds, type MenuSpec } from "../../kit/index.ts";
import type { Interval, Tab } from "./monitor.ts";

export const TABS = [
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "Memory" },
  { value: "energy", label: "Energy" },
  { value: "disk", label: "Disk" },
  { value: "network", label: "Network" },
] as const satisfies ReadonlyArray<{ value: Tab; label: string }>;

export const FREQUENCIES = [
  { value: 1000, id: "every:1", label: "Update Every Second" },
  { value: 2000, id: "every:2", label: "Update Every 2 Seconds" },
  { value: 5000, id: "every:5", label: "Update Every 5 Seconds" },
  { value: null, id: "every:paused", label: "Pause Updates" },
] as const satisfies ReadonlyArray<{ value: Interval; id: string; label: string }>;

export interface ViewChoices {
  /** Apps on lines of their own with their processes under them (true), or every process on its own line. */
  grouped: boolean;
  mine: boolean;
  kernel: boolean;
  summary: boolean;
  interval: Interval;
}

export interface MonitorMenuContext {
  tab: Tab;
  view: ViewChoices;
  /** A line is selected (whether it may be quit is asked on the sheet). */
  hasSelection: boolean;
  /** A sheet or a menu holds the window. */
  blocked: boolean;
  actions: {
    find(): void;
    copy(): void;
    setView(patch: Partial<ViewChoices>): void;
    chooseTab(tab: Tab): void;
    inspect(): void;
    quitProcess(): void;
  };
}

export function monitorMenus(context: MonitorMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, blocked, view, tab } = context;
  const enabled = !blocked;
  const selected = context.hasSelection && enabled;
  const menus: MenuSpec[] = [
    {
      id: "edit",
      items: [
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: selected },
        { id: "find", label: "Find", shortcut: "❖F", enabled },
      ],
    },
    {
      id: "view",
      items: [
        { id: "grouped", label: "Group by App", checked: view.grouped, enabled },
        { type: "separator" },
        { id: "scope:all", label: "All Processes", checked: !view.mine, enabled },
        { id: "scope:mine", label: "My Processes", checked: view.mine, enabled },
        { id: "kernel", label: "Kernel Threads", checked: view.kernel, enabled },
        { type: "separator" },
        ...TABS.map(({ value, label }, index) => ({ id: `tab:${value}`, label, shortcut: `❖${index + 1}`, checked: tab === value, enabled })),
        { type: "separator" },
        { id: "summary", label: "Show Summary", checked: view.summary, enabled },
        ...FREQUENCIES.map(({ value, id, label }) => ({ id, label, checked: view.interval === value, enabled })),
        { type: "separator" },
        { id: "inspect", label: "Inspect…", shortcut: "❖I", enabled: selected },
        { id: "quit-process", label: "Quit Process…", shortcut: "❖K", enabled: selected },
      ],
    },
  ];
  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    if (id === "find") actions.find();
    else if (id === "copy") actions.copy();
    else if (id === "grouped") actions.setView({ grouped: !view.grouped });
    else if (id === "scope:all" || id === "scope:mine") actions.setView({ mine: id === "scope:mine" });
    else if (id === "kernel") actions.setView({ kernel: !view.kernel });
    else if (id === "summary") actions.setView({ summary: !view.summary });
    else if (id === "inspect") actions.inspect();
    else if (id === "quit-process") actions.quitProcess();
    else {
      const frequency = FREQUENCIES.find((each) => each.id === id);
      if (frequency) return actions.setView({ interval: frequency.value });
      const next = TABS.find(({ value }) => id === `tab:${value}`);
      if (next) actions.chooseTab(next.value);
    }
  };
  return { menus, run };
}
