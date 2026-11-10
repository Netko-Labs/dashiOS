/**
 * The Terminal's menu bar menus (menus.ts) and the actions they and the
 * context menu share: copy, paste, select all, clear, the tabs and windows,
 * the font size and the prompts (❖↑ ❖↓). Registered with the kit's
 * `useAppMenus`, so the shell's ❖ chords reach them.
 */

import { type Clipboard, useAppMenus } from "../kit/index.ts";
import type { Engine } from "./engine.ts";
import { FONT_SIZE, stepFontSize } from "./line.tsx";
import { terminalMenus } from "./menus.ts";
import type { Sessions } from "./sessions.ts";
import { showIndex, stepTab, type Tab, type Tabs } from "./tabs.ts";
import type { Closing } from "./use-closing.ts";

export interface TerminalMenuActions {
  copy(): void;
  paste(): void;
  selectAll(): void;
  clear(): void;
}

export interface TerminalMenuInput {
  clipboard: Clipboard;
  /** The grid has a selection: Copy is on. */
  selected: boolean;
  tabs: Tabs;
  names: readonly string[];
  front: Tab | undefined;
  fontSize: number;
  setFontSize(update: (size: number) => number): void;
  setTabs(change: (tabs: Tabs) => Tabs): void;
  engine(): Pick<Engine, "send"> | undefined;
  /** The folder a new tab or window opens in: the front tab's, on this machine. */
  here(): string | null;
  sessions: Pick<Sessions, "open">;
  newWindow(folder: string | null): void;
  closing: Pick<Closing, "requestCloseTab" | "requestCloseWindow">;
}

export function useTerminalMenus({
  clipboard,
  selected,
  tabs,
  names,
  front,
  fontSize,
  setFontSize,
  setTabs,
  engine,
  here,
  sessions,
  newWindow,
  closing,
}: TerminalMenuInput): TerminalMenuActions {
  const actions: TerminalMenuActions = {
    copy: () => engine()?.send({ t: "copy" }),
    paste: () => {
      void clipboard.readText().then((text) => {
        if (text) engine()?.send({ t: "paste", text });
      });
    },
    selectAll: () => engine()?.send({ t: "select-all" }),
    clear: () => engine()?.send({ t: "clear" }),
  };
  const { menus, run } = terminalMenus({
    canCopy: clipboard.canWrite && selected,
    tabs: names,
    active: tabs.list.findIndex((tab) => tab.id === tabs.active),
    canGrow: stepFontSize(fontSize, 1) !== fontSize,
    canShrink: stepFontSize(fontSize, -1) !== fontSize,
    actions: {
      ...actions,
      newWindow: () => newWindow(here()),
      newTab: () => sessions.open(here()),
      closeTab: () => front && closing.requestCloseTab(front.id),
      closeWindow: closing.requestCloseWindow,
      zoom: (step) => setFontSize((size) => (step === 0 ? FONT_SIZE : stepFontSize(size, step))),
      jump: (prompts) => engine()?.send({ t: "jump", prompts }),
      stepTab: (delta) => setTabs((current) => stepTab(current, delta)),
      showIndex: (index) => setTabs((current) => showIndex(current, index)),
    },
  });
  useAppMenus(menus, run);
  return actions;
}
