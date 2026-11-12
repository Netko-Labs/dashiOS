/**
 * What is picked on the grid: one event (kept by its key, so it survives the
 * model redrawing its occurrences), or an empty day and half hour.
 */

import { useState } from "react";
import type { Occurrence } from "../../../../src/shared/calendar/index.ts";
import { occurrenceKey } from "../grid/event-block.tsx";

export interface Picked {
  /** The picked event, while the view shows it. */
  picked: Occurrence | null;
  pickedKey: string | null;
  pick: (occurrence: Occurrence | null) => void;
  /** The picked half hour (minutes into the day), or null. */
  slot: number | null;
  setSlot: (minutes: number | null) => void;
}

export function usePicked(occurrences: readonly Occurrence[]): Picked {
  const [slot, setSlot] = useState<number | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const picked = pickedKey === null ? null : (occurrences.find((each) => occurrenceKey(each) === pickedKey) ?? null);
  const pick = (occurrence: Occurrence | null): void => {
    setPickedKey(occurrence ? occurrenceKey(occurrence) : null);
    if (occurrence) setSlot(null);
  };
  return { picked, pickedKey, pick, slot, setSlot };
}
