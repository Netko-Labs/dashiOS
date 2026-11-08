/**
 * The window's shells: one dashi-term per tab, started at the window's grid
 * with the shell integration, in the folder asked for. What each says goes
 * where it belongs: frames to the screen store (store.ts), names to the tab
 * (naming.ts), the bell to the tab or the grid's edge, a copy to the
 * clipboard; an exit closes the tab, and an engine that goes away without
 * one leaves the tab saying so until Return starts another (`restart`).
 */

import { useRef } from "react";
import type { Clipboard } from "../kit/index.ts";
import { type Engine, type EngineInput, integrationDir, startEngine } from "./engine.ts";
import { renamed } from "./naming.ts";
import type { TerminalPalette } from "./palette.ts";
import { applyFrame, type EngineMessage } from "./screen.ts";
import { ScreenStore } from "./store.ts";
import { activeTab, addTab, closeTab, newTab, ring, type Tabs, updateTab } from "./tabs.ts";

export interface Sessions {
  store: ScreenStore;
  engine(id: number): Engine | undefined;
  engines(): Engine[];
  /** A new tab after the one in front, its shell in `folder` (home when null), or `command` in place of the shell. */
  open(folder: string | null, command?: readonly string[] | null): void;
  /** Start tab `id`'s shell again after its engine went away. */
  restart(id: number, folder: string | null): void;
  /** Hang up tab `id` and close it. */
  close(id: number): void;
  /** Send to every tab's engine. */
  broadcast(input: EngineInput): void;
  /** A tab has been opened (so no tabs left means the last one closed). */
  started(): boolean;
  /** The grid every shell runs at, and its cell in px; null until measured. */
  size: { current: { cols: number; rows: number; cw: number; ch: number } | null };
}

export interface SessionsOptions {
  binary: string;
  clipboard: Clipboard;
  /** The palette a new shell starts with: the one in use now. */
  palette: () => TerminalPalette;
  setTabs: (change: (tabs: Tabs) => Tabs) => void;
  /** The tabs as they are now (for the bell: the tab in front flashes). */
  tabs: () => Tabs;
  /** The bell rang in the tab in front. */
  onFrontBell: () => void;
}

const colorsMessage = (palette: TerminalPalette): EngineInput => ({ t: "colors", fg: palette.ink, bg: palette.ground, palette: palette.ansi });

export function useSessions(options: SessionsOptions): Sessions {
  const engines = useRef(new Map<number, Engine>());
  const store = useRef(new ScreenStore());
  const nextId = useRef(1);
  const size = useRef<{ cols: number; rows: number; cw: number; ch: number } | null>(null);
  const latest = useRef(options);
  latest.current = options;

  const close = (id: number): void => {
    engines.current.get(id)?.stop();
    engines.current.delete(id);
    store.current.delete(id);
    latest.current.setTabs((tabs) => closeTab(tabs, id));
  };

  const hear = (id: number, message: EngineMessage): void => {
    const { setTabs, clipboard } = latest.current;
    switch (message.t) {
      case "frame":
        store.current.update(id, (screen) => applyFrame(screen, message.frame));
        return;
      case "title":
      case "cwd":
      case "prompt":
      case "command":
        setTabs((tabs) => updateTab(tabs, id, (tab) => ({ ...tab, naming: renamed(tab.naming, message) })));
        return;
      case "bell":
        if (activeTab(latest.current.tabs())?.id === id) latest.current.onFrontBell();
        else setTabs((tabs) => ring(tabs, id));
        return;
      case "copied":
        if (message.text) void clipboard.writeText(message.text);
        return;
      case "exit":
        close(id);
        return;
      case "gone":
        engines.current.delete(id);
        setTabs((tabs) => updateTab(tabs, id, (tab) => ({ ...tab, lost: true })));
        return;
      case "done":
      case "running":
        return;
    }
  };

  const launch = (id: number, folder: string | null, command: readonly string[] | null = null): boolean => {
    const at = size.current;
    if (!at) return false;
    const { binary, palette } = latest.current;
    const engine = startEngine(binary, at, (message) => hear(id, message), { cwd: folder, integration: integrationDir(), command });
    engine.send(colorsMessage(palette()));
    engine.send({ t: "resize", cols: at.cols, rows: at.rows, cw: at.cw, ch: at.ch });
    engines.current.set(id, engine);
    return true;
  };

  return {
    store: store.current,
    size,
    engine: (id) => engines.current.get(id),
    engines: () => [...engines.current.values()],
    open(folder, command = null) {
      const id = nextId.current;
      if (!launch(id, folder, command)) return;
      nextId.current += 1;
      latest.current.setTabs((tabs) => addTab(tabs, newTab(id)));
    },
    restart(id, folder) {
      if (engines.current.has(id) || !launch(id, folder)) return;
      latest.current.setTabs((tabs) => updateTab(tabs, id, (tab) => ({ ...tab, lost: false })));
    },
    close,
    broadcast(input) {
      for (const engine of engines.current.values()) engine.send(input);
    },
    started: () => nextId.current > 1,
  };
}

export { colorsMessage };
