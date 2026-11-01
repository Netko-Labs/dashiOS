/**
 * What the overview shows: the windows on screen, each screen's own, laid out
 * inside that screen's usable area (layout.ts). Pure, so it is tested without a
 * compositor.
 */

import type { CompositorWindow, Frame } from "../compositor.ts";
import type { Output } from "../layout.ts";
import { layoutOverview, type Placed } from "./layout.ts";

const contains = (frame: Frame, x: number, y: number) =>
  x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height;

/** The screen a window belongs to: the one under its center, else the first. */
export function screenOf(frame: Frame, outputs: readonly Output[]): Output | undefined {
  const x = frame.x + frame.width / 2;
  const y = frame.y + frame.height / 2;
  return outputs.find((output) => contains(output.frame, x, y)) ?? outputs[0];
}

/**
 * Rectangles for the windows that are on screen, a screen at a time, in the
 * order given (the compositor lists windows front to back, so the window used
 * last comes first). Minimized and hidden windows are not shown.
 */
export function planOverview(windows: readonly CompositorWindow[], outputs: readonly Output[]): Placed[] {
  const onScreen = windows.flatMap((window) => (window.state === "normal" && window.frame ? [{ window, frame: window.frame }] : []));
  return outputs.flatMap((output) => {
    const mine = onScreen.filter(({ frame }) => screenOf(frame, outputs) === output);
    const items = mine.map(({ window, frame }) => ({ id: window.id, width: frame.width, height: frame.height }));
    return layoutOverview(items, output.usable);
  });
}
