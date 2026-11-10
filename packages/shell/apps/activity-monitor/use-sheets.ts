/**
 * The Activity Monitor's sheets and menus: the quit sheet (what Quit… asks),
 * its "still running" follow-up, the refusal, the inspect sheet, and the menus
 * the view button and a right click open. Quitting is sent through quit.ts; an
 * app still running after STILL_RUNNING_MS is offered a force quit. Closing a
 * sheet or a menu hands the keyboard back.
 */

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { MonitorActions } from "./actions.ts";
import type { Line } from "./lines.ts";
import type { Monitor, MonitorState } from "./monitor.ts";
import { STILL_RUNNING_MS } from "./policy.ts";
import { lineRefusal, sendQuit } from "./quit.ts";

export type SheetState =
  | { kind: "quit"; line: Line }
  | { kind: "refused"; name: string; reason: string }
  | { kind: "still"; line: Line }
  | { kind: "inspect"; line: Line }
  | null;

export type MenuState = { kind: "view" | "context"; x: number; y: number } | null;

export interface Sheets {
  sheet: SheetState;
  menu: MenuState;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  /** A sheet or a menu is open: the keys leave the list alone. */
  blocked: boolean;
  /** Why the selected line can't be quit (its tooltip, the Quit… item); null when it can. */
  refusal: string | null;
  quit(line?: Line | null): void;
  answer(line: Line, signal: "SIGTERM" | "SIGKILL" | null): void;
  closeSheet(): void;
  closeMenu(): void;
  inspect(line?: Line | null): void;
}

export interface SheetsInput {
  monitor: Monitor;
  actions: MonitorActions;
  rows: MonitorState["rows"];
  selectedLine: Line | null;
  /** Hands the keyboard back when a sheet or a menu closes. */
  giveBack(): void;
}

export function useSheets(input: SheetsInput): Sheets {
  const { monitor, actions, rows, selectedLine, giveBack } = input;
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (stillTimer.current && clearTimeout(stillTimer.current)), []);

  const closeSheet = (): void => {
    setSheet(null);
    giveBack();
  };
  const closeMenu = (): void => {
    setMenu(null);
    giveBack();
  };
  const quit = (line: Line | null = selectedLine): void => {
    if (!line) return;
    const reason = lineRefusal(line, rows, actions.guard);
    setSheet(reason ? { kind: "refused", name: line.name, reason } : { kind: "quit", line });
  };
  const answer = (line: Line, signal: "SIGTERM" | "SIGKILL" | null): void => {
    if (!signal) return closeSheet();
    const outcome = sendQuit(line, rows, signal, actions);
    if (outcome.kind === "refused") return setSheet({ kind: "refused", name: line.name, reason: outcome.reason });
    closeSheet();
    setTimeout(() => void monitor.refresh(), 300);
    if (outcome.kind !== "sent" || signal === "SIGKILL") return;
    if (stillTimer.current) clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => {
      stillTimer.current = null;
      if (outcome.targets.some((target) => actions.alive(target))) setSheet((open) => open ?? { kind: "still", line });
    }, STILL_RUNNING_MS);
  };
  const inspect = (line: Line | null = selectedLine): void => {
    if (line) setSheet({ kind: "inspect", line });
  };

  return {
    sheet,
    menu,
    setMenu,
    blocked: sheet !== null || menu !== null,
    refusal: selectedLine ? lineRefusal(selectedLine, rows, actions.guard) : null,
    quit,
    answer,
    closeSheet,
    closeMenu,
    inspect,
  };
}
