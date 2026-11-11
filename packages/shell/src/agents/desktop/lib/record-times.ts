/** record_screen's arithmetic: how long the video is, when stills are taken, which screen. Pure. */

import type { Output } from "../../../compositor/index.ts";

/**
 * How long the video is, in seconds: the recorder's own clock, from when
 * wf-recorder began to when it ended (`measured`), else the time the tool
 * waited. The tool used to say the time it waited, which runs on after a
 * recording the person stopped early (a 6.4 s file was "about 40.0 s").
 */
export function recordedLength(measured: number | null, started: number, now: number): number {
  return measured ?? Math.max(0, now - started) / 1000;
}

/** When each still is taken, in ms from the start: the middles of `frames` equal slices. */
export function stillTimes(seconds: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => Math.round(((index + 0.5) * seconds * 1000) / frames));
}

export interface Display {
  name: string;
  frame: { x: number; y: number; width: number; height: number };
}

/** The screen named `name` (else the main display, else the first) from the compositor's `outputs` answer. */
export function displayOf(outputs: readonly Output[], name: string | null): Display | null {
  const screens = outputs.flatMap((output) => (output.enabled && output.frame ? [{ name: output.name, primary: output.primary, frame: output.frame }] : []));
  const chosen = name === null ? (screens.find((screen) => screen.primary) ?? screens[0]) : screens.find((screen) => screen.name === name);
  return chosen ? { name: chosen.name, frame: chosen.frame } : null;
}
