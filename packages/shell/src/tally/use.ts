/** The tally as React reads it: the view, repainting when the holder or the house lights change. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { systemTally, type TallyStore } from "./store.ts";
import type { TallyView } from "./types.ts";

export function useTally(store: TallyStore = systemTally()): TallyView {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
  );
}

/**
 * Now, turning each whole second while `active` (a countdown is on screen),
 * and not at all otherwise: a widget or capsule that counts ticks only itself.
 */
export function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        1000 - (Date.now() % 1000) + 5,
      );
    };
    setNow(Date.now());
    schedule();
    return () => clearTimeout(timer);
  }, [active]);
  return now;
}
