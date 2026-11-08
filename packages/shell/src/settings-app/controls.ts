/**
 * Settings' sliders' ranges and choices: what each runs over and how it
 * snaps (the arithmetic is @dashi/ui's slider-math.ts), and the lists the
 * pills pick from.
 */

import type { SliderRange } from "@dashi/ui";

/** A slider's range: where it runs, and the step it snaps to. */
export type Range = SliderRange;

/** Tracking speed, -1 (slowest) to 1 (fastest), in steps of 0.05. */
export const SPEED: Range = { min: -1, max: 1, step: 0.05 };
/** Scrolling speed's slider, in the factor's base-2 logarithm: 0.25 to 4 with 1 in the middle (scroll-speed.ts). */
export const SCROLL_POSITION: Range = { min: -2, max: 2, step: 0.1 };
/** Keys per second once repeating starts; 0 turns repeat off. */
export const REPEAT_RATE: Range = { min: 0, max: 50, step: 1 };
/** Milliseconds a key is held before it repeats. */
export const REPEAT_DELAY: Range = { min: 100, max: 1000, step: 25 };

/** What the compositor does with no setting (comp/src/devices/keyboard.rs, libinput's neutral speed). */
export const DEFAULTS = { repeatRate: 25, repeatDelay: 200, accelSpeed: 0 } as const;

export function describeRate(rate: number): string {
  return rate === 0 ? "Off" : `${rate} per second`;
}

export function describeDelay(ms: number): string {
  return `${ms} ms`;
}

/** What the shell does with no `idle` setting (the same default as settings.ts). */
export const DEFAULT_BLANK_AFTER = 300;

/** "Never", then minutes: what the Mac offers. */
export const BLANK_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Never" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 1200, label: "20 minutes" },
  { value: 1800, label: "30 minutes" },
];

/** The choice for a saved number of seconds: itself when listed, else the one nearest above (a hand-edited 90 s shows as 2 minutes). */
export function blankChoice(seconds: number): number {
  if (seconds === 0) return 0;
  return BLANK_CHOICES.find((choice) => choice.value >= seconds && choice.value > 0)?.value ?? 1800;
}

/** "Never", then minutes and hours: when the computer sleeps by itself (Battery & Power). */
export const SLEEP_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Never" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 7200, label: "2 hours" },
];

/** The sleep choice for a saved number of seconds: itself when listed, else the one nearest above (a hand-edited 8 minutes shows as 10). */
export function sleepChoice(seconds: number): number {
  if (seconds === 0) return 0;
  return SLEEP_CHOICES.find((choice) => choice.value >= seconds && choice.value > 0)?.value ?? 7200;
}

/** "5 min", "1 h": a time choice's words short enough for a pill. */
export function shortTime(label: string): string {
  return label.replace(/\bminutes?\b/, "min").replace(/\bhours?\b/, "h");
}

/** A time list as pills: the times first, shortened, and "Never" last, as the design reads (Battery & Power, Lock Screen). */
export function timePills(choices: ReadonlyArray<{ value: number; label: string }>): Array<{ value: number; label: string }> {
  const times = choices.filter((choice) => choice.value > 0).map((choice) => ({ value: choice.value, label: shortTime(choice.label) }));
  return [...times, ...choices.filter((choice) => choice.value <= 0)];
}
