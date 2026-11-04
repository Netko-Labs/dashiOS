/**
 * The pointer on a Dock icon or a taskbar button, from the button going down
 * to its release: what gesture.ts decides, wired to the timers, the pinned
 * apps, and the Dock's hiding. A kept app can be dragged along the row to
 * move it and pulled up out of it to remove it; held still, it opens its
 * menu; anything else is a click, which `swallows` tells the view to ignore
 * after a drag or a hold. The Dock and the taskbar share this, and differ
 * only in how far a drag has gone (`PressSetup.targetOf`).
 */

import type { PointerInfo } from "@mirinjs/metal";
import { useRef, useState } from "react";
import type { Autohide } from "./autohide.ts";
import { dropOf, GESTURE, holdPress, moveItem, movePressBy, type Press, startPress, swallowsClick } from "./gesture.ts";
import type { DockEntry } from "./layout.ts";
import type { PinStore } from "./pins.ts";

/** What a press needs of its view, read when the button goes down. */
export interface PressSetup {
  /** The kept apps' keys, in order, as they are now. */
  order: readonly string[];
  /** Where an app taken at `from` drops when the pointer has moved `dx` across. */
  targetOf(from: number, dx: number): number;
  /** The button was held still: open the menu. */
  onHold(): void;
}

/** The press in progress (or just finished: its click, if any, comes right after the release). */
interface Active extends PressSetup {
  key: string;
  press: Press;
  timer: ReturnType<typeof setTimeout> | null;
  /** Dropped or released; later events of this press (Metal can send them late) are ignored. */
  ended: boolean;
}

/** How the row looks while an app is dragged: the order it would take, which app, and whether it is on its way out. */
export interface Preview {
  order: readonly string[];
  dragging: string;
  pulledOut: boolean;
}

export interface PressGesture {
  preview: Preview | null;
  /** Feed every pointer phase of an app's button; `place` is its place among the kept apps (null if it is not kept). */
  pointer(entry: DockEntry, place: number | null, event: PointerInfo, setup: PressSetup): void;
  /** Whether a click on this app's button is the end of a drag or a hold, not a click. */
  swallows(key: string): boolean;
}

export function usePress(pins: Pick<PinStore, "unpin" | "reorder">, autohide: Pick<Autohide, "hold"> | null): PressGesture {
  const [preview, setPreview] = useState<Preview | null>(null);
  const active = useRef<Active | null>(null);

  /** The button lifted: a drag drops where it is. The press stays in `active`, for the click that may follow. */
  const finish = () => {
    const current = active.current;
    if (!current || current.ended) return;
    current.ended = true;
    autohide?.hold("press", false);
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
    const drop = dropOf(current.press);
    if (drop.kind === "remove") pins.unpin(current.key);
    if (drop.kind === "move") pins.reorder(moveItem(current.order, drop.from, drop.to));
    setPreview(null);
  };

  const pointer: PressGesture["pointer"] = (entry, place, event, setup) => {
    if (event.phase === "down") {
      if (active.current?.timer) clearTimeout(active.current.timer);
      // A drag can end far from the Dock; it stays out until the button lifts.
      autohide?.hold("press", true);
      const timer = setTimeout(() => {
        const current = active.current;
        if (!current || current.key !== entry.key) return;
        current.timer = null;
        current.press = holdPress(current.press);
        if (current.press.mode === "held") current.onHold();
      }, GESTURE.holdMs);
      active.current = { ...setup, key: entry.key, press: startPress(event.x, event.y, place), timer, ended: false };
      return;
    }
    const current = active.current;
    if (!current || current.ended) return;
    if (event.phase === "move") {
      const next = movePressBy(current.press, event.x, event.y, current.targetOf, current.order.length);
      if (next === current.press) return;
      current.press = next;
      if (next.mode !== "press" && current.timer) {
        clearTimeout(current.timer);
        current.timer = null;
      }
      if (next.mode === "drag" && next.from !== null && next.target !== null) {
        setPreview({ order: moveItem(current.order, next.from, next.target), dragging: current.key, pulledOut: next.pulledOut });
      }
      return;
    }
    finish();
  };

  const swallows = (key: string): boolean => {
    const current = active.current;
    return current?.key === key && swallowsClick(current.press);
  };

  return { preview, pointer, swallows };
}

/** `entries` in the order a drag's preview gives (the others make room); as they are without one. */
export function inPreviewOrder<T extends { key: string }>(entries: readonly T[], preview: Preview | null): readonly T[] {
  if (!preview) return entries;
  const rank = new Map(preview.order.map((key, index) => [key, index]));
  return [...entries].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
}
