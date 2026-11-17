/**
 * When the lock screen rests into Glance: after a while with nothing typed
 * or pressed, and back at once on any key or press. The clock is passed in,
 * so the rule is tested without waiting.
 */

import { useEffect, useState } from "react";

/** How long the lock screen waits, untouched, before it rests. */
export const GLANCE_AFTER_MS = 30_000;

/** Whether it rests now; `touched` changes (a counter) on every key and press. */
export function useResting(touched: number, after: number = GLANCE_AFTER_MS): [boolean, () => void] {
  const [resting, setResting] = useState(false);
  const [woken, setWoken] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `touched` and `woken` restart the wait
  useEffect(() => {
    setResting(false);
    const timer = setTimeout(() => setResting(true), after);
    return () => clearTimeout(timer);
  }, [touched, woken, after]);
  return [resting, () => setWoken((n) => n + 1)];
}

/** What the hint under the field says while a press waits for the password ("Unlock to open Notes"). */
export function unlockHint(pending: { label: string } | null, idle: string): string {
  return pending ? `Unlock to open ${pending.label}` : idle;
}
