/**
 * Which harness a task is handed to first ("Hand it off"; Settings ›
 * Agents, "Hand off to"): the one Settings names if it is installed, else
 * the one answering Ask, else the first installed in the catalog's order.
 */

import { type HarnessId, isHarnessId } from "../ask/answerer.ts";

export function harnessOrder(installed: readonly HarnessId[], handOff: unknown, answerer: unknown): HarnessId[] {
  const first = [handOff, answerer].find((id): id is HarnessId => isHarnessId(id) && installed.includes(id));
  return first ? [first, ...installed.filter((id) => id !== first)] : [...installed];
}
