/**
 * What the laptop adds to the battery panel (battery/lib/panel.tsx): the charge
 * limit with a one-time full charge, and "Using the graphics card", each
 * holder with its estimated draw and Quit (or the card's lost state, with
 * Restart…). The power mode isn't here any more: it is Control Center's
 * Power tile and its page. Pure: the snapshots in, rows out; a row says what
 * it does as a `LaptopAction`, which laptop/start.ts carries out (the mode
 * action stays for Fn F5's and the agents' callers).
 */

import { type GraphicsSnapshot, LOST_NOTICE } from "../graphics/index.ts";
import type { MenuEntry } from "../menus/index.ts";
import { chargeTarget, type ModeChoice, type ModeSnapshot, type PowerSection } from "../power/index.ts";
import type { LaptopSnapshot } from "./store.ts";

export type LaptopAction = { kind: "mode"; choice: ModeChoice } | { kind: "full-charge" } | { kind: "quit-holder"; name: string } | { kind: "restart" };

export interface LaptopMenuState {
  laptop: LaptopSnapshot;
  modes: ModeSnapshot;
  graphics: GraphicsSnapshot | null;
  power: PowerSection;
  now: Date;
}

type Entry<A> = MenuEntry<A>;

/** The laptop's sections of the battery panel, each led by a separator; `wrap` makes a row's action the panel's own. */
export function laptopEntries<A>(state: LaptopMenuState, wrap: (action: LaptopAction) => A): Entry<A>[] {
  const info = (label: string): Entry<A> => ({ kind: "item", label, action: null });
  const item = (label: string, action: LaptopAction, extra: { checked?: boolean; keys?: string } = {}): Entry<A> => ({
    kind: "item",
    label,
    ...extra,
    action: wrap(action),
  });
  const out: Entry<A>[] = [];

  if (state.laptop.laptop && state.laptop.knobs.has("charge-limit")) {
    const target = chargeTarget(state.power, state.now);
    out.push({ kind: "separator" });
    if (target.why) out.push(info(target.why));
    if (!state.power.fullChargeOnce && state.power.chargeLimit !== undefined && state.power.chargeLimit < 100)
      out.push(item("Charge to Full Once", { kind: "full-charge" }));
  }

  const graphics = state.graphics;
  if (graphics?.hasCard) {
    if (graphics.lost) {
      out.push({ kind: "separator" }, info(LOST_NOTICE.summary), item("Restart…", { kind: "restart" }));
    } else if (graphics.holders.length > 0) {
      out.push({ kind: "separator" }, info("Using the Graphics Card"));
      for (const holder of graphics.holders) {
        const label = holder.watts === null ? holder.name : `${holder.name} · ~${Math.round(holder.watts)} W`;
        out.push(holder.pids.length > 0 ? item(label, { kind: "quit-holder", name: holder.name }, { keys: "Quit" }) : info(label));
      }
      const waiting = graphics.decision?.waitingFor.length
        ? graphics.decision.why
        : `Quitting ${graphics.holders.length === 1 ? "it" : "them"} lets the card sleep.`;
      out.push(info(waiting));
    }
  }
  return out;
}
