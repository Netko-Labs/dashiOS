/**
 * Asking for a restore (manager.ts): the first plan the screens take. A
 * default mode (decisions.md D552) a cable cannot carry is refused, and the
 * plan without it is asked for next.
 */

import type { Compositor } from "../../compositor/index.ts";
import { type ConfigRequest, toWire } from "../plan.ts";

/** A request that asks for something; null for one that asks for nothing. */
export const nonEmpty = (request: ConfigRequest): ConfigRequest | null => (request.outputs.length > 0 || request.primary !== undefined ? request : null);

/** Asks for each plan in turn (the same one once) until one is taken; that one, or null with the last refusal logged. */
export async function firstTaken(compositor: Pick<Compositor, "outputsConfig">, plans: ReadonlyArray<ConfigRequest | null>): Promise<ConfigRequest | null> {
  let last: unknown = null;
  for (const [index, plan] of plans.entries()) {
    if (!plan || plans.slice(0, index).some((tried) => JSON.stringify(tried) === JSON.stringify(plan))) continue;
    try {
      await compositor.outputsConfig(toWire(plan));
      return plan;
    } catch (error) {
      last = error;
    }
  }
  if (last !== null) console.error("dashi-shell: could not restore the display arrangement:", last instanceof Error ? last.message : last);
  return null;
}
