/**
 * The Terminal window's standing effects, as its tabs come and go: every
 * tab's colors follow Dark Mode (a program's own stay its own), the window's
 * title follows the front tab, the last tab closing closes the window, and
 * unmounting stops every engine.
 */

import { useEffect } from "react";
import type { TerminalPalette } from "./palette.ts";
import { colorsMessage, type Sessions } from "./sessions.ts";
import type { Tabs } from "./tabs.ts";

export interface WindowLifecycleInput {
  sessions: Sessions;
  palette: TerminalPalette;
  tabs: Tabs;
  onExit(): void;
  title: string;
  setWindowTitle(title: string): void;
}

export function useWindowLifecycle({ sessions, palette, tabs, onExit, title, setWindowTitle }: WindowLifecycleInput): void {
  // Dark Mode changes every tab's colors; programs' own stay theirs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessions is a facade over refs.
  useEffect(() => {
    sessions.broadcast(colorsMessage(palette));
  }, [palette]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only.
  useEffect(
    () => () => {
      for (const each of sessions.engines()) each.stop();
    },
    [],
  );
  // The last tab closing (its shell exited, or ❖W) closes the window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessions is a facade over refs.
  useEffect(() => {
    if (sessions.started() && tabs.list.length === 0) onExit();
  }, [tabs, onExit]);
  useEffect(() => {
    setWindowTitle(title);
  }, [title, setWindowTitle]);
}
