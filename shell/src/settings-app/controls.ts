/**
 * The arithmetic of Settings' sliders: where a pointer is on the bar, and the
 * value it stands for, snapped to the slider's step so a setting is never
 * saved as 0.30000000000000004.
 */

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** Where `value` sits on the bar, 0 to 1. */
export function fractionOf(value: number, { min, max }: Range): number {
  if (max <= min) return 0;
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

/** Decimal places a step needs (0.05 → 2). */
function places(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** The value for a position on the bar (0 to 1): snapped to the step, inside the range. */
export function valueAt(fraction: number, range: Range): number {
  const { min, max, step } = range;
  const raw = min + Math.min(Math.max(fraction, 0), 1) * (max - min);
  const snapped = min + Math.round((raw - min) / step) * step;
  return Number(Math.min(Math.max(snapped, min), max).toFixed(places(step)));
}

/** A pointer at window pixel `x` over a bar with these bounds, as 0 to 1 with the knob's center under it. */
export function fractionAt(x: number, bar: { x: number; width: number }, knob: number): number {
  const travel = bar.width - knob;
  if (travel <= 0) return 0;
  return Math.min(Math.max((x - bar.x - knob / 2) / travel, 0), 1);
}

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
