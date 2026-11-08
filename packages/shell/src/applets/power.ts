/**
 * Dashi's power mode for applets (protocol 4, docs/applets.md "Version 4:
 * the power mode"). An applet with `power.mode` in its manifest hears the
 * mode store's state (power/modes/store.ts) after the welcome and on every
 * change, and may ask for Automatic or a mode. The ask is a pick, the same
 * call Control Center and Settings make (`choose`): the store saves it,
 * works out the mode, and applies its recipe. The applet never sets the
 * mode itself.
 *
 * The laptop (and its mode store) starts after the applets do, so main.tsx
 * makes an `AppletPower` first and connects the store to it once it exists.
 */

import type { Manifest, PowerChoice, PowerState } from "@dashi/applet";
import type { ModeSnapshot } from "../power/modes/store.ts";
import { MODE_LABEL, type ModeChoice } from "../power/modes/types.ts";

/** What applets reach of the mode store: its snapshot, its changes, and a pick. */
export interface ModeSource {
  getSnapshot(): ModeSnapshot;
  subscribe(listener: () => void): () => void;
  choose(choice: ModeChoice): void;
}

/** The store's snapshot as the wire carries it. */
export function powerState(snapshot: ModeSnapshot): PowerState {
  const { effective } = snapshot;
  return {
    choice: snapshot.choice,
    available: [...snapshot.available],
    mode: effective?.mode ?? null,
    automatic: effective?.automatic ?? false,
    why: effective?.why ?? null,
    failed: snapshot.failed,
  };
}

/** Whether a manifest asks for Dashi's power mode. */
export const mayChoosePower = (manifest: Manifest | null | undefined): boolean =>
  manifest?.permissions.some((permission) => permission.kind === "power-mode") ?? false;

/** Why a choice can't be made now, or null when it can. */
export function refusePowerChoice(state: PowerState | null, choice: PowerChoice): string | null {
  if (!state || state.available.length === 0) return "power: this machine has no power modes";
  if (choice !== "automatic" && !state.available.includes(choice)) return `power: this machine has no ${MODE_LABEL[choice]} mode`;
  return null;
}

/** The applets' end of the mode store, connected when the laptop has started. */
export class AppletPower {
  private source: ModeSource | null = null;
  private stopSource: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  /** The mode store (or none); everyone listening hears its state. */
  connect(source: ModeSource | null): void {
    this.stopSource?.();
    this.source = source;
    this.stopSource = source?.subscribe(() => this.tell()) ?? null;
    this.tell();
  }

  /** What the store says now; null before it is connected. */
  state(): PowerState | null {
    return this.source ? powerState(this.source.getSnapshot()) : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** An applet's ask, as a pick in Control Center; the reason when it can't be made. */
  choose(choice: PowerChoice): string | null {
    const refused = refusePowerChoice(this.state(), choice);
    if (refused !== null) return refused;
    this.source?.choose(choice);
    return null;
  }

  private tell(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** One connection's side: the state sent once on attach and again whenever it changes. */
export function attachPower(power: AppletPower, send: (state: PowerState) => void): () => void {
  let last = "";
  const tell = (): void => {
    const state = power.state();
    if (!state) return;
    const line = JSON.stringify(state);
    if (line === last) return;
    last = line;
    send(state);
  };
  const stop = power.subscribe(tell);
  tell();
  return stop;
}
