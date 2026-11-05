/**
 * The battery menu as the laptop's hub (docs/0.4.0.html, Laptop features A):
 * the power mode with Automatic and, in one line, what it chose and why;
 * the charge limit with a one-time full charge; and "Using the graphics
 * card", each holder with its estimated draw and Quit (or the card's lost
 * state, with Restart…). Pure: the snapshots in, rows out; a row says what
 * it does as a `LaptopAction`, which laptop/start.ts carries out.
 */

import type { GraphicsSnapshot } from "../graphics/controller.ts";
import { LOST_NOTICE } from "../graphics/lost-card.ts";
import type { MenuEntry } from "../menus/model.ts";
import { chargeTarget } from "../power/battery-health.ts";
import type { PowerSection } from "../power/modes/settings.ts";
import type { ModeSnapshot } from "../power/modes/store.ts";
import { MODE_LABEL, type ModeChoice } from "../power/modes/types.ts";
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

/** The laptop's sections of the battery menu, each led by a separator; `wrap` makes a row's action the menu's own. */
export function laptopEntries<A>(state: LaptopMenuState, wrap: (action: LaptopAction) => A): Entry<A>[] {
  const info = (label: string): Entry<A> => ({ kind: "item", label, action: null });
  const item = (label: string, action: LaptopAction, extra: { checked?: boolean; keys?: string } = {}): Entry<A> => ({
    kind: "item",
    label,
    ...extra,
    action: wrap(action),
  });
  const out: Entry<A>[] = [];

  const { modes } = state;
  if (modes.available.length > 0) {
    const effective = modes.effective;
    out.push({ kind: "separator" }, info("Power Mode"));
    const automatic = modes.choice === "automatic";
    out.push(
      item(
        automatic && effective ? `Automatic · ${MODE_LABEL[effective.mode]} now` : "Automatic",
        { kind: "mode", choice: "automatic" },
        { checked: automatic },
      ),
    );
    for (const mode of modes.available) {
      out.push(item(MODE_LABEL[mode], { kind: "mode", choice: mode }, { checked: !automatic && modes.choice === mode }));
    }
    if (effective) out.push(info(`${effective.why}.`));
  }

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
