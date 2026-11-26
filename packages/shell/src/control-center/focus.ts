/**
 * Focus for a while (design.html CC-6, decisions.md D765, D785): the Focus page's choices, when each
 * ends, the words the page and its header say, and the timer that turns Focus off when its time
 * comes. Pure but for `keepFocusTime`, which the shell starts once (menus/lib/wiring.tsx).
 */

import type { FlagsStore, FocusFor } from "../shared/control-center/index.ts";
import { type ClockPrefs, formatTime } from "../shared/time/index.ts";

/** When "this evening" and "tomorrow" end, in local hours: 7 PM, and 8 AM the next morning. */
export const FOCUS_HOURS = { evening: 19, morning: 8 } as const;
/** "This evening" is offered while at least this much of the day is left before it (ms). */
const EVENING_LEAST_MS = 3_600_000;
const HOUR_MS = 3_600_000;

/** A row of the page: a choice and when it would end; `until` null is "until I turn it off". */
export interface FocusChoice {
  id: FocusFor | "off";
  label: string;
  until: number | null;
}

const at = (now: Date, days: number, hour: number): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0).getTime();

/** When `choice` would end if chosen at `now`; null: when it is turned off. */
export function focusUntil(choice: FocusFor | "off", now: Date): number | null {
  switch (choice) {
    case "hour":
      return now.getTime() + HOUR_MS;
    case "evening":
      return at(now, 0, FOCUS_HOURS.evening);
    case "tomorrow":
      return at(now, 1, FOCUS_HOURS.morning);
    case "off":
      return null;
  }
}

/** The page's rows at `now`: an hour, this evening (while there is an hour of the day left before it), tomorrow, until turned off. */
export function focusChoices(now: Date): FocusChoice[] {
  const evening = at(now, 0, FOCUS_HOURS.evening);
  const choices: FocusChoice[] = [{ id: "hour", label: "For 1 hour", until: focusUntil("hour", now) }];
  if (evening - now.getTime() >= EVENING_LEAST_MS) choices.push({ id: "evening", label: "Until this evening", until: evening });
  choices.push({ id: "tomorrow", label: "Until tomorrow", until: focusUntil("tomorrow", now) }, { id: "off", label: "Until I turn it off", until: null });
  return choices;
}

/** The chosen row: the choice Focus was turned on for, "off" when on with no end, null when Focus is off. */
export function focusChosen(flags: { dnd: boolean; dndFor?: FocusFor | undefined }): FocusChoice["id"] | null {
  if (!flags.dnd) return null;
  return flags.dndFor ?? "off";
}

/** A row's second line, or the header's: "Until 5:48 PM". */
export const untilWords = (until: number, prefs?: ClockPrefs): string => `Until ${formatTime(new Date(until), prefs)}`;

/** The header's second line: "On for 1 hour", "Until 7:00 PM", "On", "Off". */
export function focusDetail(flags: { dnd: boolean; dndUntil?: number | undefined; dndFor?: FocusFor | undefined }, prefs?: ClockPrefs): string {
  if (!flags.dnd) return "Off";
  if (flags.dndUntil === undefined) return "On";
  return flags.dndFor === "hour" ? "On for 1 hour" : untilWords(flags.dndUntil, prefs);
}

/** Turns Focus on for `choice` from `now`, or off. */
export function chooseFocus(flags: Pick<FlagsStore, "set">, choice: FocusChoice["id"], now: Date): void {
  const until = focusUntil(choice, now);
  flags.set(until === null || choice === "off" ? { dnd: true, dndUntil: undefined, dndFor: undefined } : { dnd: true, dndUntil: until, dndFor: choice });
}

/** What `keepFocusTime` arms its timer with (a test's clock). */
export interface FocusClock {
  now(): number;
  later(fn: () => void, ms: number): () => void;
}

const REAL: FocusClock = {
  now: () => Date.now(),
  later: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** Turns Focus off when the time it was turned on for comes; follows every change. Returns what stops it. */
export function keepFocusTime(flags: Pick<FlagsStore, "subscribe" | "getSnapshot" | "set">, clock: FocusClock = REAL): () => void {
  let cancel: (() => void) | null = null;
  const arm = (): void => {
    cancel?.();
    cancel = null;
    const { dnd, dndUntil } = flags.getSnapshot();
    if (!dnd || dndUntil === undefined) return;
    const end = () => flags.set({ dnd: false });
    const left = dndUntil - clock.now();
    if (left <= 0) end();
    else cancel = clock.later(end, left);
  };
  arm();
  const stop = flags.subscribe(arm);
  return () => {
    stop();
    cancel?.();
  };
}
