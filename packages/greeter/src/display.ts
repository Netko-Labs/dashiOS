/**
 * Whether the greeter's Metal hosts draw Inter Display and the light weights,
 * as their `protocol` lines say: the clock is ExtraLight there (D670), and
 * Regular until a host has said so, or on an older host that would refuse a
 * tree asking for them. The greeter's hosts are one binary, so the last word
 * heard is the answer.
 */

import type { NativeEvent } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";

type Listener = () => void;

let display = false;
const listeners = new Set<Listener>();

/** What one `protocol` line says: both abilities, or neither. */
export function drawsDisplay(event: NativeEvent): boolean | null {
  if (event.type !== "protocol") return null;
  return event.fontWeights === true && event.displayFont === true;
}

/** Hear a host's events: its protocol line sets the answer. */
export function noteHost(host: { onEvent(listener: (event: NativeEvent) => void): unknown }): void {
  host.onEvent((event) => {
    const says = drawsDisplay(event);
    if (says === null || says === display) return;
    display = says;
    for (const listener of listeners) listener();
  });
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The answer, repainting the caller when a host says. */
export function useDisplay(): boolean {
  return useSyncExternalStore(subscribe, () => display);
}
