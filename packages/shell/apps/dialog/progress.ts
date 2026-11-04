/**
 * `--progress`'s stdin protocol, apart from drawing it. Each line is one
 * command: a number sets the bar's percentage, a line starting with `#` sets
 * the text over it, and `pulsate:true` or `pulsate:false` turns the moving
 * bar on or off; anything else is ignored. At 100% (and at the end of stdin)
 * OK is enabled, and with `--auto-close` the dialog goes with exit 0.
 */

import { displayText } from "./markup.ts";

export type ProgressCommand = { kind: "percentage"; value: number } | { kind: "text"; text: string } | { kind: "pulsate"; on: boolean };

/** One stdin line as a command, or null for a line that is none. */
export function parseProgressLine(line: string): ProgressCommand | null {
  const trimmed = line.replace(/\r$/, "");
  if (trimmed.startsWith("#")) return { kind: "text", text: trimmed.slice(1).replace(/^\s+/, "") };
  const pulsate = trimmed.trim().match(/^pulsate:\s*(true|false)$/i);
  if (pulsate) return { kind: "pulsate", on: (pulsate[1] as string).toLowerCase() === "true" };
  const number = trimmed.trim().match(/^[+-]?(\d+(\.\d*)?|\.\d+)/);
  if (!number) return null;
  return { kind: "percentage", value: Math.min(Math.max(Number.parseFloat(number[0]), 0), 100) };
}

export interface ProgressState {
  percentage: number;
  text: string;
  pulsate: boolean;
  /** OK is enabled: 100% reached, or stdin ended. */
  finished: boolean;
  /** `--auto-close` and finished: the dialog goes now, with exit 0. */
  close: boolean;
}

export interface ProgressOptions {
  autoClose: boolean;
  noMarkup: boolean;
}

export function initialProgress(percentage: number, text: string, pulsate: boolean): ProgressState {
  return { percentage, text, pulsate, finished: false, close: false };
}

/** The state after one stdin line. */
export function applyProgressLine(state: ProgressState, line: string, options: ProgressOptions): ProgressState {
  const command = parseProgressLine(line);
  if (!command) return state;
  switch (command.kind) {
    case "text":
      return { ...state, text: displayText(command.text, options.noMarkup) };
    case "pulsate":
      return { ...state, pulsate: command.on };
    case "percentage": {
      const finished = state.finished || command.value >= 100;
      return { ...state, percentage: command.value, finished, close: state.close || (finished && options.autoClose) };
    }
  }
}

/** Stdin ended: OK is enabled, a pulsing bar fills, and `--auto-close` closes. */
export function endProgress(state: ProgressState, options: ProgressOptions): ProgressState {
  return { ...state, percentage: state.pulsate ? 100 : state.percentage, pulsate: false, finished: true, close: state.close || options.autoClose };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `--time-remaining`: "Time remaining: 00:01:05", from the time so far and the percentage; null before there is enough to go on. */
export function timeRemaining(elapsedMs: number, percentage: number): string | null {
  if (percentage <= 0 || percentage >= 100 || elapsedMs < 1000) return null;
  const seconds = Math.round((elapsedMs / 1000) * ((100 - percentage) / percentage));
  return `Time remaining: ${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
